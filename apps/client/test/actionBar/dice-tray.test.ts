import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singleD20, trayFormula } from '../../src/actionBar/diceFormula.ts';

test('an empty tray rolls nothing, a bare modifier rolls as a number', () => {
  assert.equal(trayFormula({}, 0, 'none'), '');
  assert.equal(trayFormula({}, 3, 'none'), '3');
  assert.equal(trayFormula({}, -2, 'none'), '-2');
});

test('dice are listed from small to large with the modifier at the end', () => {
  assert.equal(trayFormula({ 8: 1, 6: 2 }, 3, 'none'), '2d6+1d8+3');
  assert.equal(trayFormula({ 100: 1, 4: 3 }, -1, 'none'), '3d4+1d100-1');
  assert.equal(trayFormula({ 6: 0, 10: 1 }, 0, 'none'), '1d10');
});

test('advantage and disadvantage apply only to a single d20', () => {
  assert.equal(trayFormula({ 20: 1 }, 5, 'adv'), '2d20kh1+5');
  assert.equal(trayFormula({ 20: 1 }, 0, 'disadv'), '2d20kl1');
  assert.equal(trayFormula({ 20: 2 }, 0, 'adv'), '2d20');
  assert.equal(trayFormula({ 20: 1, 6: 1 }, 0, 'adv'), '1d6+1d20');
});

test('a single d20 is one d20 and no other dice', () => {
  assert.equal(singleD20({ 20: 1 }), true);
  assert.equal(singleD20({ 20: 1, 6: 0 }), true);
  assert.equal(singleD20({ 20: 1, 8: 1 }), false);
  assert.equal(singleD20({ 20: 2 }), false);
  assert.equal(singleD20({}), false);
});
