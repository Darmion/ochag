import type { Queryable } from '../../db.ts';
import { insertChatMessage } from '../../campaign/chat-routes.ts';
import { loadEffects } from '../conditions.ts';
import { reject, objectSchema, uuid } from '../../tabletop/scene-feature.ts';
import { type LegendaryOption, type BossPhase, BOSS_TEMPLATE, type BossSettings, bossProblems } from '../../../../../packages/domain/character/class-features.ts';
import { incapacitatedReason, conditionState } from '../../../../../packages/domain/combat/conditions.ts';

import { type ClassFeatureContext, syncLegendaryResistance } from '../class-features.ts';
import { characterParams } from './helpers.ts';

export const optionSchema = {
  type: 'object', additionalProperties: false, required: ['name', 'cost'],
  properties: { name: { type: 'string', maxLength: 80 }, cost: { type: 'integer', minimum: 1, maximum: 3 }, text: { type: 'string', maxLength: 500 } },
};
export const phaseSchema = {
  type: 'object', additionalProperties: false, required: ['atPercent', 'title'],
  properties: {
    atPercent: { type: 'integer', minimum: 1, maximum: 99 }, title: { type: 'string', maxLength: 80 },
    text: { type: 'string', maxLength: 500 }, public: { type: 'boolean' }, done: { type: 'boolean' },
  },
};

export async function bossOwner(ctx: ClassFeatureContext, q: Queryable, campaignId: string, characterId: string, userId: string, lock = false) {
  const { canManage, isCharacterManager, membership } = ctx;
  const member = await membership(q, campaignId, userId, lock);
  if (!(await isCharacterManager(q, member, userId)) && !(await canManage(q, member, userId))) reject(403, 'Боссов настраивает мастер.');
  const row = (
    await q.query(`SELECT id, name, kind, legendary_actions, legendary_options, boss_phases, legendary_resistances FROM characters WHERE campaign_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [campaignId, characterId])
  ).rows[0] as any;
  if (!row) reject(404, 'Существо не найдено.');
  return row;
}

export const bossView = (row: any) => ({
  legendaryActions: Number(row.legendary_actions ?? 0),
  options: (row.legendary_options ?? []) as LegendaryOption[],
  phases: (row.boss_phases ?? []) as BossPhase[],
  legendaryResistances: Number(row.legendary_resistances ?? 0),
  template: BOSS_TEMPLATE,
});

export function registerBossRoutes(ctx: ClassFeatureContext) {
  const { app, auth, canManage, db, membership, notifyCampaign } = ctx;

  app.get<{ Params: { campaignId: string; characterId: string } }>(
    '/campaigns/:campaignId/characters/:characterId/boss',
    { schema: { params: characterParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      return bossView(await bossOwner(ctx, db, campaignId, characterId, userId));
    },
  );

  app.put<{ Params: { campaignId: string; characterId: string }; Body: BossSettings }>(
    '/campaigns/:campaignId/characters/:characterId/boss',
    {
      schema: {
        params: characterParams,
        body: {
          type: 'object', additionalProperties: false, required: ['legendaryActions', 'options', 'phases'],
          properties: {
            legendaryActions: { type: 'integer', minimum: 0, maximum: 5 },
            legendaryResistances: { type: 'integer', minimum: 0, maximum: 5 },
            options: { type: 'array', maxItems: 10, items: optionSchema },
            phases: { type: 'array', maxItems: 5, items: phaseSchema },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const settings: BossSettings = {
        legendaryActions: request.body.legendaryActions,
        ...(request.body.legendaryResistances !== undefined ? { legendaryResistances: request.body.legendaryResistances } : {}),
        options: request.body.options.map(option => ({ name: option.name.trim(), cost: option.cost, text: (option.text ?? '').trim() })),
        phases: request.body.phases
          .map(phase => ({ atPercent: phase.atPercent, title: phase.title.trim(), text: (phase.text ?? '').trim(), public: phase.public !== false, done: phase.done === true }))
          .sort((a, b) => b.atPercent - a.atPercent),
      };
      const problems = bossProblems(settings);
      if (problems.length) reject(400, problems.join(' '));

      const { row, scenes } = await db.transaction(async q => {
        const row = await bossOwner(ctx, q, campaignId, characterId, userId, true);
        if (row.kind !== 'npc') reject(400, 'Боссом может быть только НПС.');
        const updated = (
          await q.query(
            `UPDATE characters SET legendary_actions=$3, legendary_options=$4::jsonb, boss_phases=$5::jsonb,
               legendary_resistances=COALESCE($6::smallint, legendary_resistances), revision=revision+1
             WHERE campaign_id=$1 AND id=$2 RETURNING id, name, kind, legendary_actions, legendary_options, boss_phases, legendary_resistances`,
            [campaignId, characterId, settings.legendaryActions, JSON.stringify(settings.options), JSON.stringify(settings.phases), settings.legendaryResistances ?? null],
          )
        ).rows[0];
        await syncLegendaryResistance(q, campaignId, characterId, Number(updated.legendary_resistances ?? 0));
        const scenes = (await q.query('SELECT DISTINCT scene_id FROM initiative_entries WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId])).rows.map(entry => entry.scene_id as string);
        return { row: updated, scenes };
      });
      for (const sceneId of scenes) void notifyCampaign(campaignId, { type: 'initiative', sceneId });
      void notifyCampaign(campaignId, { type: 'character', characterId });
      return bossView(row);
    },
  );

  app.post<{ Params: { campaignId: string; sceneId: string; entryId: string }; Body: { option: number; targetCharacterId?: string } }>(
    '/campaigns/:campaignId/scenes/:sceneId/initiative/:entryId/legendary',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, sceneId: uuid, entryId: uuid }),
        body: objectSchema({ option: { type: 'integer', minimum: 0, maximum: 9 }, targetCharacterId: uuid }, ['option']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId, entryId } = request.params;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Легендарные действия выбирает мастер.');
        const row = (
          await q.query(
            `SELECT ie.id, ie.is_current, ie.legendary_used, c.id AS character_id, c.name, c.legendary_actions, c.legendary_options
             FROM initiative_entries ie
             JOIN characters c ON c.campaign_id = ie.campaign_id AND c.id = ie.character_id
             WHERE ie.campaign_id=$1 AND ie.scene_id=$2 AND ie.id=$3
             FOR UPDATE OF ie`,
            [campaignId, sceneId, entryId],
          )
        ).rows[0] as any;
        if (!row) reject(404, 'Записи существа в инициативе нет.');
        const max = Number(row.legendary_actions ?? 0);
        if (max <= 0) reject(400, `У «${row.name}» нет легендарных действий.`);
        if (row.is_current) reject(400, 'Легендарное действие — в конце хода другого существа, не в свой ход.');
        const unable = incapacitatedReason(conditionState((await loadEffects(q, campaignId, row.character_id)).map(effect => effect.effect_code)));
        if (unable) reject(400, `${row.name} не может действовать: ${unable}.`);
        const option = ((row.legendary_options ?? []) as LegendaryOption[])[request.body.option];
        if (!option) reject(400, 'Такого легендарного действия нет.');
        const left = max - Number(row.legendary_used ?? 0);
        if (option.cost > left) reject(400, `«${row.name}»: осталось ${left} из ${max} легендарных действий, а «${option.name}» стоит ${option.cost}.`);
        await q.query('UPDATE initiative_entries SET legendary_used=legendary_used+$2 WHERE id=$1', [entryId, option.cost]);
        const cost = option.cost > 1 ? ` (стоит ${option.cost})` : '';
        const message = await insertChatMessage(q, campaignId, userId, {
          characterId: row.character_id, body: `Легендарное действие: ${option.name}${cost}${option.text ? ` — ${option.text}` : ''}`,
        });
        return { characterId: row.character_id as string, used: Number(row.legendary_used ?? 0) + option.cost, max, option, message };
      });

      void notifyCampaign(campaignId, { type: 'initiative', sceneId });
      void notifyCampaign(campaignId, { type: 'chat', message: result.message });
      void notifyCampaign(campaignId, { type: 'float', characterId: result.characterId, text: result.option.name, tone: 'crit' });
      const strike = ctx.legendaryStrike
        ? await ctx.legendaryStrike(campaignId, sceneId, result.characterId, result.option, request.body.targetCharacterId ? [request.body.targetCharacterId] : [])
        : null;
      return {
        used: result.used, max: result.max, left: result.max - result.used, option: result.option,
        ...(strike ?? {}),
      };
    },
  );
}
