import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encounterDifficulty, encounterMultiplier, partyThresholds} from './encounter-difficulty.ts';

test('party thresholds add up per hero (DMG, p. 82)', () => {
  assert.deepEqual(partyThresholds([3, 3, 3, 3]), {easy: 300, medium: 600, hard: 900, deadly: 1600});
  assert.deepEqual(partyThresholds([1, 5, 20]), {easy: 25 + 250 + 2800, medium: 50 + 500 + 5700, hard: 75 + 750 + 8500, deadly: 100 + 1100 + 12700});
  assert.deepEqual(partyThresholds([0, 25]), partyThresholds([1, 20]), 'levels are clamped to 1–20');
});

test('the multiplier grows with the number of foes and shifts with the party size', () => {
  assert.deepEqual([1, 2, 3, 6, 7, 10, 11, 14, 15, 30].map(count => encounterMultiplier(count, 4)), [1, 1.5, 2, 2, 2.5, 2.5, 3, 3, 4, 4]);
  assert.equal(encounterMultiplier(1, 2), 1.5, 'a small party: one step up');
  assert.equal(encounterMultiplier(15, 1), 5);
  assert.equal(encounterMultiplier(1, 6), 0.5, 'a big party: one step down');
  assert.equal(encounterMultiplier(3, 7), 1.5);
});

test('ratings: four level-3 heroes against an owlbear, goblins, an ogre', () => {
  const party = [3, 3, 3, 3];
  assert.equal(encounterDifficulty(party, [700]).rating, 'medium');
  const goblins = encounterDifficulty(party, [50, 50, 50, 50]);
  assert.deepEqual([goblins.experience, goblins.multiplier, goblins.adjusted, goblins.rating, goblins.label], [200, 2, 400, 'easy', 'лёгкая']);
  assert.equal(encounterDifficulty(party, [450, 450]).rating, 'hard', '900 × 1.5 = 1350');
  assert.equal(encounterDifficulty(party, [1100, 450]).rating, 'deadly', '1550 × 1.5 = 2325');
  assert.equal(encounterDifficulty(party, [10, 10]).rating, 'trivial');
  assert.equal(encounterDifficulty([1, 1, 1, 1], [50, 50, 50]).rating, 'hard', '150 × 2 = 300 for four level-1 heroes');
  assert.equal(encounterDifficulty([], [450]).rating, 'trivial', 'nobody to fight');
  assert.equal(encounterDifficulty(party, [0, 0]).monsters, 0, 'creatures worth no experience do not count');
});
