import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCheck } from './skill-checks.ts';
import { applyRuneCheck, createRuneLock } from './rune-lock.ts';
import { actDragonGame, applyCheat, createDragonGame, type DragonGame } from './dragon-dice.ts';

const hero = { id: 'h1', name: 'Лира' };

test('the GM picks a skill that fits the game and a DC from 5 to 30', () => {
  assert.equal(newCheck('rune-lock', undefined, undefined), null);
  assert.deepEqual(newCheck('rune-lock', 'arcana', 15), { skill: 'arcana', dc: 15, tried: [] });
  assert.throws(() => newCheck('rune-lock', 'athletics', 15), /не подходит/);
  assert.throws(() => newCheck('map-fragments', 'history', 31), /от 5 до 30/);
});

test('a failed check spends the hero\'s try and fixes nothing', () => {
  const lock = createRuneLock([1, 2, 3], '', 4, 1, undefined, null, newCheck('rune-lock', 'arcana', 15));
  const after = applyRuneCheck(lock, 0, hero, false);
  assert.deepEqual(after.revealed, [false, false, false]);
  assert.deepEqual(after.check?.tried, [hero]);
  assert.throws(() => applyRuneCheck(after, 2, hero, true), /уже была попытка/);
  assert.throws(() => applyRuneCheck(createRuneLock([1, 2, 3], '', 4, 1), 0, hero, true), /не назначил/);
});

test('a hidden dragon keeps the turn going; a caught cheat burns the pot', () => {
  const user = { id: 'u1', name: 'Игрок' };
  let game: DragonGame = actDragonGame(createDragonGame(user.id, user.name), 'start', user, () => 1);
  game = actDragonGame(game, 'roll', user, () => 6);
  assert.throws(() => applyCheat(game, user, true), /Прятать нечего/);
  game = actDragonGame(game, 'roll', user, () => 1);
  assert.equal(game.dragons, 1);

  const hidden = applyCheat(game, user, true);
  assert.equal(hidden.dragons, 0);
  assert.equal(hidden.pot, 10);
  assert.equal(hidden.turn, 0);
  assert.throws(() => applyCheat({ ...actDragonGame(hidden, 'roll', user, () => 1) }, user, true), /один раз за партию/);

  const caught = applyCheat(game, user, false);
  assert.equal(caught.pot, 0);
  assert.equal(caught.players[0]!.score, 0);
  assert.equal(caught.round, 2, 'alone at the table, the next turn is the next round');
});
