import type { Queryable } from '../../../db.ts';
import { pathBlocked } from '../../../../../../packages/domain/map/blockers.ts';
import { dragSlows, movesTowardFear } from '../../../../../../packages/domain/combat/grapple-fear.ts';
import type { Notice } from '../scene-triggers.ts';
import { loadConditionState, releaseGrapples, releaseNotices } from '../../../rules/conditions.ts';
import { occupiedCells, footprintCells } from '../../../../../../packages/domain/map/footprint.ts';
import { anyCellCutByWall, feetBetween, sceneWalls } from '../board.ts';
import { loadPlacements } from '../placements.ts';
import { type Placement, reject } from '../../shared.ts';
import { creatureCells } from './cells.ts';

export async function fearSourceInSight(q: Queryable, campaignId: string, characterId: string, sourceIds: string[], blinded: boolean) {
  if (blinded) return false;
  const scenes = (
    await q.query(
      `SELECT DISTINCT scene_id FROM scene_objects WHERE campaign_id=$1 AND character_id = ANY($2::uuid[]) AND parent_object_id IS NULL`,
      [campaignId, [characterId, ...sourceIds]],
    )
  ).rows.map(row => row.scene_id as string);
  for (const sceneId of scenes) {
    const placements = await loadPlacements(q, campaignId, sceneId);
    const self = placements.find(entry => entry.character_id === characterId && !entry.parent_object_id);
    if (!self) continue;
    const walls = await sceneWalls(q, campaignId, sceneId, 'sight');
    for (const sourceId of sourceIds) {
      const source = placements.find(entry => entry.character_id === sourceId && !entry.parent_object_id);
      if (!source) continue;
      if ((await loadConditionState(q, campaignId, sourceId)).codes.has('invisible')) continue;
      if (!pathBlocked({ x: self.world_x, z: self.world_z }, { x: source.world_x, z: source.world_z }, walls)) return true;
    }
  }
  return false;
}

export async function draggedBy(q: Queryable, campaignId: string, scene: any, grapplerId: string) {
  const held = (
    await q.query(
      `SELECT character_id FROM character_effects
         WHERE campaign_id=$1 AND effect_code='grappled' AND active AND parameters->>'sourceCharacterId' = $2`,
      [campaignId, grapplerId],
    )
  ).rows.map(row => row.character_id as string);
  if (!held.length) return [];
  return (await loadPlacements(q, campaignId, scene.id)).filter(entry => held.includes(entry.character_id) && !entry.parent_object_id);
}

export async function dragFactor(q: Queryable, campaignId: string, scene: any, characterId: string, size: string | null) {
  const dragged = await draggedBy(q, campaignId, scene, characterId);
  return dragged.some(entry => dragSlows(size, entry.size)) ? 2 : 1;
}

export async function dragAlong(
  q: Queryable, campaignId: string, scene: any, grappler: { id: string; character_id: string; name: string },
  from: { x: number; z: number }, to: { x: number; z: number },
): Promise<Notice[]> {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (!dx && !dz) return [];
  const dragged = await draggedBy(q, campaignId, scene, grappler.character_id);
  if (!dragged.length) return [];
  const walls = await sceneWalls(q, campaignId, scene.id);
  const notices: Notice[] = [];
  for (const entry of dragged) {
    const x = entry.world_x + dx;
    const z = entry.world_z + dz;
    const n = footprintCells(entry.size);
    const cells = occupiedCells(scene, x, z, n);
    const onBoard = cells.length === n * n && cells.every(cell => cell.col >= 0 && cell.row >= 0 && cell.col < scene.width_cells && cell.row < scene.height_cells);
    const others = await creatureCells(q, campaignId, scene, entry.id);
    const blocked = !onBoard || anyCellCutByWall(scene, x, z, n, walls) || Boolean(others && cells.some(cell => others.has(`${cell.col}:${cell.row}`)));
    if (blocked) continue;
    await q.query('UPDATE scene_objects SET x=$3, z=$4, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, entry.id, x, z]);
    notices.push({ title: `${grappler.name} тащит «${entry.name}»`, detail: 'Схваченный едет следом; движение схватившего стоит вдвое.', characterId: entry.character_id, secret: entry.hidden } as Notice);
  }
  return notices;
}

export async function assertNotTowardFear(
  q: Queryable, campaignId: string, scene: any,
  mover: { character_id: string; name: string; size: string; world_x: number; world_z: number }, to: { x: number; z: number },
) {
  if (mover.world_x === to.x && mover.world_z === to.z) return;
  const sources = (
    await q.query(
      `SELECT DISTINCT parameters->>'sourceCharacterId' AS source_id FROM character_effects
         WHERE campaign_id=$1 AND character_id=$2 AND effect_code='frightened' AND active AND parameters->>'sourceCharacterId' IS NOT NULL`,
      [campaignId, mover.character_id],
    )
  ).rows.map(row => row.source_id as string);
  if (!sources.length) return;
  if ((await loadConditionState(q, campaignId, mover.character_id)).codes.has('blinded')) return;
  const placements = await loadPlacements(q, campaignId, scene.id);
  const walls = await sceneWalls(q, campaignId, scene.id, 'sight');
  for (const sourceId of sources) {
    const source = placements.find(entry => entry.character_id === sourceId && !entry.parent_object_id);
    if (!source) continue;
    if ((await loadConditionState(q, campaignId, sourceId)).codes.has('invisible')) continue;
    if (pathBlocked({ x: mover.world_x, z: mover.world_z }, { x: source.world_x, z: source.world_z }, walls)) continue;
    const self = mover as unknown as Placement;
    const before = feetBetween(scene, self, source);
    const after = feetBetween(scene, { ...self, world_x: to.x, world_z: to.z }, source);
    if (movesTowardFear(before, after)) {
      reject(400, `${mover.name} в страхе перед «${source.name}» — ближе к нему не подойти, пока его видно (отойти или обойти — можно).`);
    }
  }
}

export async function releaseDistantGrapples(q: Queryable, campaignId: string, scene: any, movedCharacterId: string): Promise<Notice[]> {
  const holds = (
    await q.query(
      `SELECT character_id, parameters->>'sourceCharacterId' AS grappler_id FROM character_effects
         WHERE campaign_id=$1 AND effect_code='grappled' AND active AND parameters->>'sourceCharacterId' IS NOT NULL
           AND (character_id=$2::uuid OR parameters->>'sourceCharacterId' = $3)`,
      [campaignId, movedCharacterId, movedCharacterId],
    )
  ).rows as Array<{ character_id: string; grappler_id: string }>;
  if (!holds.length) return [];
  const placements = await loadPlacements(q, campaignId, scene.id);
  const standing = (id: string) => placements.find(entry => entry.character_id === id && !entry.parent_object_id);
  const notices: Notice[] = [];
  for (const hold of holds) {
    const grappled = standing(hold.character_id);
    const grappler = standing(hold.grappler_id);
    if (!grappled || !grappler) continue;
    const longest = (
      await q.query(
        `SELECT MAX(range_feet)::float8 AS reach FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND weapon_kind='melee'`,
        [campaignId, grappler.character_id],
      )
    ).rows[0]?.reach;
    const reach = Math.max(5, Number(longest ?? 5));
    if (feetBetween(scene, grappler, grappled) <= reach) continue;
    const freed = await releaseGrapples(q, campaignId, grappler.character_id, [grappled.character_id]);
    const secret = grappler.hidden || grappled.hidden;
    notices.push(...releaseNotices(grappler.name, freed, 'слишком далеко').map(notice => ({ ...notice, secret })));
  }
  return notices;
}
