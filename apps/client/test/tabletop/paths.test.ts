import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceToDrawing, distanceToSegment, simplifyPath } from '../../src/tabletop/paths.ts';

type DrawingArg = Parameters<typeof distanceToDrawing>[1];
const drawing = (points: Array<[number, number]>) => ({ points }) as unknown as DrawingArg;
const p = (x: number, z: number) => ({ x, z });

test('a straight stroke keeps only its ends', () => {
  assert.deepEqual(simplifyPath([p(0, 0), p(1, 0), p(2, 0), p(3, 0)]), [p(0, 0), p(3, 0)]);
});

test('a corner survives simplification', () => {
  assert.deepEqual(simplifyPath([p(0, 0), p(1, 0), p(2, 0), p(2, 1), p(2, 2)]), [p(0, 0), p(2, 0), p(2, 2)]);
});

test('jitter below epsilon is dropped', () => {
  assert.deepEqual(simplifyPath([p(0, 0), p(1, 0.01), p(2, -0.01), p(3, 0)]), [p(0, 0), p(3, 0)]);
});

test('short strokes are returned as they are', () => {
  const stroke = [p(0, 0), p(1, 1)];
  assert.equal(simplifyPath(stroke), stroke);
});

test('distance to a segment is measured to its nearest point', () => {
  assert.equal(distanceToSegment(p(1, 2), p(0, 0), p(2, 0)), 2);
  assert.equal(distanceToSegment(p(5, 0), p(0, 0), p(2, 0)), 3);
  assert.equal(distanceToSegment(p(3, 4), p(0, 0), p(0, 0)), 5);
});

test('distance to a drawing: a label is a point, a line is its closest segment', () => {
  assert.equal(distanceToDrawing(p(3, 4), drawing([[0, 0]])), 5);
  assert.equal(distanceToDrawing(p(1, 1), drawing([[0, 0], [2, 0], [2, 2]])), 1);
});
