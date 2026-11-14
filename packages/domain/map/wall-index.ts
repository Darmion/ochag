import type { WallSegment } from './los.ts';

// Walls bucketed by the unit squares their bounding boxes cover, so a question about a cell, a step or a ray reads only
// the walls near it. Every wall that could touch the asked area comes back (boxes are widened by MARGIN, far beyond the
// tests' own epsilons), so answers equal a scan of all walls; wall-index.test.ts checks that. The buckets sit in two flat
// arrays (each bucket's walls are one run of `items`), which a hot loop reads faster than a Map.
const MARGIN = 1e-3;

export type WallIndex = {
  inBox(minX: number, minZ: number, maxX: number, maxZ: number): WallSegment[];
  alongSegment(x1: number, z1: number, x2: number, z2: number): WallSegment[];
  // Walks the buckets from the first point to the second and stops at the first wall `hit` accepts.
  anyAlong(x1: number, z1: number, x2: number, z2: number, hit: (wall: WallSegment) => boolean): boolean;
};

export function indexWalls(walls: WallSegment[]): WallIndex {
  const box = walls.map(wall => [
    Math.floor(Math.min(wall.x1, wall.x2) - MARGIN), Math.floor(Math.min(wall.z1, wall.z2) - MARGIN),
    Math.floor(Math.max(wall.x1, wall.x2) + MARGIN), Math.floor(Math.max(wall.z1, wall.z2) + MARGIN),
  ] as const);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const [x0, z0, x1, z1] of box) {
    left = Math.min(left, x0);
    top = Math.min(top, z0);
    right = Math.max(right, x1);
    bottom = Math.max(bottom, z1);
  }
  const columns = box.length ? right - left + 1 : 0;
  const rows = box.length ? bottom - top + 1 : 0;

  const starts = new Int32Array(columns * rows + 1);
  for (const [x0, z0, x1, z1] of box) {
    for (let bx = x0; bx <= x1; bx++) for (let bz = z0; bz <= z1; bz++) starts[(bx - left) * rows + (bz - top) + 1]! += 1;
  }
  for (let index = 1; index < starts.length; index++) starts[index]! += starts[index - 1]!;
  const items = new Int32Array(starts[starts.length - 1]!);
  const fill = starts.slice(0, -1);
  box.forEach(([x0, z0, x1, z1], wall) => {
    for (let bx = x0; bx <= x1; bx++) for (let bz = z0; bz <= z1; bz++) items[fill[(bx - left) * rows + (bz - top)]!++] = wall;
  });

  // A wall in several buckets is read once: the stamp marks walls the current question has already seen.
  const seen = new Int32Array(walls.length);
  let stamp = 0;
  const next = () => {
    if (++stamp === 0x7fffffff) {
      seen.fill(0);
      stamp = 1;
    }
  };
  // Calls `visit` for each wall of the bucket not seen yet; true from `visit` stops early.
  const bucket = (bx: number, bz: number, visit: (wall: WallSegment) => boolean | void) => {
    const column = bx - left, row = bz - top;
    if (column < 0 || row < 0 || column >= columns || row >= rows) return false;
    const at = column * rows + row;
    for (let index = starts[at]!; index < starts[at + 1]!; index++) {
      const wall = items[index]!;
      if (seen[wall] === stamp) continue;
      seen[wall] = stamp;
      if (visit(walls[wall]!) === true) return true;
    }
    return false;
  };
  // The buckets a segment passes through, column by column from its first point, each widened by MARGIN.
  const walk = (x1: number, z1: number, x2: number, z2: number, visit: (wall: WallSegment) => boolean | void) => {
    next();
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const dx = x2 - x1, dz = z2 - z1;
    const first = Math.floor(minX - MARGIN), last = Math.floor(maxX + MARGIN);
    const stepX = dx < 0 ? -1 : 1;
    for (let bx = stepX > 0 ? first : last; stepX > 0 ? bx <= last : bx >= first; bx += stepX) {
      let low = Math.min(z1, z2), high = Math.max(z1, z2);
      if (dx !== 0) {
        const at = (x: number) => z1 + ((x - x1) / dx) * dz;
        const a = at(Math.max(minX, bx - MARGIN)), b = at(Math.min(maxX, bx + 1 + MARGIN));
        low = Math.min(a, b);
        high = Math.max(a, b);
      }
      const from = Math.floor(low - MARGIN), to = Math.floor(high + MARGIN);
      if (dz < 0) {
        for (let bz = to; bz >= from; bz--) if (bucket(bx, bz, visit)) return true;
      } else {
        for (let bz = from; bz <= to; bz++) if (bucket(bx, bz, visit)) return true;
      }
    }
    return false;
  };

  return {
    inBox(minX, minZ, maxX, maxZ) {
      next();
      const out: WallSegment[] = [];
      for (let bx = Math.floor(minX - MARGIN); bx <= Math.floor(maxX + MARGIN); bx++) {
        for (let bz = Math.floor(minZ - MARGIN); bz <= Math.floor(maxZ + MARGIN); bz++) bucket(bx, bz, wall => { out.push(wall); });
      }
      return out;
    },
    alongSegment(x1, z1, x2, z2) {
      const out: WallSegment[] = [];
      walk(x1, z1, x2, z2, wall => { out.push(wall); });
      return out;
    },
    anyAlong: walk,
  };
}
