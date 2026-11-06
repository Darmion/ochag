import type { Queryable } from '../../db.ts';
import { type Cover, coverBetween, COVER_AC, COVER_LABELS } from '../../../../../packages/domain/combat/targeting.ts';
import { footprintCells } from '../../../../../packages/domain/map/footprint.ts';

import { campaignFlag } from '../rolls/dice.ts';
import { sceneWalls } from '../scene/board.ts';
import { blockingPlacements, loadPlacements } from '../scene/placements.ts';
import type { Placement, SaveBonus } from '../shared.ts';

export async function areaCovers(
  q: Queryable, campaignId: string, scene: any, origin: { x: number; z: number }, placements?: Placement[],
): Promise<Map<string, Cover>> {
  const covers = new Map<string, Cover>();
  const coverRule = (await campaignFlag(q, campaignId, 'cover')) !== false;
  const all = placements ?? await loadPlacements(q, campaignId, scene.id);
  const walls = await sceneWalls(q, campaignId, scene.id, 'move');
  const edges = [...walls, ...(await blockingPlacements(q, campaignId, scene, all, 'move')).flatMap(blocker => blocker.edges)];
  const square = (entry: Placement) => ({ x: entry.world_x, z: entry.world_z, size: footprintCells(entry.size) });
  const creatures = all.filter(entry => entry.kind !== 'object' && !entry.parent_object_id);
  const atOrigin = (entry: Placement) => {
    const half = footprintCells(entry.size) / 2;
    return Math.abs(entry.world_x - origin.x) <= half + 1e-9 && Math.abs(entry.world_z - origin.z) <= half + 1e-9;
  };
  const between = creatures.filter(entry => !atOrigin(entry));
  for (const entry of creatures) {
    const others = coverRule ? between.filter(other => other.id !== entry.id).map(square) : [];
    const cover = coverBetween({ x: origin.x, z: origin.z, size: 0 }, square(entry), edges, others);
    if (coverRule || cover === 'total') covers.set(entry.character_id, cover);
  }
  return covers;
}

export function areaCoverBonus(cover: Cover | undefined, ability: string): SaveBonus | null {
  if (!cover || ability !== 'dexterity' || cover === 'none' || cover === 'total') return null;
  return { value: COVER_AC[cover], reason: `укрытие от области: ${COVER_LABELS[cover]} (+${COVER_AC[cover]} к спасброску ЛОВ)` };
}

export function coverReason(cover: Cover) {
  return `укрытие цели: ${COVER_LABELS[cover]} (+${COVER_AC[cover]} КД)`;
}

export async function wallCover(
  q: Queryable, campaignId: string, sceneId: string, scene: any, placements: Placement[], attacker: Placement, target: Placement, withCreatures: boolean,
): Promise<Cover> {
  const walls = await sceneWalls(q, campaignId, sceneId, 'move');
  const blockers = await blockingPlacements(q, campaignId, scene, placements, 'move');
  const square = (entry: Placement) => ({ x: entry.world_x, z: entry.world_z, size: footprintCells(entry.size) });
  const creatures = withCreatures
    ? placements.filter(entry => entry.kind !== 'object' && entry.id !== attacker.id && entry.id !== target.id && !entry.parent_object_id)
    : [];
  return coverBetween(square(attacker), square(target), [...walls, ...blockers.flatMap(blocker => blocker.edges)], creatures.map(square));
}
