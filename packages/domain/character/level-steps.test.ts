import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceClassText } from './classes.ts';
import { hpAfterLevelDown, lastLevelStep, simpleLevelStep, withLevelStep, withoutLastLevelStep } from './level-steps.ts';

test('a lowered class loses one level; at zero it leaves the class text', () => {
  assert.equal(reduceClassText('Воин 3 / Волшебник 2', 5, 'wizard'), 'Воин 3 / Волшебник 1');
  assert.equal(reduceClassText('Воин 3 / Волшебник 1', 4, 'wizard'), 'Воин 3');
  assert.equal(reduceClassText('Плут (Вор) 1 / Воин 2', 3, 'rogue'), 'Воин 2');
  assert.equal(reduceClassText('Волшебник (Школа Воплощения)', 4, 'wizard'), 'Волшебник (Школа Воплощения)', 'a single class keeps its text');
  assert.equal(reduceClassText('Воин 3 / Волшебник 2', 5, 'cleric'), null);
});

test('steps are kept in order; a new step drops the ones above it', () => {
  const two = simpleLevelStep(1, 2, 7, 'Воин', 'fighter');
  const three = simpleLevelStep(2, 3, 7, 'Воин', 'fighter');
  const steps = withLevelStep(withLevelStep([], two), three);
  assert.equal(lastLevelStep(steps, 3), three);
  assert.equal(lastLevelStep(steps, 4), null, 'the hero is not on the level the last step reached');
  assert.deepEqual(withoutLastLevelStep(steps, 3), [two]);
  assert.deepEqual(withLevelStep(steps, simpleLevelStep(1, 2, 5, 'Воин', 'fighter')).map(step => step.hpGain), [5], 'a fresh step 1 → 2 replaces both');
  assert.deepEqual(lastLevelStep('broken', 2), null);
});

test('hit points after a lower level: never below 1 while conscious, untouched at 0', () => {
  assert.deepEqual(hpAfterLevelDown(30, 40, 12), { current: 18, max: 28 });
  assert.deepEqual(hpAfterLevelDown(5, 40, 12), { current: 1, max: 28 });
  assert.deepEqual(hpAfterLevelDown(0, 40, 12), { current: 0, max: 28 });
});
