import type { Queryable } from '../db.ts';
import { insertChatMessage } from '../campaign/chat-routes.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { parseFormula, rollDice } from '../../../../packages/domain/dice/dice.ts';
import { findSrdMagicItem, type ItemEffect } from '../../../../packages/domain/character/magic-items.ts';
import { addCondition, removeCondition } from '../rules/conditions.ts';
import { purgeObject } from '../tabletop/scene/objects/remove.ts';
import type { ActionEconomy } from '../rules/action-economy.ts';

type Notice = { title: string; detail: string; characterId?: string };

export type MagicUseContext = SceneFeatureContext & {
  rollDie: (sides: number) => number;
  insertRoll: (
    q: Queryable, campaignId: string, userId: string, characterId: string | null, label: string | null, formula: string,
    results: number[], modifier: number, total: number, hidden: boolean, breakdown?: unknown[] | null, outcome?: Record<string, unknown> | null,
  ) => Promise<any>;
  canManageCharacter: (q: Queryable, member: any, userId: string, ownerUserId: string | null, characterId?: string | null) => Promise<boolean>;
  actionEconomy: ActionEconomy;
  applyHpChange: (
    q: Queryable, campaignId: string, userId: string, characterId: string,
    change: { mode: 'damage' | 'heal'; amount: number; damageType: string | null; critical: boolean },
  ) => Promise<{ row: any; applied: number; blocked: string | null; notices: Notice[] }>;
  announceHpChange: (campaignId: string, characterId: string, mode: 'damage' | 'heal', change: { applied: number; blocked: string | null; notices: any[] }) => void;
};

const CONDITION_NAMES: Record<string, string> = {
  energy_ward: 'сопротивление', climbing: 'лазание', flying: 'полёт', blessed: 'благословение', invisible: 'невидимость', hasted: 'ускорение',
};
const DAMAGE_NAMES: Record<string, string> = {
  acid: 'кислоте', cold: 'холоду', fire: 'огню', force: 'силовому полю', lightning: 'электричеству', necrotic: 'некротической энергии',
  poison: 'яду', psychic: 'психической энергии', radiant: 'излучению', thunder: 'звуку',
};
const lasting = (rounds: number) => (rounds >= 600 ? `${Math.round(rounds / 600)} ч` : `${Math.max(1, Math.round(rounds / 10))} мин`);

// Potions, oils and ointments: drunk or applied on the holder, spent as an action in combat, used up.
export function registerMagicUseRoutes(ctx: MagicUseContext) {
  const { app, db, auth, membership, canManage, notifyCampaign, rollDie, insertRoll, canManageCharacter, actionEconomy, applyHpChange, announceHpChange } = ctx;

  app.post<{ Params: { campaignId: string; characterId: string } }>(
    '/campaigns/:campaignId/characters/:characterId/use-magic',
    { schema: { params: objectSchema({ campaignId: uuid, characterId: uuid }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const healed: Array<{ applied: number; blocked: string | null; notices: Notice[] }> = [];
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const row = (await q.query(
          `SELECT c.id, c.name, c.kind, c.quantity, h.id AS holder_id, h.name AS holder_name, h.kind AS holder_kind, h.owner_user_id AS holder_owner,
                  m.srd_index, m.destroyed
           FROM characters c
           JOIN magic_items m ON m.campaign_id = c.campaign_id AND m.character_id = c.id
           LEFT JOIN characters h ON h.campaign_id = c.campaign_id AND h.id = c.container_id
           WHERE c.campaign_id=$1 AND c.id=$2 FOR UPDATE OF c`,
          [campaignId, characterId],
        )).rows[0] as any;
        if (!row) reject(404, 'Магический предмет не найден.');
        const use = findSrdMagicItem(row.srd_index)?.use;
        if (!use || use.kind !== 'consume') reject(400, `«${row.name}» так не используют — его эффект применяет мастер.`);
        if (row.destroyed) reject(400, `«${row.name}» уничтожен.`);
        if (!row.holder_id || (row.holder_kind !== 'character' && row.holder_kind !== 'npc')) reject(400, `«${row.name}» ни у кого нет — его нужно взять.`);
        const manager = await canManage(q, member, userId);
        if (!manager && !(await canManageCharacter(q, member, userId, row.holder_owner, row.holder_id))) {
          reject(403, 'Предмет использует тот, у чьего персонажа он лежит, или мастер.');
        }
        const consume = use as Extract<NonNullable<typeof use>, { kind: 'consume' }>;
        await actionEconomy.spend(q, campaignId, row.holder_id, consume.time, { kind: 'other' }, { enforce: await actionEconomy.enforceFor(q, campaignId, manager) });

        const parts: string[] = [];
        for (const effect of consume.effects as ItemEffect[]) {
          if (effect.kind === 'heal') {
            const parsed = parseFormula(effect.formula);
            if (!parsed) continue;
            const rolled = rollDice(parsed, rollDie);
            await insertRoll(q, campaignId, userId, row.holder_id, `${row.name} → ${row.holder_name}`.slice(0, 100), effect.formula, rolled.results, parsed.modifier, rolled.total, false);
            const before = Number((await q.query('SELECT hp_current FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, row.holder_id])).rows[0]?.hp_current ?? 0);
            const change = await applyHpChange(q, campaignId, userId, row.holder_id, { mode: 'heal', amount: rolled.total, damageType: null, critical: false });
            healed.push(change);
            const gained = Math.max(0, Number(change.row?.hp_current ?? before) - before);
            parts.push(change.blocked ? `лечение не подействовало (${change.blocked === 'no_healing' ? 'не лечится' : change.blocked})` : `+${gained} хитов (${effect.formula}: ${rolled.total})`);
          } else if (effect.kind === 'temp-hp') {
            await q.query('UPDATE characters SET hp_temp=GREATEST(coalesce(hp_temp, 0), $3), revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, row.holder_id, effect.amount]);
            parts.push(`${effect.amount} временных хитов`);
          } else if (effect.kind === 'condition') {
            await addCondition(q, campaignId, row.holder_id, effect.code, {
              source: 'item', sourceName: row.name, remainingRounds: effect.rounds, durationRounds: effect.rounds, ...(effect.parameters ?? {}),
            });
            const damage = typeof effect.parameters?.damageType === 'string' ? DAMAGE_NAMES[effect.parameters.damageType] : null;
            parts.push(`${damage ? `сопротивление ${damage}` : CONDITION_NAMES[effect.code] ?? effect.code} на ${lasting(effect.rounds)}`);
          } else if (effect.kind === 'cure') {
            for (const code of effect.codes) await removeCondition(q, campaignId, row.holder_id, code);
            parts.push('яд и болезни сняты');
          }
        }

        if (Number(row.quantity ?? 1) > 1) {
          await q.query('UPDATE characters SET quantity=quantity-1, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, row.id]);
        } else {
          await purgeObject(q, campaignId, row.id);
        }
        const summary = `${row.holder_name}: «${row.name}» — ${parts.join(', ') || 'использовано'}.`;
        const chat = await insertChatMessage(q, campaignId, userId, { characterId: row.holder_id, body: summary });
        return { holderId: row.holder_id as string, summary, chat };
      });
      for (const change of healed) announceHpChange(campaignId, result.holderId, 'heal', change);
      void notifyCampaign(campaignId, { type: 'character', characterId: result.holderId });
      void notifyCampaign(campaignId, { type: 'changed' });
      void notifyCampaign(campaignId, { type: 'rolls' });
      void notifyCampaign(campaignId, { type: 'chat', message: result.chat });
      return { holderId: result.holderId, summary: result.summary };
    },
  );
}
