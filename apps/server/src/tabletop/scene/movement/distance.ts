import type { Queryable } from '../../../db.ts';
import { pathBlocked } from '../../../../../../packages/domain/map/blockers.ts';
import { footprintCells } from '../../../../../../packages/domain/map/footprint.ts';
import type { TableContext } from '../../context.ts';
import { feetBetween, getScene, halfBoundsFor } from '../board.ts';
import { loadPlacements } from '../placements.ts';
import { diagonalRule, movementGrid } from './grid.ts';

export async function withinFeet(q: Queryable, campaignId: string, sceneId: string, aId: string, bId: string, feet: number): Promise<boolean | null> {
  const scene = (await q.query('SELECT width_cells, height_cells, feet_per_unit FROM scenes WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId])).rows[0];
  if (!scene) return null;
  const placements = await loadPlacements(q, campaignId, sceneId);
  const a = placements.find(placement => placement.character_id === aId);
  const b = placements.find(placement => placement.character_id === bId);
  if (!a || !b) return null;
  return feetBetween(scene, a, b) <= feet + 1e-6;
}

export async function withinFeetDistance(ctx: TableContext, campaignId: string, sceneId: string, a: string, b: string) {
  const { db } = ctx;
  const scene = await getScene(db, campaignId, sceneId, false);
  const placements = await loadPlacements(db, campaignId, sceneId);
  const first = placements.find(entry => entry.character_id === a && !entry.parent_object_id);
  const second = placements.find(entry => entry.character_id === b && !entry.parent_object_id);
  return first && second ? feetBetween(scene, first, second) : null;
}

export async function pushAway(q: Queryable, campaignId: string, sceneId: string, fromId: string, targetId: string, feet: number): Promise<number> {
  const scene = await getScene(q, campaignId, sceneId, false);
  const placements = await loadPlacements(q, campaignId, sceneId);
  const from = placements.find(entry => entry.character_id === fromId && !entry.parent_object_id);
  const target = placements.find(entry => entry.character_id === targetId && !entry.parent_object_id);
  if (!from || !target || target.kind === 'object') return 0;
  const dx = target.world_x - from.world_x;
  const dz = target.world_z - from.world_z;
  const longest = Math.max(Math.abs(dx), Math.abs(dz));
  if (longest < 1e-9) return 0;
  const walls = (await movementGrid(q, campaignId, scene, entry => entry.character_id === targetId, target.size, await diagonalRule(q, campaignId))).edges;
  const { halfWidth, halfHeight } = halfBoundsFor(scene);
  const half = footprintCells(target.size) / 2;
  const others = placements.filter(entry => !entry.parent_object_id && entry.kind !== 'object' && entry.character_id !== targetId);
  for (let step = Math.floor(feet / scene.feet_per_unit); step >= 1; step -= 1) {
    const to = { x: target.world_x + Math.round((dx / longest) * step), z: target.world_z + Math.round((dz / longest) * step) };
    if (Math.abs(to.x) + half > halfWidth + 1e-9 || Math.abs(to.z) + half > halfHeight + 1e-9) continue;
    if (pathBlocked({ x: target.world_x, z: target.world_z }, to, walls)) continue;
    if (others.some(entry => Math.abs(entry.world_x - to.x) < half + footprintCells(entry.size) / 2 - 1e-9 && Math.abs(entry.world_z - to.z) < half + footprintCells(entry.size) / 2 - 1e-9)) continue;
    await q.query('UPDATE scene_objects SET x=$3, z=$4, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, target.id, to.x, to.z]);
    await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
    return step * scene.feet_per_unit;
  }
  return 0;
}
