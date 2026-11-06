import {test} from 'node:test';
import assert from 'node:assert/strict';
import {areaCells, inArea, inAreaAt} from './areas.ts';

const dims = {widthCells: 10, heightCells: 10};
const key = (cells: Array<{col: number; row: number}>) => cells.map(c => `${c.col}:${c.row}`).sort();

test('a 10-ft-radius sphere from a grid corner covers a 4×4 block, minus the far corners', () => {
  const cells = areaCells({shape: 'circle', x: 0, z: 0, direction: 0, size: 2}, dims);
  assert.equal(cells.length, 12);
  assert.ok(!key(cells).includes('3:3'), 'a far corner of the 4×4 block is outside');
  assert.ok(key(cells).includes('4:3') && key(cells).includes('6:5'));
  assert.equal(inArea({shape: 'circle', x: 0, z: 0, direction: 0, size: 2}, 1.5, 1.5), false);
  assert.equal(inArea({shape: 'circle', x: 0, z: 0, direction: 0, size: 2}, 1.5, 0.5), true);
});

test('a 15-ft cone widens as far as it reaches', () => {
  const cone = {shape: 'cone' as const, x: 0, z: 0, direction: 0, size: 3};
  assert.equal(inArea(cone, 0.5, 0.5), false, 'next to the tip, 45° aside — outside the 26.6° half-angle');
  assert.equal(inArea(cone, 1.5, 0.5), true);
  assert.equal(inArea(cone, 2.5, 0.5), true);
  assert.equal(inArea(cone, 2.5, 1.5), false, '31° off — outside');
  assert.equal(inArea(cone, -0.5, 0.5), false, 'behind the caster');
  assert.equal(inArea(cone, 3.5, 0.5), false, 'beyond 15 ft');
});

test('a cube goes forward from the middle of its near face; a line is 5 ft wide', () => {
  const cube = {shape: 'square' as const, x: 0, z: 0, direction: 90, size: 2};
  assert.deepEqual(key(areaCells(cube, dims)), ['4:5', '4:6', '5:5', '5:6']);

  const line = {shape: 'line' as const, x: -5, z: 0.5, direction: 0, size: 6, width: 1};
  assert.deepEqual(key(areaCells(line, dims)), ['0:5', '1:5', '2:5', '3:5', '4:5', '5:5']);
});

test('a 5-ft cube from a grid node is one cell in any direction, an N-cube is N×N (complaints, item 4)', () => {
  for (const direction of [0, 45, 90, 135, 180, 225, 270, 315]) {
    assert.equal(areaCells({shape: 'square', x: 0, z: 0, direction, size: 1}, dims).length, 1, `5 ft, ${direction}°`);
  }
  for (const direction of [0, 90, 180, 270]) {
    assert.equal(areaCells({shape: 'square', x: 1, z: -2, direction, size: 3}, dims).length, 9, `15 ft, ${direction}°`);
    assert.equal(areaCells({shape: 'line', x: 0, z: 0, direction, size: 4, width: 1}, dims).length, 4, `a 5-ft-wide line, ${direction}°`);
  }
});

test('over the ground: a 20-ft-radius sphere misses a flyer 30 ft up; a cube rises to its side; a line is 5 ft tall', () => {
  const ball = {shape: 'circle' as const, x: 0, z: 0, direction: 0, size: 4};
  assert.equal(inAreaAt(ball, 0.5, 0.5, 0), inArea(ball, 0.5, 0.5), 'on the ground — exactly as before');
  assert.equal(inAreaAt(ball, 0.5, 0.5, 2), true, '10 ft up above the centre — inside');
  assert.equal(inAreaAt(ball, 0.5, 0.5, 6), false, '30 ft up — outside');
  assert.equal(inAreaAt(ball, 3.5, 0.5, 2), false, 'near the edge and 10 ft up — outside the sphere');
  const cone = {shape: 'cone' as const, x: 0, z: 0, direction: 0, size: 6};
  assert.equal(inAreaAt(cone, 4.5, 0.5, 1), true, '5 ft up, 22 ft out — inside the round cone');
  assert.equal(inAreaAt(cone, 1.5, 0.5, 2), false, '10 ft up right next to the caster — above the cone');
  const cube = {shape: 'square' as const, x: 0, z: 0, direction: 0, size: 2};
  assert.equal(inAreaAt(cube, 0.5, 0.5, 1), true, 'a 10-ft cube reaches 5 ft up');
  assert.equal(inAreaAt(cube, 0.5, 0.5, 2), false, 'not 10 ft up');
  const line = {shape: 'line' as const, x: 0, z: 0, direction: 0, size: 6, width: 1};
  assert.equal(inAreaAt(line, 2.5, 0, 0), true);
  assert.equal(inAreaAt(line, 2.5, 0, 1), false, 'a 5-ft line along the ground — not 5 ft up');
});

test('a 10-ft-radius, 40-ft-high cylinder reaches 30 ft up, not 40', () => {
  const column = {shape: 'circle' as const, x: 0, z: 0, direction: 0, size: 2, height: 8};
  assert.equal(inAreaAt(column, 0.5, 0.5, 6), true, '30 ft up — inside the column');
  assert.equal(inAreaAt({...column, height: undefined}, 0.5, 0.5, 6), false, 'the same as a sphere — outside');
  assert.equal(inAreaAt(column, 0.5, 0.5, 8), false, '40 ft up — above it');
  assert.equal(inAreaAt(column, 2.5, 0.5, 1), false, 'outside the radius');
  assert.equal(inAreaAt(column, 0.5, 0.5, 0), inArea(column, 0.5, 0.5), 'on the ground — as before');
});
