import type { Queryable } from '../../db.ts';
import { HOLY_NIMBUS_FEET, HOLY_NIMBUS_DAMAGE, DRACONIC_PRESENCE_FEET } from '../../../../../packages/domain/character/class-features.ts';
import { beginTurn } from '../../rules/action-economy.ts';
import { nextGroup } from '../../../../../packages/domain/combat/turn-groups.ts';
import { teamControls, placementsHostile } from '../../campaign/factions.ts';
import { tickRoundTimers } from '../scene/scene-counters.ts';
import { type Notice as ConditionNotice, loadConditionState, addCondition } from '../../rules/conditions.ts';
import { incapacitatedReason } from '../../../../../packages/domain/combat/conditions.ts';

import { autoLegendary } from '../auto-turn/legendary.ts';
import { announceConditionNotices, applyHpChange } from './hp.ts';
import { clearOpportunities } from './opportunity.ts';
import { hurlReturns } from './reactions.ts';
import type { TableContext } from '../context.ts';
import { notify, notifyCampaign } from '../live/notify.ts';
import { rollSaveAgainst } from '../rolls/checks.ts';
import { feetBetween, getScene } from '../scene/board.ts';
import { canManageCharacter, loadPlacements } from '../scene/placements.ts';
import { canManage, reject, sceneParams, type SceneParams } from '../shared.ts';
import { initiativeQueue } from './initiative.ts';

export async function holyNimbusTick(ctx: TableContext, q: Queryable, campaignId: string, userId: string, sceneId: string, characterId: string) {
  const glowing = (
    await q.query(`SELECT DISTINCT character_id FROM character_effects WHERE campaign_id=$1 AND effect_code='holy_nimbus' AND active AND character_id <> $2`, [campaignId, characterId])
  ).rows.map(row => row.character_id as string);
  if (!glowing.length) return [];
  const scene = await getScene(q, campaignId, sceneId, false);
  const placements = await loadPlacements(q, campaignId, sceneId);
  const self = placements.find(item => item.character_id === characterId && !item.parent_object_id);
  if (!self || self.kind === 'object') return [];
  const notices: ConditionNotice[] = [];
  for (const paladinId of glowing) {
    const paladin = placements.find(item => item.character_id === paladinId && !item.parent_object_id);
    if (!paladin || !placementsHostile(paladin, self) || feetBetween(scene, paladin, self) > HOLY_NIMBUS_FEET) continue;
    if (incapacitatedReason(await loadConditionState(q, campaignId, paladinId))) continue;
    const change = await applyHpChange(ctx, q, campaignId, userId, characterId, { mode: 'damage', amount: HOLY_NIMBUS_DAMAGE, damageType: 'radiant', critical: false, sourceId: paladinId });
    notices.push({ title: `${self.name}: «Святой нимб» ${paladin.name}`, detail: `Начал ход в сиянии — ${change.applied} урона излучением.`, characterId });
  }
  return notices;
}

export async function draconicPresenceTick(ctx: TableContext, q: Queryable, campaignId: string, userId: string, sceneId: string, characterId: string) {
  const auras = (
    await q.query(`SELECT character_id, parameters FROM character_effects WHERE campaign_id=$1 AND effect_code='draconic_presence' AND active AND character_id <> $2`, [campaignId, characterId])
  ).rows as Array<{ character_id: string; parameters: any }>;
  if (!auras.length) return [];
  const scene = await getScene(q, campaignId, sceneId, false);
  const placements = await loadPlacements(q, campaignId, sceneId);
  const self = placements.find(item => item.character_id === characterId && !item.parent_object_id);
  if (!self || self.kind === 'object') return [];
  const notices: ConditionNotice[] = [];
  for (const aura of auras) {
    const sorcerer = placements.find(item => item.character_id === aura.character_id && !item.parent_object_id);
    if (!sorcerer || !placementsHostile(sorcerer, self) || feetBetween(scene, sorcerer, self) > DRACONIC_PRESENCE_FEET) continue;
    const code = aura.parameters?.mode === 'charm' ? 'charmed' : 'frightened';
    const already = (
      await q.query(
        `SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND parameters->>'sourceCharacterId' = $3
             AND (effect_code = $4 OR (effect_code = 'presence_resisted' AND parameters->>'sourceName' = 'Драконье присутствие'))`,
        [campaignId, characterId, aura.character_id, code],
      )
    ).rows[0];
    if (already) continue;
    const dc = Number(aura.parameters?.dc ?? 13);
    const save = await rollSaveAgainst(ctx, q, campaignId, userId, characterId, 'wisdom', dc, `Спасбросок МДР (СЛ ${dc}) против «Драконьего присутствия» — ${self.name}`.slice(0, 100), false, null, [], { condition: code, magic: true });
    if (save.success) {
      await addCondition(q, campaignId, characterId, 'presence_resisted', { source: 'feature', sourceCharacterId: aura.character_id, sourceName: 'Драконье присутствие' });
      notices.push({ title: `${self.name}: устоял перед «Драконьим присутствием»`, detail: `Спасбросок ${save.total} — сутки неуязвим.`, characterId });
    } else {
      const added = await addCondition(q, campaignId, characterId, code, { source: 'feature', sourceCharacterId: aura.character_id, sourceName: 'Драконье присутствие', concentrationOf: aura.character_id });
      notices.push({ title: `${self.name}: «Драконье присутствие» ${sorcerer.name}`, detail: added ? `${code === 'charmed' ? 'Очарован' : 'Испуган'}, пока держится аура.` : 'Не действует.', characterId });
    }
  }
  return notices;
}

export function registerTurnRoutes(ctx: TableContext) {
  const { app, auth, conditionEngine, db, membership, triggers } = ctx;

  app.post<{ Params: SceneParams; Body: { entryId?: string; current?: string[] } | undefined }>(
    '/campaigns/:campaignId/scenes/:sceneId/initiative/advance',
    { schema: { params: sceneParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const entryId = request.body?.entryId;
      if (entryId !== undefined && (typeof entryId !== 'string' || !/^[0-9a-f-]{36}$/i.test(entryId))) reject(400, 'entryId — id записи инициативы.');
      const seen = request.body?.current;
      if (seen !== undefined && (!Array.isArray(seen) || seen.length > 200 || seen.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)))) {
        reject(400, 'current — id текущих записей инициативы.');
      }

      const turnNotices: ConditionNotice[] = [];
      let areaNotices: Awaited<ReturnType<typeof triggers.fireTurnStart>> = [];
      const endedIds: string[] = [];
      const startedIds: string[] = [];
      const timersTicked = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const manager = await canManage(q, member, userId);

        await getScene(q, campaignId, sceneId);

        const { entries, sides, grouped, allied } = await initiativeQueue(q, campaignId, sceneId, true);
        if (entries.length === 0) reject(400, 'Инициатива пуста.');
        const currentIndices = entries.map((entry, index) => (entry.is_current ? index : -1)).filter(index => index >= 0);
        if (seen) {
          const actual = currentIndices.map(index => entries[index]!.id).sort().join(',');
          if ([...new Set(seen)].sort().join(',') !== actual) reject(409, 'Ход уже передан — очередь обновлена.');
        }

        let finishing: number[];
        if (!manager) {
          const own: number[] = [];
          for (const index of currentIndices) {
            const entry = entries[index]!;
            const mine = entry.owner_user_id
              ? await canManageCharacter(q, member, userId, entry.owner_user_id, entry.character_id ?? entry.reflex_of)
              : Boolean(entry.character_id) && (await teamControls(q, campaignId, userId, entry.character_id!));
            if (mine) own.push(index);
          }
          finishing = entryId ? own.filter(index => entries[index]!.id === entryId) : own;
          if (!finishing.length) reject(403, 'Закончить ход может тот, чей сейчас ход, или мастер.');
        } else {
          finishing = entryId ? currentIndices.filter(index => entries[index]!.id === entryId) : currentIndices;
          if (entryId && !finishing.length) reject(400, 'Эта запись сейчас не ходит.');
        }

        for (const index of finishing) {
          await q.query('UPDATE initiative_entries SET is_current=false WHERE id=$1', [entries[index]!.id]);
          const characterId = entries[index]!.character_id;
          if (characterId) turnNotices.push(...await conditionEngine.endOfTurn(q, campaignId, userId, characterId));
          if (characterId) turnNotices.push(...await hurlReturns(ctx, q, campaignId, userId, characterId));
          if (characterId) endedIds.push(characterId);
          if (entries[index]!.reflex_of) await q.query('DELETE FROM initiative_entries WHERE id=$1', [entries[index]!.id]);
        }
        if (currentIndices.some(index => !finishing.includes(index))) return false;

        const { indices: next, wrapped } = nextGroup(sides, finishing.length ? currentIndices : [], grouped, allied);
        await q.query('UPDATE initiative_entries SET is_current=false WHERE campaign_id=$1 AND scene_id=$2', [campaignId, sceneId]);
        for (const index of next) {
          await beginTurn(q, campaignId, entries[index]!.id);
          const reflexOf = entries[index]!.reflex_of;
          const own = reflexOf ? entries.find(entry => entry.character_id === reflexOf) : undefined;
          if (own) await beginTurn(q, campaignId, own.id);
          const acting = entries[index]!.character_id ?? (own ? reflexOf : null);
          if (acting) startedIds.push(acting);
        }
        await clearOpportunities(q, campaignId, sceneId);

        for (const index of next) {
          const reflexOf = entries[index]!.reflex_of;
          const own = reflexOf ? entries.find(entry => entry.character_id === reflexOf) : undefined;
          const characterId = entries[index]!.character_id ?? (own ? reflexOf : null);
          if (!characterId) continue;
          turnNotices.push(...await conditionEngine.startOfTurn(q, campaignId, userId, characterId, own?.id ?? entries[index]!.id));
          turnNotices.push(...await holyNimbusTick(ctx, q, campaignId, userId, sceneId, characterId));
          turnNotices.push(...await draconicPresenceTick(ctx, q, campaignId, userId, sceneId, characterId));
          areaNotices = [...areaNotices, ...await triggers.fireTurnStart(q, campaignId, await getScene(q, campaignId, sceneId, false), userId, characterId)];
        }

        if (wrapped) {
          await q.query(
            'UPDATE scenes SET combat_round=combat_round+1 WHERE id=$1',
            [sceneId],
          );
          await q.query('DELETE FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND reflex_of IS NOT NULL AND NOT is_current', [campaignId, sceneId]);

          if (await tickRoundTimers(q, campaignId, sceneId)) {
            await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
            return true;
          }
        }

        return false;
      });

      void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
      if (timersTicked) void notify(ctx, campaignId, sceneId);
      triggers.send(campaignId, areaNotices);
      if (turnNotices.length) {
        void notifyCampaign(ctx, campaignId, { type: 'rolls' });
        void notify(ctx, campaignId, sceneId);
        announceConditionNotices(ctx, campaignId, turnNotices);
      }
      try {
        await autoLegendary(ctx, campaignId, sceneId, endedIds, startedIds);
      } catch {
      }

      return reply.code(204).send();
    },
  );
}
