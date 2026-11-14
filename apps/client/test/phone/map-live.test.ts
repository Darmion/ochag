import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyPose, buzzOnTurn, coalesce } from '../../src/phone/mapLive.ts';

test('a burst of messages becomes one reload; one more comes after a reload that was busy', async () => {
  const timers: Array<() => void> = [];
  let runs = 0;
  let release: () => void = () => {};
  const trigger = coalesce(() => new Promise<void>(resolve => { runs += 1; release = resolve; }), 200, fn => timers.push(fn));
  trigger(); trigger(); trigger();
  assert.equal(timers.length, 1, 'one timer for the burst');
  timers.shift()!();
  assert.equal(runs, 1);
  trigger(); trigger();
  assert.equal(timers.length, 0, 'nothing new while the reload runs');
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.length, 1, 'the message that came meanwhile asks for one more');
  timers.shift()!();
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runs, 2);
  assert.equal(timers.length, 0);
});

test('a pose moves only the figure it names', () => {
  const objects = [{ id: 'a', world_x: 0.5, world_z: 0.5 }, { id: 'b', world_x: 2.5, world_z: 1.5 }];
  assert.equal(applyPose(objects, { kind: 'object', id: 'a', x: 3.5, z: -1.5 }), true);
  assert.deepEqual(objects[0], { id: 'a', world_x: 3.5, world_z: -1.5 });
  assert.equal(applyPose(objects, { kind: 'object', id: 'a', x: 3.5, z: -1.5 }), false, 'the same place — nothing to redraw');
  assert.equal(applyPose(objects, { kind: 'object', id: 'other', x: 1, z: 1 }), false);
  assert.equal(applyPose(objects, { kind: 'object', id: 'b', x: Number.NaN, z: 1 }), false);
  assert.equal(applyPose(objects, { kind: 'wall', id: 'b', x: 1, z: 1 }), false);
  assert.deepEqual(objects[1], { id: 'b', world_x: 2.5, world_z: 1.5 });
});

test('the phone buzzes once when the turn starts, and never without vibration', () => {
  const calls: number[][] = [];
  const vibrate = (pattern: number[]) => calls.push(pattern);
  assert.equal(buzzOnTurn(false, true, vibrate), true);
  assert.equal(buzzOnTurn(true, true, vibrate), false, 'still my turn — no second buzz');
  assert.equal(buzzOnTurn(true, false, vibrate), false);
  assert.equal(buzzOnTurn(false, true, undefined), false);
  assert.deepEqual(calls, [[120, 60, 120]]);
});
