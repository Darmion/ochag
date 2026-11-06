import {test} from 'node:test';
import assert from 'node:assert/strict';
import {figureScale, footprintCells, isFootprintCenter, occupiedCells, snapFootprint} from './footprint.ts';

test('size to cells: tiny…medium one cell, large 2×2, huge 3×3, gargantuan 4×4', () => {
  assert.deepEqual(
    ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan', 'unknown', null].map(size => footprintCells(size as string)),
    [1, 1, 1, 2, 3, 4, 1, 1],
  );
  assert.deepEqual(['tiny', 'small', 'medium', 'gargantuan'].map(figureScale), [0.5, 0.85, 1, 4]);
});

test('odd footprints snap to cell centres, even ones to grid corners', () => {
  assert.equal(snapFootprint(0.3, 10, 1), 0.5);
  assert.equal(snapFootprint(0.3, 10, 2), 0);
  assert.equal(snapFootprint(1.4, 10, 3), 1.5);
  assert.equal(snapFootprint(0.6, 10, 4), 1);

  assert.equal(snapFootprint(0.2, 9, 1), 0);
  assert.equal(snapFootprint(0.2, 9, 2), 0.5);
});

test('a big creature stays wholly on the board', () => {
  assert.equal(snapFootprint(4.9, 10, 3), 3.5);
  assert.equal(snapFootprint(-9, 10, 2), -4);
  assert.equal(isFootprintCenter(3.5, 10, 3), true);
  assert.equal(isFootprintCenter(4.5, 10, 3), false, 'would hang over the edge');
  assert.equal(isFootprintCenter(0.5, 10, 2), false, 'a 2×2 sits on a corner, not a cell centre');
  assert.equal(isFootprintCenter(0, 10, 2), true);
  assert.equal(isFootprintCenter(0.5, 10, 1), true);
});

test('occupied cells of a large creature', () => {
  const scene = {width_cells: 10, height_cells: 10};
  assert.deepEqual(occupiedCells(scene, 0, 0, 2), [{col: 4, row: 4}, {col: 5, row: 4}, {col: 4, row: 5}, {col: 5, row: 5}]);
  assert.deepEqual(occupiedCells(scene, 0.5, -0.5, 1), [{col: 5, row: 4}]);
  assert.equal(occupiedCells(scene, 1.5, 1.5, 3).length, 9);
});
