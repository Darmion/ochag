import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChase, actChase, chaseDifficulty } from './chase.ts';
const user = { name: 'Беглец', manager: false };
const route = (game = createChase(1), index = 2, obstacle = 0) => actChase(game, { action: 'route', route: index }, user, () => obstacle);
test('chase: route locks, obstacle advantage and successful escape', () => {
  let game = route();
  assert.equal(chaseDifficulty(game, 'sprint'), 4); assert.equal(chaseDifficulty(game, 'hide'), 5);
  assert.throws(() => route(game));
  game = actChase(game, { action: 'sprint' }, user, () => 3);
  assert.equal(game.progress, 3); assert.equal(game.gap, 6); assert.equal(game.stamina, 2);
  for (let i = 0; i < 3; i++) game = actChase(route(game), { action: 'hide' }, user, () => 5);
  assert.equal(game.phase, 'escaped'); assert.equal(game.turn, 4);
  assert.throws(() => route(game));
});
test('chase: failed sprint costs stamina, detour restores it and zero gap beats arrival', () => {
  let game = actChase(route(), { action: 'sprint' }, user, () => 0);
  assert.equal(game.stamina, 2); assert.equal(game.gap, 2); assert.equal(game.progress, 1);
  game = actChase(route(game), { action: 'detour' }, user, () => { throw new Error('No die on detour'); });
  assert.equal(game.stamina, 3); assert.equal(game.gap, 1);
  game.progress = 9;
  game = actChase(route(game), { action: 'detour' }, user, () => 0);
  assert.equal(game.progress, 10); assert.equal(game.phase, 'caught');
});
test('chase: last section may win; otherwise the time limit catches the party', () => {
  const initial = route(); initial.turn = 7; initial.progress = 7;
  assert.equal(actChase(initial, { action: 'hide' }, user, () => 5).phase, 'escaped');
  initial.progress = 6;
  assert.equal(actChase(initial, { action: 'hide' }, user, () => 5).phase, 'caught');
});
test('chase: invalid actions never consume randomness or mutate state; GM can cancel', () => {
  const initial = createChase(1);
  const noRandom = () => { throw new Error('Unexpected randomness'); };
  assert.throws(() => actChase(initial, { action: 'hide' }, user, noRandom), /Сначала/);
  assert.throws(() => actChase(initial, { action: 'route', route: 99 }, user, noRandom), /Маршрут/);
  const game = route(); game.stamina = 0;
  assert.throws(() => actChase(game, { action: 'sprint' }, user, noRandom), /Нет сил/);
  assert.throws(() => actChase(game, { action: 'cancel' }, user, noRandom), /мастер/);
  assert.equal(actChase(game, { action: 'cancel' }, { ...user, manager: true }, noRandom).phase, 'cancelled');
  assert.equal(game.phase, 'obstacle'); assert.equal(initial.revision, 1);
  assert.throws(() => actChase(game, { action: 'hide' }, user, () => 6), /Некорректный/);
});
