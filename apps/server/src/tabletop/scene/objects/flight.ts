import { loadConditionState, removeCondition, addCondition } from '../../../rules/conditions.ts';
import { incapacitatedReason } from '../../../../../../packages/domain/combat/conditions.ts';
import type { TableContext } from '../../context.ts';
import { notifyCampaign } from '../../live/notify.ts';
import { naturalFlySpeed, spendClimb } from '../movement.ts';
import { canManageCharacter } from '../placements.ts';
import { type CampaignParams, canManage, objectSchema, reject, uuid } from '../../shared.ts';

export function registerFlightRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.put<{ Params: CampaignParams & { characterId: string }; Body: { on: boolean; height?: number } }>(
    '/campaigns/:campaignId/characters/:characterId/flying',
    { schema: { params: objectSchema({ campaignId: uuid, characterId: uuid }), body: objectSchema({ on: { type: 'boolean' }, height: { type: 'integer', minimum: 0, maximum: 1000 } }, ['on']) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const row = (await q.query('SELECT id, name, kind, owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, characterId])).rows[0] as any;
        if (!row) reject(404, 'Существо не найдено.');
        if (!(await canManageCharacter(q, member, userId, row.owner_user_id, row.id))) reject(403, 'Летать может тот, чьё это существо, или мастер.');
        if (!request.body.on) {
          const landed = (await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='flying' RETURNING id`, [campaignId, characterId])).rows.length;
          return { name: row.name as string, flying: false, changed: landed > 0, feet: 0, height: 0 };
        }
        const aloft = (
          await q.query(`SELECT id, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('flying', 'dragon_wings') ORDER BY effect_code DESC LIMIT 1`, [campaignId, characterId])
        ).rows[0] as { id: string; parameters: any } | undefined;
        if (aloft && request.body.height !== undefined) {
          const climbed = await spendClimb(ctx, q, campaignId, characterId, Math.abs(request.body.height - Number(aloft.parameters?.height ?? 0)), await canManage(q, member, userId), 0);
          await q.query(`UPDATE character_effects SET parameters = parameters || $2::jsonb WHERE id=$1`, [aloft.id, JSON.stringify({ height: request.body.height })]);
          return { name: row.name as string, flying: true, changed: true, feet: Number(aloft.parameters?.feet ?? 0), height: request.body.height, climbed };
        }
        const feet = await naturalFlySpeed(q, campaignId, characterId);
        if (feet <= 0) reject(400, `${row.name} не летает сам — нужен «Полёт» или крылья.`);
        const unable = incapacitatedReason(await loadConditionState(q, campaignId, characterId));
        if (unable) reject(400, `${row.name} не может взлететь: ${unable}.`);
        const state = await loadConditionState(q, campaignId, characterId);
        if (['grappled', 'restrained'].some(code => state.codes.has(code))) reject(400, `${row.name} схвачен или опутан — не взлететь.`);
        await removeCondition(q, campaignId, characterId, 'prone');
        const height = request.body.height ?? 10;
        const climbed = await spendClimb(ctx, q, campaignId, characterId, height, await canManage(q, member, userId), feet);
        await addCondition(q, campaignId, characterId, 'flying', { source: 'feature', sourceName: 'Полёт', feet, height });
        return { name: row.name as string, flying: true, changed: true, feet, height, climbed };
      });
      void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
      void notifyCampaign(ctx, campaignId, { type: 'changed' });
      return {
        flying: result.flying, feet: result.feet, height: result.height,
        message: result.flying ? `${result.name}: в воздухе, высота ${result.height} фут.${result.feet ? ` (полёт ${result.feet} фут.)` : ''}.` : `${result.name} приземляется.`,
      };
    },
  );
}
