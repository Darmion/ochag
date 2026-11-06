import {test} from 'node:test';
import assert from 'node:assert/strict';
import {coverBetween, rangeBand} from './targeting.ts';

test('range bands: reach, thrown and ranged weapons, normal and long', () => {
  const sword = {kind: 'melee' as const, reach: 5, normal: null, long: null};
  assert.deepEqual(rangeBand(sword, 5), {ok: true, ranged: false, long: false});
  assert.deepEqual(rangeBand(sword, 10), {ok: false, limit: 5});
  const glaive = {kind: 'melee' as const, reach: 10, normal: null, long: null};
  assert.equal(rangeBand(glaive, 10).ok, true);
  const dagger = {kind: 'melee' as const, reach: 5, normal: 20, long: 60};
  assert.deepEqual(rangeBand(dagger, 5), {ok: true, ranged: false, long: false}, 'in reach it is a melee attack');
  assert.deepEqual(rangeBand(dagger, 20), {ok: true, ranged: true, long: false});
  assert.deepEqual(rangeBand(dagger, 45), {ok: true, ranged: true, long: true});
  assert.deepEqual(rangeBand(dagger, 65), {ok: false, limit: 60});
  const bow = {kind: 'ranged' as const, reach: 80, normal: 80, long: 320};
  assert.deepEqual(rangeBand(bow, 5), {ok: true, ranged: true, long: false}, 'a bow next to the target is still a ranged attack');
  assert.deepEqual(rangeBand(bow, 100), {ok: true, ranged: true, long: true});
  assert.deepEqual(rangeBand(bow, 330), {ok: false, limit: 320});
  const old = {kind: 'ranged' as const, reach: 80, normal: null, long: null};
  assert.deepEqual(rangeBand(old, 100), {ok: false, limit: 80}, 'no long range — the single range is the limit');
});

test('cover by the DMG grid rule: walls give half, three-quarters and total; creatures at most half', () => {
  const attacker = {x: 0.5, z: 0.5, size: 1};
  const target = {x: 4.5, z: 0.5, size: 1};
  assert.equal(coverBetween(attacker, target, [], []), 'none');
  assert.equal(coverBetween(attacker, target, [{x1: 2, z1: -3, x2: 2, z2: 3}], []), 'total');
  assert.equal(coverBetween(attacker, {x: 1.5, z: 0.5, size: 1}, [{x1: 1, z1: 0, x2: 1, z2: 1}], []), 'total');
  assert.equal(coverBetween(attacker, target, [{x1: 3, z1: 0.5, x2: 3, z2: 2}], []), 'half');
  assert.equal(coverBetween({x: 0.5, z: -2.5, size: 1}, target, [{x1: 4, z1: 0, x2: 4, z2: 3}], []), 'three-quarters');
  assert.equal(coverBetween(attacker, target, [], [{x: 2.5, z: 0.5, size: 1}]), 'half');
  assert.equal(coverBetween(attacker, target, [], [{x: 2.5, z: 0.5, size: 3}]), 'half');
  assert.equal(coverBetween(attacker, {x: 1.5, z: 0.5, size: 1}, [], []), 'none');
});
