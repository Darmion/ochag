import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareTopics, normalizeSearch, ruleTopic, topicLabel } from '../../src/rulesTab/topics.ts';

test('ruleTopic takes a known key first, then guesses by words', () => {
  assert.equal(ruleTopic('pact_slots'), 'magic');
  assert.equal(ruleTopic('my_rule', 'Привал у костра'), 'recovery');
  assert.equal(ruleTopic('house_rule', 'Урон от падения'), 'combat');
  assert.equal(ruleTopic('house_rule', 'Погода'), 'other');
});

test('normalizeSearch lowercases, trims and treats ё as е', () => {
  assert.equal(normalizeSearch('  Ёжик '), 'ежик');
  assert.equal(normalizeSearch(null), '');
});

test('topics sort in the listed order and have Russian labels', () => {
  assert.ok(compareTopics('combat', 'other') < 0);
  assert.equal(topicLabel('magic'), 'Магия');
});
