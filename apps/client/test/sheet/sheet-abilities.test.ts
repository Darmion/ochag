import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ABILITIES, ABILITY_BY_INDEX, formatSigned, modifier, modifierValue } from '../../src/characterSheet/abilities.ts';

test('ability modifiers round down like the rules', () => {
  assert.deepEqual([1, 8, 9, 10, 11, 15, 20, 30].map(modifierValue), [-5, -1, -1, 0, 0, 2, 5, 10]);
  assert.deepEqual([modifier(10), modifier(15), modifier(7)], ['+0', '+2', '-2']);
  assert.deepEqual([formatSigned(0), formatSigned(4), formatSigned(-3)], ['+0', '+4', '-3']);
});

test('short ability keys map to the six abilities', () => {
  assert.deepEqual(Object.values(ABILITY_BY_INDEX), [...ABILITIES]);
  assert.equal(ABILITY_BY_INDEX.wis, 'wisdom');
});
