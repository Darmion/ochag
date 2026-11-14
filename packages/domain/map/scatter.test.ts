import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MAX_SCATTER, cellCenter, scatterCells, spreadPose} from './scatter.ts';

const seeded = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

test('density picks a share of the free cells; occupied cells and the board edge are respected', () => {
  const occupied = new Set(['2:2', '3:3']);
  const sparse = scatterCells({col: 0, row: 0}, {col: 5, row: 5}, 10, 10, occupied, 'sparse', seeded(1));
  const dense = scatterCells({col: 5, row: 5}, {col: 0, row: 0}, 10, 10, occupied, 'dense', seeded(1));
  assert.equal(sparse.length, Math.round(34 / 9));
  assert.equal(dense.length, 17);
  for (const cell of dense) {
    assert.ok(!occupied.has(`${cell.col}:${cell.row}`));
    assert.ok(cell.col >= 0 && cell.col <= 5 && cell.row >= 0 && cell.row <= 5);
  }
  assert.equal(new Set(dense.map(cell => `${cell.col}:${cell.row}`)).size, dense.length, 'no cell twice');
  const edge = scatterCells({col: -4, row: 8}, {col: 1, row: 20}, 10, 10, new Set(), 'dense', seeded(2));
  assert.ok(edge.every(cell => cell.col >= 0 && cell.col <= 1 && cell.row >= 8 && cell.row <= 9));
});

test('at least one object, never more than the limit, nothing on a full area', () => {
  assert.equal(scatterCells({col: 0, row: 0}, {col: 0, row: 0}, 10, 10, new Set(), 'sparse', seeded(3)).length, 1);
  assert.equal(scatterCells({col: 0, row: 0}, {col: 99, row: 99}, 100, 100, new Set(), 'dense', seeded(4)).length, MAX_SCATTER);
  assert.deepEqual(scatterCells({col: 0, row: 0}, {col: 0, row: 0}, 10, 10, new Set(['0:0']), 'dense', seeded(5)), []);
});

test('cell centres in world units; the spread turns and resizes within bounds or leaves things alone', () => {
  assert.deepEqual(cellCenter({col: 0, row: 9}, 10, 10), {x: -4.5, z: 4.5});
  assert.deepEqual(spreadPose({rotationY: 45, scale: 2}, {rotate: false, size: 0}, seeded(6)), {rotationY: 45, scale: 2});
  const random = seeded(7);
  for (let at = 0; at < 200; at++) {
    const pose = spreadPose({rotationY: 0, scale: 1}, {rotate: true, size: 0.25}, random);
    assert.ok(pose.rotationY >= 0 && pose.rotationY < 360);
    assert.ok(pose.scale >= 0.75 && pose.scale <= 1.25, String(pose.scale));
  }
});
