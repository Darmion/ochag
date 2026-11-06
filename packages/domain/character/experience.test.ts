import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  challengeExperience, experienceFor, levelForExperience, levelUpHitPoints, nextLevelExperience, splitExperience,
} from './experience.ts';

test('levels by the PHB experience table', () => {
  assert.equal(levelForExperience(0), 1);
  assert.equal(levelForExperience(299), 1);
  assert.equal(levelForExperience(300), 2);
  assert.equal(levelForExperience(6500), 5);
  assert.equal(levelForExperience(1_000_000), 20);
  assert.equal(nextLevelExperience(1), 300);
  assert.equal(nextLevelExperience(4), 6500);
  assert.equal(nextLevelExperience(null), 300);
  assert.equal(nextLevelExperience(20), null);
});

test('experience for a creature: the hand-set value, else the DMG table by challenge', () => {
  assert.equal(challengeExperience(0.25), 50);
  assert.equal(challengeExperience(5), 1800);
  assert.equal(challengeExperience(31), null);
  assert.equal(experienceFor({challenge_rating: '0.250'}), 50, 'numeric columns come back as strings');
  assert.equal(experienceFor({challenge_rating: 1, xp_award: 0}), 0, 'an explicit 0 wins');
  assert.equal(experienceFor({}), 0);
});

test('experience is split evenly without fractions; level-up hit points use the fixed value', () => {
  assert.equal(splitExperience(50, 3), 16);
  assert.equal(splitExperience(50, 0), 0);
  assert.equal(levelUpHitPoints(8, 2, 1), 7);
  assert.equal(levelUpHitPoints(6, -4, 2), 2, 'at least 1 per level');
});
