import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inAreaRelative } from './areas.ts';
import { shortestPath, type PathGrid } from './pathfinding.ts';
import { climbCells, fallFeet, groundAtPoint, groundUnder, heightMap, ledgeCover, overlooks, paintHeightRect } from './relief.ts';

const dims = { width_cells: 10, height_cells: 10 };

test('ground: a creature stands on the highest cell under it; a point on a grid line touches both cells', () => {
  const map = heightMap([[5, 5, 10], [6, 5, 20]]);
  assert.equal(groundUnder(map, dims, 0.5, 0.5, 1), 10);
  assert.equal(groundUnder(map, dims, 1, 1, 2), 20, 'a large creature over both cells');
  assert.equal(groundUnder(map, dims, -3.5, 0.5, 1), 0);
  assert.equal(groundAtPoint(map, dims, 1, 0.5), 20, 'the line between the two cells');
  assert.equal(groundAtPoint(map, dims, 0.5, 0.5), 10);
});

test('climbing: up always, down from 10 feet on; double without a climbing speed; a fall starts at 10 feet', () => {
  assert.equal(climbCells(0, 10, 5, false), 4);
  assert.equal(climbCells(0, 10, 5, true), 2);
  assert.equal(climbCells(10, 5, 5, false), 0, 'a 5-foot step down is a plain step');
  assert.equal(climbCells(20, 0, 5, false), 8);
  assert.deepEqual([fallFeet(20, 0), fallFeet(5, 0), fallFeet(0, 10)], [20, 0, 0]);
});

test('the path climbs a ledge or walks round it, whichever is cheaper', () => {
  const ledge = heightMap([[1, 0, 10], [1, 1, 10], [1, 2, 10]]);
  const grid: PathGrid = { widthCells: 3, heightCells: 3, size: 1, rule: 'phb', edges: [], walls: [], feetPerCell: 5, groundAt: cell => ledge.get(`${cell.col}:${cell.row}`) ?? 0 };
  assert.equal(shortestPath(grid, { col: 0, row: 0 }, { col: 1, row: 0 })!.cost, 5, 'one step and 10 feet of climbing at double cost');
  assert.equal(shortestPath({ ...grid, climbs: true }, { col: 0, row: 0 }, { col: 1, row: 0 })!.cost, 3);
  assert.equal(shortestPath(grid, { col: 0, row: 0 }, { col: 2, row: 0 })!.cost, 10, 'up and down again: no way round on a 3×3 board');
});

test('painting heights: a rectangle gets the height, dragging from that height levels it', () => {
  let cells = paintHeightRect([], { col: 0, row: 0 }, { col: 1, row: 1 }, 10);
  assert.equal(cells.length, 4);
  cells = paintHeightRect(cells, { col: 1, row: 1 }, { col: 1, row: 1 }, -5);
  assert.deepEqual(heightMap(cells).get('1:1'), -5);
  cells = paintHeightRect(cells, { col: 0, row: 0 }, { col: 1, row: 1 }, 10);
  assert.deepEqual(cells, [[1, 1, -5]], 'only the 10-foot cells were levelled');
});

test('from high ground a low blocker does not hide; a ledge hides the one below unless the attacker stands at its edge', () => {
  assert.ok(overlooks(10, 0));
  assert.ok(!overlooks(5, 0));
  const plateau = heightMap(Array.from({ length: 10 }, (_, row) => [[0, row, 20], [1, row, 20], [2, row, 20]]).flat());
  const back = { x: -4.5, z: 0.5, size: 1, ground: 20 };
  const atEdge = { x: -2.5, z: 0.5, size: 1, ground: 20 };
  const below = { x: -1.5, z: 0.5, size: 1, ground: 0 };
  assert.equal(ledgeCover(plateau, dims, 5, back, below), 'total', 'two cells back from a 20-foot edge, the foot of the cliff is out of sight');
  assert.equal(ledgeCover(plateau, dims, 5, atEdge, below), 'none', 'at the edge one leans over');
  const far = { x: 4.5, z: 0.5, size: 1, ground: 0 };
  assert.equal(ledgeCover(plateau, dims, 5, atEdge, far), 'none', 'from the edge the plain shows');
  assert.equal(ledgeCover(plateau, dims, 5, back, far), 'total', 'ten feet back from the edge the lip hides the plain nearby');
  assert.equal(ledgeCover(plateau, dims, 5, far, atEdge), 'half', 'from below only the upper half of one at the edge shows');
  assert.equal(ledgeCover(plateau, dims, 5, far, back), 'total');
  assert.equal(ledgeCover(heightMap([]), dims, 5, back, below), 'none');
});

test('areas on uneven ground: a sphere reaches down, a cube only rises from its base', () => {
  const sphere = { shape: 'circle' as const, x: 0, z: 0, direction: 0, size: 4 };
  assert.ok(inAreaRelative(sphere, 0.5, 0.5, -2));
  assert.ok(!inAreaRelative(sphere, 0.5, 0.5, -5));
  const cube = { shape: 'square' as const, x: 0, z: 0, direction: 0, size: 4 };
  assert.ok(inAreaRelative(cube, 1.5, 0.5, 2));
  assert.ok(!inAreaRelative(cube, 1.5, 0.5, -2));
});
