import type { Queryable } from '../../../db.ts';
import { pathBlocked } from '../../../../../../packages/domain/map/blockers.ts';
import { footprintCells } from '../../../../../../packages/domain/map/footprint.ts';
import type { TableContext } from '../../context.ts';
import { fallFeet } from '../../../../../../packages/domain/map/relief.ts';
import { feetBetween, getScene, groundOfPlacement, halfBoundsFor } from '../board.ts';
import { loadPlacements } from '../placements.ts';
import { diagonalRule, movementGrid } from './grid.ts';

export async function withinFeet(q: Queryable, campaignId: string, sceneId: string, aId: string, bId: string, feet: number): Promise<boolean | null> {
  const scene = (await q.query('SELECT width_cells, height_cells, feet_per_unit, elevation_cells FROM scenes WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId])).rows[0];
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

export type Push = { feet: number; drop: number };
export type Fall = (characterId: string, feet: number) => Promise<unknown>;

// A forced move down a ledge of 10 feet or more is a fall; a flyer or a climber on a wall keeps its height.
export async function pushAway(
  q: Queryable, campaignId: string, sceneId: string, fromId: string, targetId: string, feet: number, toward = false, fall?: Fall,
): Promise<Push> {
  const scene = await getScene(q, campaignId, sceneId, false);
  const placements = await loadPlacements(q, campaignId, sceneId);
  const from = placements.find(entry => entry.character_id === fromId && !entry.parent_object_id);
  const target = placements.find(entry => entry.character_id === targetId && !entry.parent_object_id);
  if (!from || !target || target.kind === 'object') return { feet: 0, drop: 0 };
  const dx = (target.world_x - from.world_x) * (toward ? -1 : 1);
  const dz = (target.world_z - from.world_z) * (toward ? -1 : 1);
  const longest = Math.max(Math.abs(dx), Math.abs(dz));
  if (longest < 1e-9) return { feet: 0, drop: 0 };
  const gap = Math.max(0, Math.floor(longest - (footprintCells(target.size) + footprintCells(from.size)) / 2 + 1e-9));
  const walls = (await movementGrid(q, campaignId, scene, entry => entry.character_id === targetId, target.size, await diagonalRule(q, campaignId))).edges;
  const { halfWidth, halfHeight } = halfBoundsFor(scene);
  const half = footprintCells(target.size) / 2;
  const others = placements.filter(entry => !entry.parent_object_id && entry.kind !== 'object' && entry.character_id !== targetId);
  for (let step = Math.min(Math.floor(feet / scene.feet_per_unit), toward ? gap : Infinity); step >= 1; step -= 1) {
    const to = { x: target.world_x + Math.round((dx / longest) * step), z: target.world_z + Math.round((dz / longest) * step) };
    if (Math.abs(to.x) + half > halfWidth + 1e-9 || Math.abs(to.z) + half > halfHeight + 1e-9) continue;
    if (pathBlocked({ x: target.world_x, z: target.world_z }, to, walls)) continue;
    if (others.some(entry => Math.abs(entry.world_x - to.x) < half + footprintCells(entry.size) / 2 - 1e-9 && Math.abs(entry.world_z - to.z) < half + footprintCells(entry.size) / 2 - 1e-9)) continue;
    await q.query('UPDATE scene_objects SET x=$3, z=$4, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, target.id, to.x, to.z]);
    await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
    const aloft = Number(target.altitude_feet ?? 0) > 0 || (await q.query(
      `SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('flying', 'dragon_wings', 'climbing') LIMIT 1`,
      [campaignId, targetId],
    )).rows.length > 0;
    const drop = aloft ? 0 : fallFeet(groundOfPlacement(scene, target), groundOfPlacement(scene, { world_x: to.x, world_z: to.z, size: target.size }));
    if (drop > 0 && fall) await fall(targetId, drop);
    return { feet: step * scene.feet_per_unit, drop };
  }
  return { feet: 0, drop: 0 };
}
