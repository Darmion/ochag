import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dragSlows, movesTowardFear} from './grapple-fear.ts';

test('dragging halves speed unless the dragged creature is two sizes smaller or more', () => {
  assert.equal(dragSlows('medium', 'medium'), true);
  assert.equal(dragSlows('medium', 'small'), true, 'one size smaller still slows');
  assert.equal(dragSlows('medium', 'tiny'), false);
  assert.equal(dragSlows('large', 'small'), false);
  assert.equal(dragSlows('small', 'large'), true);
  assert.equal(dragSlows(null, undefined), true, 'unknown sizes count as medium');
});

test('a frightened creature may step back or sideways, not closer', () => {
  assert.equal(movesTowardFear(20, 15), true);
  assert.equal(movesTowardFear(20, 20), false);
  assert.equal(movesTowardFear(20, 25), false);
});
