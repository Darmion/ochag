import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkView, peerlessNote } from '../../src/actionBar/checkView.ts';

test('the checks window follows its tab', () => {
  assert.deepEqual(checkView('checks', 'skill'), { kind: 'skill', tabs: true, heading: null, sense: true });
  assert.deepEqual(checkView('checks', 'save'), { kind: 'save', tabs: true, heading: null, sense: false });
  assert.equal(checkView('checks', 'ability').sense, true);
});

test('single check windows have a heading and ignore the tab', () => {
  assert.deepEqual(checkView('skill', 'save'), { kind: 'skill', tabs: false, heading: 'Навык', sense: true });
  assert.deepEqual(checkView('save', 'skill'), { kind: 'save', tabs: false, heading: 'Спасбросок', sense: false });
  assert.deepEqual(checkView('ability', 'save'), { kind: 'ability', tabs: false, heading: 'Проверка характеристики', sense: true });
  assert.deepEqual(checkView('loot', 'skill'), { kind: 'ability', tabs: false, heading: 'Проверка характеристики', sense: false });
});

test('peerless skill shows its die and inspiration left', () => {
  assert.equal(peerlessNote({ detail: 'к8 к проверке', resource: { current: 2, max: 3 } }), 'к8 к броску (вдохновение 2/3)');
  assert.equal(peerlessNote({ detail: 'к10 к проверке', resource: null }), 'к10 к броску');
});
