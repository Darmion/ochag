import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupEnd, groupFrom, nextGroup, turnSide, type TurnSide } from './turn-groups.ts';

test('turn groups: allies in a row share the turn; neutrals and bare entries go alone; no wrap over the round', () => {
  assert.equal(turnSide('character', null), 'party');
  assert.equal(turnSide('npc', 'friendly'), 'party');
  assert.equal(turnSide('npc', 'hostile'), 'enemy');
  assert.equal(turnSide('npc', 'neutral'), null);
  assert.equal(turnSide(null, null), null);

  const sides: TurnSide[] = ['party', 'party', 'enemy', 'enemy', null, 'party'];
  assert.deepEqual(groupFrom(sides, 0), [0, 1]);
  assert.deepEqual(groupFrom(sides, 0, false), [0]);
  assert.deepEqual(groupFrom(sides, 4), [4]);
  assert.equal(groupEnd(sides, 0), 1, 'Лира ended early — the group still runs to Бран');

  assert.deepEqual(nextGroup(sides, []), { indices: [0, 1], wrapped: false });
  assert.deepEqual(nextGroup(sides, [0, 1]), { indices: [2, 3], wrapped: false });
  assert.deepEqual(nextGroup(sides, [0]), { indices: [2, 3], wrapped: false }, 'Бран finished first, Лира last');
  assert.deepEqual(nextGroup(sides, [3]), { indices: [4], wrapped: false });
  assert.deepEqual(nextGroup(sides, [4]), { indices: [5], wrapped: false });
  assert.deepEqual(nextGroup(sides, [5]), { indices: [0, 1], wrapped: true }, 'Мирра at the end of the round does not join Лира and Бран');
  assert.deepEqual(nextGroup(sides, [0], false), { indices: [1], wrapped: false }, 'group_turns off — one by one');
});
