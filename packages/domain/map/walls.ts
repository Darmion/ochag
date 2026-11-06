import { pathBlocked } from './blockers.ts';
import type { WallSegment } from './los.ts';

export type WallKind = 'wall' | 'door' | 'window';
export type WallLike = {
  x1: number; z1: number; x2: number; z2: number;
  kind?: WallKind | null; open?: boolean | null; broken?: boolean | null; style?: string | null;
};

export const WALL_KINDS: WallKind[] = ['wall', 'door', 'window'];

export function blocksMove(wall: WallLike): boolean {
  if (wall.broken) return false;
  if ((wall.kind ?? 'wall') === 'door') return !wall.open;
  return true;
}

export function blocksSight(wall: WallLike): boolean {
  if (wall.broken) return false;
  const kind = wall.kind ?? 'wall';
  if (kind === 'window') return false;
  if (kind === 'door') return !wall.open;
  return true;
}

const BY_STYLE: Record<string, { ac: number; hp: number }> = {
  stone: { ac: 17, hp: 27 }, brick: { ac: 17, hp: 27 }, rock: { ac: 17, hp: 54 },
  wood: { ac: 15, hp: 18 }, hedge: { ac: 11, hp: 10 }, plain: { ac: 15, hp: 27 }, image: { ac: 15, hp: 27 },
};

export function wallDefense(wall: { kind?: WallKind | null; style?: string | null; hp_max?: number | null }): { ac: number; hpMax: number } {
  const kind = wall.kind ?? 'wall';
  const base = kind === 'door' ? { ac: 15, hp: 18 } : kind === 'window' ? { ac: 13, hp: 4 } : BY_STYLE[wall.style ?? 'stone'] ?? BY_STYLE.stone!;
  return { ac: base.ac, hpMax: wall.hp_max ?? base.hp };
}

export const WALL_IMMUNE = ['poison', 'psychic'];

export function wallSteps(wall: WallLike): number {
  return Math.max(1, Math.round(Math.max(Math.abs(wall.x2 - wall.x1), Math.abs(wall.z2 - wall.z1))));
}

export function wallTileAt(wall: WallLike, point: { x: number; z: number }): number {
  const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1;
  const t = Math.max(0, Math.min(1, ((point.x - wall.x1) * dx + (point.z - wall.z1) * dz) / (dx * dx + dz * dz || 1)));
  return Math.min(wallSteps(wall) - 1, Math.floor(t * wallSteps(wall)));
}

export function splitWall(wall: WallLike, index: number): Array<{ part: 'before' | 'tile' | 'after'; x1: number; z1: number; x2: number; z2: number }> {
  const steps = wallSteps(wall);
  const at = (k: number) => ({ x: wall.x1 + ((wall.x2 - wall.x1) * k) / steps, z: wall.z1 + ((wall.z2 - wall.z1) * k) / steps });
  const tile = Math.max(0, Math.min(steps - 1, Math.floor(index)));
  const parts: Array<{ part: 'before' | 'tile' | 'after'; x1: number; z1: number; x2: number; z2: number }> = [];
  const piece = (part: 'before' | 'tile' | 'after', from: number, to: number) => {
    const a = at(from), b = at(to);
    parts.push({ part, x1: a.x, z1: a.z, x2: b.x, z2: b.z });
  };
  if (tile > 0) piece('before', 0, tile);
  piece('tile', tile, tile + 1);
  if (tile + 1 < steps) piece('after', tile + 1, steps);
  return parts;
}

export function wallReachable(from: { x: number; z: number; size: number }, tile: WallLike, others: WallSegment[]): boolean {
  const dx = tile.x2 - tile.x1, dz = tile.z2 - tile.z1;
  const length = Math.hypot(dx, dz) || 1;
  const nx = -dz / length, nz = dx / length;
  const side = Math.sign((from.x - tile.x1) * nx + (from.z - tile.z1) * nz) || 1;
  const targets = [0.1, 0.5, 0.9].map(t => ({ x: tile.x1 + dx * t + side * 0.1 * nx, z: tile.z1 + dz * t + side * 0.1 * nz }));
  const h = Math.max(0.05, from.size / 2 - 0.1);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({ x: from.x + sx! * h, z: from.z + sz! * h }));
  return corners.some(corner => targets.some(target => !pathBlocked(corner, target, others)));
}

export function distanceToWall(wall: WallLike, point: { x: number; z: number }): number {
  const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1;
  const t = Math.max(0, Math.min(1, ((point.x - wall.x1) * dx + (point.z - wall.z1) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(point.x - (wall.x1 + t * dx), point.z - (wall.z1 + t * dz));
}

export function wallCondition(hp: number | null | undefined, hpMax: number, broken: boolean, kind: WallKind = 'wall'): string {
  const window = kind === 'window';
  if (broken) return window ? 'разбито' : kind === 'door' ? 'выбита' : 'разрушена';
  if (hp === null || hp === undefined || hp >= hpMax) return window ? 'целое' : 'целая';
  if (hp > hpMax / 2) return window ? 'в трещинах' : 'повреждена';
  return window ? 'вот-вот разобьётся' : 'вот-вот рухнет';
}
