import type { Queryable } from '../../../db.ts';
import { incapacitatedReason } from '../../../../../../packages/domain/combat/conditions.ts';
import { footprintCells } from '../../../../../../packages/domain/map/footprint.ts';
import { addCondition, loadConditionState } from '../../../rules/conditions.ts';
import type { TableContext } from '../../context.ts';
import { notifyCampaign } from '../../live/notify.ts';
import { getScene } from '../board.ts';
import { climbSpeedFrom, diagonalRule, movementGrid, spendClimb } from '../movement.ts';
import { canManageCharacter } from '../placements.ts';
import { type CampaignParams, canManage, objectSchema, reject, uuid } from '../../shared.ts';

export async function climbSpeedOf(q: Queryable, campaignId: string, characterId: string): Promise<{ feet: number; bySpell: boolean }> {
  const row = (await q.query('SELECT speed_feet::float8 AS speed_feet, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0];
  if (!row) return { feet: 0, bySpell: false };
  const spider = (await q.query(`SELECT parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='spider_climb' LIMIT 1`, [campaignId, characterId])).rows[0];
  const natural = climbSpeedFrom(row.sheet_extra);
  const spell = spider ? Number(spider.parameters?.feet ?? 0) || Number(row.speed_feet ?? 30) : 0;
  return { feet: Math.max(natural, spell), bySpell: natural <= 0 && spell > 0 };
}

function segmentDistance(px: number, pz: number, edge: { x1: number; z1: number; x2: number; z2: number }) {
  const dx = edge.x2 - edge.x1, dz = edge.z2 - edge.z1;
  const length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((px - edge.x1) * dx + (pz - edge.z1) * dz) / length)) : 0;
  return Math.hypot(edge.x1 + dx * t - px, edge.z1 + dz * t - pz);
}

export async function besideWall(q: Queryable, campaignId: string, scene: any, characterId: string, at: { x: number; z: number }, size: string) {
  const grid = await movementGrid(q, campaignId, scene, placement => placement.character_id === characterId, size, await diagonalRule(q, campaignId));
  const reach = footprintCells(size) / 2 + 1e-6;
  return grid.edges.some(edge => segmentDistance(at.x, at.z, edge) <= reach);
}

export function registerClimbingRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.put<{ Params: CampaignParams & { characterId: string }; Body: { on: boolean; height?: number; sceneId: string } }>(
    '/campaigns/:campaignId/characters/:characterId/climbing',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, characterId: uuid }),
        body: objectSchema({ on: { type: 'boolean' }, height: { type: 'integer', minimum: 0, maximum: 200 }, sceneId: uuid }, ['on', 'sceneId']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { on, sceneId } = request.body;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const row = (await q.query('SELECT id, name, size, owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, characterId])).rows[0] as any;
        if (!row) reject(404, 'Существо не найдено.');
        if (!(await canManageCharacter(q, member, userId, row.owner_user_id, row.id))) reject(403, 'Лезть может тот, чьё это существо, или мастер.');
        const holding = (await q.query(`SELECT id, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='climbing' LIMIT 1`, [campaignId, characterId])).rows[0] as { id: string; parameters: any } | undefined;
        if (!on) {
          if (holding) await q.query('DELETE FROM character_effects WHERE id=$1', [holding.id]);
          return { name: row.name as string, climbing: false, height: 0 };
        }
        const scene = await getScene(q, campaignId, sceneId, false);
        const placement = (await q.query('SELECT x, z FROM scene_objects WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3 AND parent_object_id IS NULL', [campaignId, sceneId, characterId])).rows[0];
        if (!placement) reject(400, `${row.name} не стоит на этой сцене.`);
        if (!(await besideWall(q, campaignId, scene, characterId, { x: Number(placement.x), z: Number(placement.z) }, row.size))) reject(400, `${row.name}: рядом нет стены или преграды, по которой лезть, — подойдите вплотную.`);
        const state = await loadConditionState(q, campaignId, characterId);
        const unable = incapacitatedReason(state);
        if (unable) reject(400, `${row.name} не может лезть: ${unable}.`);
        if (['grappled', 'restrained', 'prone'].some(code => state.codes.has(code))) reject(400, `${row.name} схвачен, опутан или лежит — не лезть.`);
        if (state.codes.has('flying') || state.codes.has('dragon_wings')) reject(400, `${row.name} летит — сперва приземлитесь.`);
        const { feet: speed, bySpell } = await climbSpeedOf(q, campaignId, characterId);
        const height = request.body.height ?? 10;
        const from = Number(holding?.parameters?.height ?? 0);
        const cost = Math.abs(height - from) * (speed > 0 ? 1 : 2);
        await spendClimb(ctx, q, campaignId, characterId, cost, await canManage(q, member, userId), 0);
        if (height === 0) {
          if (holding) await q.query('DELETE FROM character_effects WHERE id=$1', [holding.id]);
          return { name: row.name as string, climbing: false, height: 0 };
        }
        if (holding) await q.query('UPDATE character_effects SET parameters = parameters || $2::jsonb WHERE id=$1', [holding.id, JSON.stringify({ height, feet: speed, bySpell })]);
        else await addCondition(q, campaignId, characterId, 'climbing', { source: 'feature', sourceName: speed > 0 ? 'Лазание' : 'Лазание без скорости лазания', feet: speed, height, bySpell });
        return { name: row.name as string, climbing: true, height, slow: speed <= 0 };
      });
      void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
      void notifyCampaign(ctx, campaignId, { type: 'changed' });
      return {
        climbing: result.climbing, height: result.height,
        message: !result.climbing ? `${result.name} на земле.`
          : 'slow' in result && result.slow ? `${result.name}: на стене, высота ${result.height} фут. Без скорости лазания каждый фут вверх стоит два.`
          : `${result.name}: на стене, высота ${result.height} фут.`,
      };
    },
  );
}
