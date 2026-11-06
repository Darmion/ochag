import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pactMagic, spellSlotsFor} from './spell-slots.ts';

test('full casters by the PHB table', () => {
  assert.deepEqual(spellSlotsFor('wizard', 1), [2, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(spellSlotsFor('cleric', 5), [4, 3, 2, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(spellSlotsFor('bard', 20), [4, 3, 3, 3, 3, 2, 2, 1, 1]);
});

test('half casters from 2nd level; warlocks have pact slots of one level; others none', () => {
  assert.deepEqual(spellSlotsFor('paladin', 1), [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(spellSlotsFor('paladin', 2), [2, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(spellSlotsFor('ranger', 5), [4, 2, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(spellSlotsFor('paladin', 20), [4, 3, 3, 3, 2, 0, 0, 0, 0]);
  assert.deepEqual(spellSlotsFor('warlock', 5), [0, 0, 2, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(pactMagic(11), {count: 3, slotLevel: 5});
  assert.deepEqual(pactMagic(17), {count: 4, slotLevel: 5});
  assert.equal(spellSlotsFor('fighter', 10), null);
  assert.equal(spellSlotsFor(null, 10), null);
});

test('multiclass spellcaster slots (PHB p. 165) and pact magic apart', async () => {
  const {multiclassSpellSlots} = await import('./spell-slots.ts');
  assert.equal(multiclassSpellSlots([{id: 'fighter', level: 5}, {id: 'rogue', level: 3}]), null, 'no casters');
  assert.deepEqual(multiclassSpellSlots([{id: 'fighter', level: 3}, {id: 'wizard', level: 2}])!.slots.slice(0, 2), [3, 0], 'one caster — its own table');
  assert.deepEqual(multiclassSpellSlots([{id: 'wizard', level: 3}, {id: 'cleric', level: 2}])!.slots.slice(0, 3), [4, 3, 2], 'caster level 5');
  assert.deepEqual(multiclassSpellSlots([{id: 'paladin', level: 5}, {id: 'sorcerer', level: 1}])!.slots.slice(0, 2), [4, 2], 'paladin half (2) + sorcerer 1 = 3');
  const pact = multiclassSpellSlots([{id: 'warlock', level: 3}, {id: 'sorcerer', level: 2}])!;
  assert.deepEqual([pact.slots.slice(0, 2), pact.pact, pact.casters], [[3, 0], {count: 2, slotLevel: 2}, 2], 'pact slots do not join the sum');
});
