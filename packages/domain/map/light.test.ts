import {test} from 'node:test';
import assert from 'node:assert/strict';
import {betterSeen, lightFrom, seenLight, seenThrough} from './light.ts';

test('a torch: bright light to 20 ft, dim light 20 ft further, then nothing', () => {
  const torch = {bright: 20, dim: 20};
  assert.equal(lightFrom(0, torch), 2);
  assert.equal(lightFrom(20, torch), 2);
  assert.equal(lightFrom(25, torch), 1);
  assert.equal(lightFrom(40, torch), 1);
  assert.equal(lightFrom(45, torch), null);
  assert.equal(lightFrom(5, {bright: 0, dim: 10}), 1, 'dancing lights only shed dim light');
});

test('darkvision sees dim light as bright and darkness as grey dim light, within its range', () => {
  assert.equal(seenLight(2, 100, 0), 'bright');
  assert.equal(seenLight(1, 100, 0), 'dim');
  assert.equal(seenLight(0, 5, 0), null, 'a human in the dark sees nothing');
  assert.equal(seenLight(1, 60, 60), 'bright');
  assert.equal(seenLight(0, 60, 60), 'dark');
  assert.equal(seenLight(0, 65, 60), null, 'beyond darkvision — dark');
});

test('of two looks at one cell the better one wins', () => {
  assert.equal(betterSeen(undefined, 'dark'), 'dark');
  assert.equal(betterSeen('dark', 'dim'), 'dim');
  assert.equal(betterSeen('bright', 'dim'), 'bright');
});

test('magical darkness: darkvision sees nothing in it, light does not help; devil’s sight sees within 120 ft', () => {
  assert.equal(seenThrough(0, 10, 60), 'dark', 'plain darkness — darkvision sees it grey');
  assert.equal(seenThrough(0, 10, 60, {magicalDarkness: true}), null, 'magical darkness — darkvision does not');
  assert.equal(seenThrough(2, 10, 60, {magicalDarkness: true}), null, 'a torch inside does not light it');
  assert.equal(seenThrough(0, 100, 0, {magicalDarkness: true, devilsSightFeet: 120}), 'bright', 'devil’s sight sees normally');
  assert.equal(seenThrough(0, 130, 0, {magicalDarkness: true, devilsSightFeet: 120}), null, 'beyond 120 ft — no');
  assert.equal(seenThrough(0, 30, 0, {devilsSightFeet: 120}), 'bright', 'plain darkness too — normal sight, not grey');
  assert.equal(seenThrough(1, 30, 0), seenLight(1, 30, 0), 'otherwise — as before');
});
