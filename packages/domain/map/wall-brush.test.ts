import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MAX_BRUSH_SEGMENTS, createBrushPath, strokeCloses, strokeToWalls, type BrushPoint} from './wall-brush.ts';

const line = (from: BrushPoint, to: BrushPoint, count = 40): BrushPoint[] =>
  Array.from({length: count + 1}, (_, at) => ({x: from.x + ((to.x - from.x) * at) / count, z: from.z + ((to.z - from.z) * at) / count}));
const circle = (radius: number, count = 72, wobble = 0): BrushPoint[] =>
  Array.from({length: count + 1}, (_, at) => {
    const angle = (at / count) * Math.PI * 2;
    const r = radius + (at % 2 ? wobble : -wobble);
    return {x: Math.cos(angle) * r + 0.13, z: Math.sin(angle) * r - 0.21};
  });
const onNodes = (segments: Array<{x1: number; z1: number; x2: number; z2: number}>) =>
  segments.every(s => [s.x1, s.z1, s.x2, s.z2].every(value => Number.isInteger(value)));

test('a wobbly straight stroke becomes one wall between grid nodes', () => {
  const stroke = line({x: -3.2, z: 0.1}, {x: 3.1, z: -0.2}).map((point, at) => ({...point, z: point.z + (at % 2 ? 0.12 : -0.12)}));
  const {segments, closed} = strokeToWalls(stroke, 10, 10);
  assert.equal(closed, false);
  assert.deepEqual(segments, [{x1: -3, z1: 0, x2: 3, z2: 0}]);
});

test('a corner stays a corner', () => {
  const stroke = [...line({x: -3, z: -3}, {x: 2, z: -3}), ...line({x: 2, z: -3}, {x: 2, z: 3}).slice(1)];
  const {segments} = strokeToWalls(stroke, 10, 10);
  assert.deepEqual(segments, [{x1: -3, z1: -3, x2: 2, z2: -3}, {x1: 2, z1: -3, x2: 2, z2: 3}]);
});

test('a loop that ends near its start closes into a cave: walls on nodes, end meets start, finer detail gives more walls', () => {
  const stroke = circle(4, 90, 0.15);
  assert.equal(strokeCloses(stroke), true);
  const normal = strokeToWalls(stroke, 12, 12, 'normal');
  assert.equal(normal.closed, true);
  assert.ok(normal.segments.length >= 6, String(normal.segments.length));
  assert.ok(onNodes(normal.segments));
  const first = normal.segments[0]!;
  const last = normal.segments[normal.segments.length - 1]!;
  assert.deepEqual([last.x2, last.z2], [first.x1, first.z1], 'the loop is closed');
  const fine = strokeToWalls(stroke, 12, 12, 'fine');
  const rough = strokeToWalls(stroke, 12, 12, 'rough');
  assert.ok(fine.segments.length > rough.segments.length, `${fine.segments.length} vs ${rough.segments.length}`);
});

test('scribbles and back-and-forth leave no zero-length or repeated walls; a short hook does not close', () => {
  const zigzag = [{x: 0, z: 0}, {x: 2, z: 0}, {x: 0.1, z: 0.1}, {x: 2, z: 0.1}, {x: 0, z: 0}];
  const {segments, closed} = strokeToWalls(zigzag, 10, 10);
  assert.equal(closed, false);
  for (const s of segments) assert.ok(s.x1 !== s.x2 || s.z1 !== s.z2);
  const keys = segments.map(s => [`${s.x1},${s.z1}`, `${s.x2},${s.z2}`].sort().join('|'));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(strokeToWalls([{x: 0, z: 0}, {x: 0.2, z: 0.1}], 10, 10).segments.length, 0, 'a dot is not a wall');
});

test('walls stay on the board and an odd-sized board uses its half-cell nodes', () => {
  const {segments} = strokeToWalls(line({x: -9, z: 0}, {x: 9, z: 0}), 7, 7);
  assert.deepEqual(segments, [{x1: -3.5, z1: 0.5, x2: 3.5, z2: 0.5}]);
});

test('a very long scribble is capped at the batch limit', () => {
  const stroke: BrushPoint[] = [];
  for (let at = 0; at < 3000; at++) stroke.push({x: (at % 2 ? 40 : -40) + (at % 7), z: -40 + (at * 80) / 3000});
  assert.ok(strokeToWalls(stroke, 100, 100, 'fine').segments.length <= MAX_BRUSH_SEGMENTS);
});

test('walls already laid never move while the stroke goes on; only the last one follows the hand; the preview ends as the result', () => {
  for (const detail of ['fine', 'normal', 'rough'] as const) {
    const stroke = [...circle(4, 120, 0.2), ...line({x: 4.1, z: -0.2}, {x: 5.5, z: 3.5}, 20)];
    const path = createBrushPath(14, 14, detail);
    let before: string[] = [];
    for (const point of stroke) {
      path.add(point);
      const fixed = path.walls().fixed.map(s => `${s.x1},${s.z1}>${s.x2},${s.z2}`);
      assert.deepEqual(fixed.slice(0, before.length), before, `${detail}: a fixed wall changed`);
      before = fixed;
    }
    const {fixed, open} = path.walls();
    const shown = [...fixed, ...(open ? [open] : [])];
    const result = path.finish().segments;
    assert.deepEqual(result.slice(0, shown.length), shown, `${detail}: the result is what the preview showed`);
  }
});
