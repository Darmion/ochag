import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cellCutByWall, pathBlocked } from './blockers.ts';
import { VISION_INDEX_FROM, blockedBy, visibleCells, type WallSegment } from './los.ts';
import { indexWalls } from './wall-index.ts';

// Walls along the grid lines, diagonal and at odd angles, so ends meet, cross and graze cells as on real maps.
function board(size: number, count: number, seed: number): WallSegment[] {
  let state = seed;
  const random = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
  const walls: WallSegment[] = [];
  for (let index = 0; index < count; index++) {
    const length = 1 + Math.floor(random() * 8);
    const x = Math.floor(random() * (size - length)) - size / 2;
    const z = Math.floor(random() * (size - length)) - size / 2;
    const kind = random();
    if (kind < 0.4) walls.push({ x1: x, z1: z, x2: x + length, z2: z });
    else if (kind < 0.8) walls.push({ x1: x, z1: z, x2: x, z2: z + length });
    else if (kind < 0.9) walls.push({ x1: x, z1: z, x2: x + length, z2: z + length });
    else walls.push({ x1: x + random(), z1: z + random(), x2: x + random() * length, z2: z - random() * length });
  }
  return walls;
}

test('a cell or a step reads the same answer from the walls near it as from every wall', () => {
  for (const seed of [1, 2, 3]) {
    const walls = board(30, 160, seed);
    const index = indexWalls(walls);
    for (let col = 0; col < 30; col++) {
      for (let row = 0; row < 30; row++) {
        const x = col - 15 + 0.5, z = row - 15 + 0.5;
        assert.equal(cellCutByWall(x, z, index.inBox(x - 0.5, z - 0.5, x + 0.5, z + 0.5)), cellCutByWall(x, z, walls), `cell ${x},${z}`);
        for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
          const to = { x: x + dx!, z: z + dz! };
          assert.equal(pathBlocked({ x, z }, to, index.alongSegment(x, z, to.x, to.z)), pathBlocked({ x, z }, to, walls), `step ${x},${z} → ${to.x},${to.z}`);
        }
      }
    }
  }
});

test('a long ray stops at the same walls whichever way the index walks it', () => {
  const walls = board(40, 300, 7);
  const index = indexWalls(walls);
  let state = 11;
  const random = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let probe = 0; probe < 2000; probe++) {
    const from = { x: random() * 40 - 20, z: random() * 40 - 20 };
    const to = probe % 3 ? { x: random() * 40 - 20, z: random() * 40 - 20 } : { x: from.x, z: random() * 40 - 20 };
    const all = walls.some(wall => blockedBy(from, to, wall));
    assert.equal(index.anyAlong(from.x, from.z, to.x, to.z, wall => blockedBy(from, to, wall)), all);
    assert.equal(index.anyAlong(to.x, to.z, from.x, from.z, wall => blockedBy(to, from, wall)), walls.some(wall => blockedBy(to, from, wall)));
  }
});

test('vision through the index sees exactly the cells a scan of every wall sees', () => {
  const scan = (origin: { x: number; z: number }, radiusFeet: number | null, size: number, walls: WallSegment[]) => {
    const seen: string[] = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const target = { x: col - size / 2 + 0.5, z: row - size / 2 + 0.5 };
        if (radiusFeet !== null && Math.hypot(target.x - origin.x, target.z - origin.z) > radiusFeet / 5) continue;
        if (!walls.some(wall => blockedBy(origin, target, wall))) seen.push(`${target.x},${target.z}`);
      }
    }
    return seen.sort();
  };
  for (const [size, count] of [[24, VISION_INDEX_FROM], [41, 400]]) {
    const walls = board(size!, count!, size!);
    for (const origin of [{ x: 0.5, z: 0.5 }, { x: -3.25, z: 4.75 }, { x: 0, z: 0 }]) {
      for (const radius of [null, 30]) {
        const found = visibleCells(origin, radius, 5, { widthCells: size!, heightCells: size! }, walls).map(cell => `${cell.x},${cell.z}`).sort();
        assert.deepEqual(found, scan(origin, radius, size!, walls));
      }
    }
  }
});
