import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classTextOf, guessHitDie, hitDiceLeft, hitDiceRecovered, hitDieHealing, recharges} from './rest.ts';

test('hit die by class, Russian or English; d8 otherwise', () => {
  assert.equal(guessHitDie('Варвар'), 12);
  assert.equal(guessHitDie('Fighter 3 / Wizard 2'), 10, 'the first matching group wins');
  assert.equal(guessHitDie('Паладин'), 10);
  assert.equal(guessHitDie('Волшебник'), 6);
  assert.equal(guessHitDie('Плут'), 8);
  assert.equal(guessHitDie(null), 8);
  assert.equal(classTextOf({info: {charClass: {value: 'Следопыт'}}}), 'Следопыт');
  assert.equal(classTextOf({}), null);
});

test('hit dice: as many as levels, a long rest gives back half (at least one)', () => {
  assert.equal(hitDiceLeft(5, 2), 3);
  assert.equal(hitDiceLeft(null, 0), 1, 'no level — one die');
  assert.equal(hitDiceLeft(3, 7), 0);
  assert.equal(hitDiceRecovered(1), 1);
  assert.equal(hitDiceRecovered(5), 2);
  assert.equal(hitDiceRecovered(20), 10);
});

test('a hit die heals the roll plus CON, never below zero; resources recharge by kind', () => {
  assert.equal(hitDieHealing(5, 2), 7);
  assert.equal(hitDieHealing(1, -3), 0);
  assert.equal(recharges('short', 'short'), true);
  assert.equal(recharges('short', 'long'), true);
  assert.equal(recharges('long', 'short'), false);
  assert.equal(recharges('long', 'long'), true);
  assert.equal(recharges('none', 'long'), false);
});

test('multiclass hit dice: a pool per die size, the biggest spent and recovered first', async () => {
  const {hitDicePools, hitDiceText, recoverHitDice, spendHitDice, spentByDieOf} = await import('./rest.ts');
  const classes = [{id: 'fighter' as const, level: 3}, {id: 'wizard' as const, level: 2}];
  const pools = hitDicePools(classes, null, 5, 0);
  assert.equal(hitDiceText(pools), '3d10 + 2d6');
  const spent = spendHitDice(pools, 4);
  assert.deepEqual(spent.dice, [10, 10, 10, 6], 'd10s first — more healing');
  assert.equal(hitDiceText(spent.pools, 'left'), '0d10 + 1d6');
  const back = recoverHitDice(spent.pools, 2);
  assert.deepEqual(spentByDieOf(back.pools), {10: 1, 6: 1}, 'a long rest gives d10s back first');
  assert.deepEqual(hitDicePools(classes, null, 5, 2, {10: 1, 6: 1}).map(pool => pool.spent), [1, 1], 'stored per die');
  assert.deepEqual(hitDicePools(classes, null, 5, 2, null).map(pool => pool.spent), [2, 0], 'nothing stored — as if the biggest were spent');
  assert.deepEqual(hitDicePools([{id: 'fighter', level: 5}], 12, 5, 0), [{die: 12, total: 5, spent: 0}], 'one class: the sheet override wins');
  assert.equal(hitDiceText(hitDicePools([{id: 'fighter', level: 2}, {id: 'paladin', level: 2}], null, 4, 0)), '4d10', 'same die — one pool');
});
