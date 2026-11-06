import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visibleCells, isLatticePoint} from './los.ts';

const dims = {widthCells: 4, heightCells: 4};
const origin = {x: -0.5, z: -0.5};
const feetPerUnit = 5;

function has(cells: Array<{x: number; z: number}>, x: number, z: number) {
  return cells.some(c => Math.abs(c.x - x) < 1e-9 && Math.abs(c.z - z) < 1e-9);
}

test('unbounded radius with no walls sees every cell', () => {
  const cells = visibleCells(origin, null, feetPerUnit, dims, []);
  assert.equal(cells.length, 16);
});

test('bounded radius excludes far cells and includes near ones', () => {
  const cells = visibleCells(origin, 10, feetPerUnit, dims, []);
  assert.ok(has(cells, 0.5, -0.5));
  assert.ok(!has(cells, 1.5, 1.5));
});

test('a wall between origin and a cell hides it', () => {
  const wall = {x1: 0, z1: -2, x2: 0, z2: 2};
  const withoutWall = visibleCells(origin, 10, feetPerUnit, dims, []);
  const withWall = visibleCells(origin, 10, feetPerUnit, dims, [wall]);

  assert.ok(has(withoutWall, 0.5, -0.5));
  assert.ok(!has(withWall, 0.5, -0.5));
});

test('a wall not on the path does not hide the cell', () => {
  const wall = {x1: -2, z1: 2, x2: 2, z2: 2};
  const cells = visibleCells(origin, 10, feetPerUnit, dims, [wall]);
  assert.ok(has(cells, 0.5, -0.5));
});

test('the viewer\'s own cell is always visible even next to a wall', () => {
  const wall = {x1: -2, z1: -2, x2: 2, z2: -2};
  const cells = visibleCells(origin, 10, feetPerUnit, dims, [wall]);
  assert.ok(has(cells, -0.5, -0.5));
});

test('lattice points sit on the opposite parity from cell centres', () => {
  assert.equal(isLatticePoint(0, 4), true);
  assert.equal(isLatticePoint(-2, 4), true);
  assert.equal(isLatticePoint(-0.5, 4), false);
  assert.equal(isLatticePoint(2.5, 5), true);
  assert.equal(isLatticePoint(0, 5), false);
});
