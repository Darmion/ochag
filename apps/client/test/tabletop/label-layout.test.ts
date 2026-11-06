import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutLabels, type LabelBlock } from '../../src/tabletop/labelLayout.ts';

const size = { width: 1000, height: 700 };
const block = (id: string, x: number, y: number, priority = 1): LabelBlock => ({ id, x, y, width: 80, above: 18, below: 16, priority });

test('separate labels stay where they are', () => {
  const shifts = layoutLabels([block('a', 200, 300), block('b', 500, 300)], size);
  assert.deepEqual(shifts.get('a'), { dx: 0, dy: 0, lift: 0 });
  assert.deepEqual(shifts.get('b'), { dx: 0, dy: 0, lift: 0 });
});

test('two neighbours no longer overlap: the one in front stays, the other moves by the nearest free edge', () => {
  const shifts = layoutLabels([block('lira', 300, 300), block('scout', 310, 320)], size);
  assert.deepEqual(shifts.get('scout'), { dx: 0, dy: 0, lift: 0 });
  assert.equal(shifts.get('lira')!.dy, -20);
  assert.ok(300 - 20 + 16 <= 320 - 18 - 6);
});

test('the current turn and the selected creature keep their place', () => {
  const shifts = layoutLabels([block('goblin', 300, 320), block('current', 300, 300, 3)], size);
  assert.deepEqual(shifts.get('current'), { dx: 0, dy: 0, lift: 0 });
  assert.notEqual(shifts.get('goblin')!.dy, 0);
});

test('a label no further than maxShift: a crowd stays overlapped rather than drifting away', () => {
  const crowd = [0, 1, 2, 3, 4].map(index => block(`c${index}`, 400, 300 + index));
  const shifts = layoutLabels(crowd, size, { maxShift: 40 });
  for (const shift of shifts.values()) assert.ok(Math.abs(shift.lift) <= 40);
});

test('labels at the canvas edge are pulled inside', () => {
  const shifts = layoutLabels([block('right', 990, 300), block('left', 10, 300), block('top', 500, 5)], size);
  assert.equal(shifts.get('right')!.dx, 1000 - 4 - (990 + 40));
  assert.equal(shifts.get('left')!.dx, 4 - (10 - 40));
  assert.equal(shifts.get('top')!.dy, 4 - (5 - 18));
});

test('a shift away from a neighbour never pushes a label over the canvas edge', () => {
  const shifts = layoutLabels([block('a', 400, 22), block('b', 410, 22)], size);
  for (const id of ['a', 'b']) assert.ok(22 - 18 + shifts.get(id)!.dy >= 4, `${id}: ${JSON.stringify(shifts.get(id))}`);
  assert.notEqual(shifts.get('a')!.dy, shifts.get('b')!.dy);
});

test('the previous frame keeps its choice while it still works (no jumping while the camera turns)', () => {
  const small = (id: string, y: number): LabelBlock => ({ id, x: 300, y, width: 80, above: 10, below: 8, priority: 1 });
  const fresh = layoutLabels([small('a', 300), small('b', 305)], size);
  assert.equal(fresh.get('a')!.lift, -19);
  const kept = layoutLabels([small('a', 300), small('b', 305)], size, { previous: new Map([['a', { dx: 0, dy: 29, lift: 29 }]]) });
  assert.equal(kept.get('a')!.lift, 29);
  assert.equal(kept.get('b')!.lift, 0);
});
