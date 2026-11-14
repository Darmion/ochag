import {test} from 'node:test';
import assert from 'node:assert/strict';
import {centerOf, positionOf, reachablePositions, shortestPath, type PathGrid} from './pathfinding.ts';
import {gridDistanceCells} from './measure.ts';

const open = (extra: Partial<PathGrid> = {}): PathGrid => ({widthCells: 10, heightCells: 10, size: 1, rule: 'phb', edges: [], walls: [], ...extra});

test('without walls the path costs the same as the straight count, both diagonal rules', () => {
  for (const rule of ['phb', '5-10-5'] as const) {
    const grid = open({rule});
    for (const [to, from] of [[{col: 7, row: 3}, {col: 1, row: 1}], [{col: 0, row: 9}, {col: 5, row: 5}], [{col: 9, row: 9}, {col: 0, row: 0}]] as const) {
      assert.equal(shortestPath(grid, from, to)!.cost, gridDistanceCells({x: from.col, z: from.row}, {x: to.col, z: to.row}, rule), `${rule} ${JSON.stringify(from)}→${JSON.stringify(to)}`);
    }
  }
});

test('a wall in the way: the path goes round it, not through', () => {
  const wall = {x1: 0, z1: -5, x2: 0, z2: 3};
  const grid = open({edges: [wall], walls: [wall]});
  const from = positionOf(grid, -0.5, -2.5);
  const to = positionOf(grid, 0.5, -2.5);
  const path = shortestPath(grid, from, to)!;
  assert.ok(path, 'there is a way round');
  assert.ok(path.cost > 1, 'longer than the one step through the wall');
  assert.ok(path.cells.some(cell => centerOf(grid, cell).z > 3), 'goes below the end of the wall');
  const full = {x1: 0, z1: -5, x2: 0, z2: 5};
  assert.equal(shortestPath(open({edges: [full], walls: [full]}), from, to), null);
});

test('a closed room corner does not leak diagonally', () => {
  const room = [{x1: 0, z1: 0, x2: 2, z2: 0}, {x1: 2, z1: 0, x2: 2, z2: 2}, {x1: 2, z1: 2, x2: 0, z2: 2}, {x1: 0, z1: 2, x2: 0, z2: 0}];
  const grid = open({edges: room, walls: room});
  assert.equal(shortestPath(grid, positionOf(grid, 0.5, 0.5), positionOf(grid, -0.5, -0.5)), null);
});

test('difficult terrain is avoided when going round is cheaper; 5-10-5 parity carries over', () => {
  const mud = new Set(['4:5', '5:5', '6:5']);
  const grid = open({isDifficult: cell => mud.has(`${cell.col}:${cell.row}`)});
  // Straight along row 5 through mud costs 7; the detour along row 4 costs 4.
  assert.equal(shortestPath(grid, {col: 3, row: 5}, {col: 7, row: 5})!.cost, 4);
  assert.equal(shortestPath(open({rule: '5-10-5', diagonalsBefore: 1}), {col: 0, row: 0}, {col: 1, row: 1})!.cost, 2);
});

test('reachable positions within a budget, and blockers', () => {
  const blocked = new Set(['5:4']);
  const reach = reachablePositions(open({blockedCells: blocked}), {col: 4, row: 4}, 1);
  assert.equal(reach.get('4:4')!.previous, null, 'the start has no previous');
  for (const entry of reach.values()) {
    if (!entry.previous) continue;
    assert.ok(Math.max(Math.abs(entry.previous.col - entry.cell.col), Math.abs(entry.previous.row - entry.cell.row)) === 1, 'previous is a neighbour');
  }
  assert.equal(reach.size, 8, 'the start and seven neighbours — one is a blocker');
  assert.ok(!reach.has('5:4'));
  const gapWalls = [{x1: 0, z1: -5, x2: 0, z2: 0}, {x1: 0, z1: 1, x2: 0, z2: 5}];
  const big = open({size: 2, edges: gapWalls, walls: gapWalls});
  assert.equal(shortestPath(big, positionOf(big, -2, 0), positionOf(big, 2, 0)), null);
  const small = open({edges: gapWalls, walls: gapWalls});
  assert.ok(shortestPath(small, positionOf(small, -1.5, 0.5), positionOf(small, 1.5, 0.5)), 'a medium creature fits through');
});

test('deep water: swimming costs double without a swimming speed, triple in difficult terrain too; shallow water is difficult terrain', () => {
  const lake = new Set(['1:0', '2:0']);
  const mud = new Set(['2:0']);
  const deep = (cell: {col: number; row: number}) => lake.has(`${cell.col}:${cell.row}`);
  const from = {col: 0, row: 0}, to = {col: 3, row: 0};
  const narrow = {heightCells: 1};
  assert.equal(shortestPath(open({...narrow, isDeepWater: deep}), from, to)!.cost, 5);
  assert.equal(shortestPath(open({...narrow, isDeepWater: deep, swims: true}), from, to)!.cost, 3);
  assert.equal(shortestPath(open({...narrow, isDeepWater: deep, isDifficult: cell => mud.has(`${cell.col}:${cell.row}`)}), from, to)!.cost, 6);
  assert.equal(shortestPath(open({...narrow, isDeepWater: deep, isDifficult: cell => mud.has(`${cell.col}:${cell.row}`), swims: true}), from, to)!.cost, 4);
});

test('a walker goes round a lake when that is cheaper than swimming across', () => {
  const lake = new Set(['1:0', '1:1', '1:2']);
  const grid = open({widthCells: 3, heightCells: 4, isDeepWater: cell => lake.has(`${cell.col}:${cell.row}`)});
  const path = shortestPath(grid, {col: 0, row: 0}, {col: 2, row: 0})!;
  assert.ok(path.cost <= 4, `cost ${path.cost}`);
  assert.equal(shortestPath({...grid, swims: true}, {col: 0, row: 0}, {col: 2, row: 0})!.cost, 2);
});
