import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAction } from '../../../../packages/domain/spells/spell-template.ts';
import { addAction, duplicate, toggleIn } from '../../src/spellBuilder/edits.ts';

test('toggleIn adds a missing value and removes a present one', () => {
  const list = ['wizard'];
  toggleIn(list, 'bard');
  assert.deepEqual(list, ['wizard', 'bard']);
  toggleIn(list, 'wizard');
  assert.deepEqual(list, ['bard']);
});

test('a new action is numbered after the existing ones', () => {
  const list = [emptyAction('Луч')];
  addAction(list);
  assert.equal(list[1]!.name, 'Действие 2');
});

test('a duplicate is a deep copy with its own id, right after the original', () => {
  const original = emptyAction('Луч');
  const list = [original, emptyAction('Другое')];
  duplicate(list, 0);
  assert.deepEqual(list.map(action => action.name), ['Луч', 'Луч', 'Другое']);
  assert.notEqual(list[1]!.id, original.id);
  assert.notEqual(list[1]!.check, original.check);
  assert.deepEqual(list[1]!.check, original.check);
});
