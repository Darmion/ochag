import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, plainText, weaponTitle } from '../../src/characterSheet/sheetExtra.ts';

test('imported values read as plain text', () => {
  assert.equal(describe(null), '—');
  assert.equal(describe(5), '5');
  assert.equal(describe({ value: 5, proficient: true }), '5');
  assert.equal(describe({ bonus: 2, note: '', extra: null }), 'bonus: 2');
  assert.equal(plainText({ content: [{ type: 'paragraph', content: [{ text: 'Свобода' }] }] }), 'Свобода');
});

test('weapon titles come from the name or the description', () => {
  assert.equal(weaponTitle({ name: 'Кинжал', damage: '1d4' }), 'Кинжал');
  assert.equal(weaponTitle({ name: '' }), 'Оружие');
  assert.equal(weaponTitle('Праща'), 'Праща');
});
