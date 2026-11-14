import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gridDistanceCells, gridDistanceFeet} from './measure.ts';

test('straight lines count every cell under both rules', () => {
  assert.equal(gridDistanceCells({x: 0.5, z: 0.5}, {x: 6.5, z: 0.5}, 'phb'), 6);
  assert.equal(gridDistanceCells({x: 0.5, z: 0.5}, {x: 0.5, z: -3.5}, '5-10-5'), 4);
});

test('PHB 2014: a diagonal step costs one cell', () => {
  assert.equal(gridDistanceCells({x: 0, z: 0}, {x: 4, z: 4}, 'phb'), 4);
  assert.equal(gridDistanceCells({x: 0, z: 0}, {x: 5, z: 2}, 'phb'), 5);
});

test('DMG 5-10-5: every second diagonal costs two cells', () => {
  assert.equal(gridDistanceCells({x: 0, z: 0}, {x: 1, z: 1}, '5-10-5'), 1);
  assert.equal(gridDistanceCells({x: 0, z: 0}, {x: 2, z: 2}, '5-10-5'), 3);
  assert.equal(gridDistanceCells({x: 0, z: 0}, {x: 3, z: 3}, '5-10-5'), 4);
  assert.equal(gridDistanceCells({x: 0, z: 0}, {x: 4, z: 4}, '5-10-5'), 6);
  assert.equal(gridDistanceCells({x: 0, z: 0}, {x: 5, z: 2}, '5-10-5'), 6);
});

test('direction does not matter', () => {
  assert.equal(
    gridDistanceCells({x: 3.5, z: -2.5}, {x: -1.5, z: 1.5}, '5-10-5'),
    gridDistanceCells({x: -1.5, z: 1.5}, {x: 3.5, z: -2.5}, '5-10-5'),
  );
});

test('feet use the scene feet_per_unit, not a fixed 5', () => {
  assert.equal(gridDistanceFeet({x: 0, z: 0}, {x: 3, z: 0}, 5, 'phb'), 15);
  assert.equal(gridDistanceFeet({x: 0, z: 0}, {x: 3, z: 0}, 10, 'phb'), 30);
  assert.equal(gridDistanceFeet({x: 0, z: 0}, {x: 2, z: 2}, 5, '5-10-5'), 15);
});

test('same cell is zero', () => {
  assert.equal(gridDistanceCells({x: 1.5, z: 1.5}, {x: 1.5, z: 1.5}, 'phb'), 0);
});
