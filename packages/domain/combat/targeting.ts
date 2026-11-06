import { footprintEdges, pathBlocked } from '../map/blockers.ts';
import type { WallSegment } from '../map/los.ts';

export type WeaponRanges = { kind: 'melee' | 'ranged'; reach: number; normal: number | null; long: number | null };

export type RangeBand =
  | { ok: true; ranged: boolean; long: boolean }
  | { ok: false; limit: number };

export function rangeBand(weapon: WeaponRanges, distance: number): RangeBand {
  if (weapon.kind === 'melee') {
    if (distance <= weapon.reach) return { ok: true, ranged: false, long: false };
    if (weapon.normal === null) return { ok: false, limit: weapon.reach };
    const long = weapon.long ?? weapon.normal;
    if (distance <= weapon.normal) return { ok: true, ranged: true, long: false };
    if (distance <= long) return { ok: true, ranged: true, long: true };
    return { ok: false, limit: long };
  }
  const normal = weapon.normal ?? weapon.reach;
  const long = weapon.long ?? normal;
  if (distance <= normal) return { ok: true, ranged: true, long: false };
  if (distance <= long) return { ok: true, ranged: true, long: true };
  return { ok: false, limit: long };
}

export type Square = { x: number; z: number; size: number };
export type Cover = 'none' | 'half' | 'three-quarters' | 'total';

const COVER_ORDER: Cover[] = ['none', 'half', 'three-quarters', 'total'];
export const COVER_AC: Record<Cover, number> = { none: 0, half: 2, 'three-quarters': 5, total: 0 };
export const COVER_LABELS: Record<Cover, string> = {
  none: 'нет', half: 'половинное', 'three-quarters': 'на три четверти', total: 'полное',
};

const INSET = 0.1;
function corners(square: Square) {
  const h = Math.max(0.05, square.size / 2 - INSET);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, dz]) => ({ x: square.x + dx! * h, z: square.z + dz! * h }));
}

export function coverBetween(attacker: Square, target: Square, walls: WallSegment[], creatures: Square[]): Cover {
  const creatureEdges = creatures.flatMap(square => footprintEdges(square.x, square.z, Math.max(0.1, square.size - 2 * INSET)));
  let best: Cover = 'total';
  for (const from of corners(attacker)) {
    let byWalls = 0;
    let byCreatures = 0;
    for (const to of corners(target)) {
      if (pathBlocked(from, to, walls)) byWalls += 1;
      else if (creatureEdges.length && pathBlocked(from, to, creatureEdges)) byCreatures += 1;
    }
    const level: Cover = byWalls === 4 ? 'total' : byWalls === 3 ? 'three-quarters' : byWalls + byCreatures > 0 ? 'half' : 'none';
    if (COVER_ORDER.indexOf(level) < COVER_ORDER.indexOf(best)) best = level;
    if (best === 'none') break;
  }
  return best;
}
