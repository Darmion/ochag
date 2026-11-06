import { blockedBy, wallHit, type Point, type WallSegment } from './los.ts';

export function footprintEdges(x: number, z: number, n: number): WallSegment[] {
  const h = n / 2;
  const [left, right, top, bottom] = [x - h, x + h, z - h, z + h];
  return [
    { x1: left, z1: top, x2: right, z2: top },
    { x1: right, z1: top, x2: right, z2: bottom },
    { x1: right, z1: bottom, x2: left, z2: bottom },
    { x1: left, z1: bottom, x2: left, z2: top },
  ];
}

export function pathBlocked(from: Point, to: Point, walls: WallSegment[]): boolean {
  if (from.x === to.x && from.z === to.z) return false;
  return walls.some(wall => blockedBy(from, to, wall));
}

// Stops `back` units short of the wall (a quarter cell, beyond coverBetween's corner offsets); null when the path is clear.
export function nearSideOfObstruction(from: Point, to: Point, walls: WallSegment[], back = 0.25): Point | null {
  let first = Infinity;
  for (const wall of walls) {
    const t = wallHit(from, to, wall);
    if (t !== null && t < first) first = t;
  }
  if (!Number.isFinite(first)) return null;
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const at = Math.max(0, first - back / length);
  return { x: from.x + (to.x - from.x) * at, z: from.z + (to.z - from.z) * at };
}

export function wallCrossesCellDiagonally(wall: WallSegment, cellX: number, cellZ: number): boolean {
  const left = cellX - 0.5;
  const right = cellX + 0.5;
  const bottom = cellZ - 0.5;
  const top = cellZ + 0.5;
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;

  let t0 = 0;
  let t1 = 1;
  // Liang–Barsky clip step: p === 0 means the segment runs parallel to this edge.
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };

  if (!clip(-dx, wall.x1 - left)) return false;
  if (!clip(dx, right - wall.x1)) return false;
  if (!clip(-dz, wall.z1 - bottom)) return false;
  if (!clip(dz, top - wall.z1)) return false;
  if (t1 - t0 < 1e-9) return false; // just grazes a corner point, not a real crossing

  const ax = wall.x1 + t0 * dx;
  const az = wall.z1 + t0 * dz;
  const bx = wall.x1 + t1 * dx;
  const bz = wall.z1 + t1 * dz;
  const eps = 1e-6;
  const onOneEdge =
    (Math.abs(ax - left) < eps && Math.abs(bx - left) < eps) ||
    (Math.abs(ax - right) < eps && Math.abs(bx - right) < eps) ||
    (Math.abs(az - bottom) < eps && Math.abs(bz - bottom) < eps) ||
    (Math.abs(az - top) < eps && Math.abs(bz - top) < eps);
  return !onOneEdge;
}

export function cellCutByWall(cellX: number, cellZ: number, walls: WallSegment[]): boolean {
  return walls.some(wall => wallCrossesCellDiagonally(wall, cellX, cellZ));
}
