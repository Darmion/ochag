import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPalette } from '../../src/ui/paletteSearch.ts';

const english: Record<string, string> = {
  'Инструменты': 'Tools',
  'Камера: вся доска': 'Camera: whole board',
  'вернуть камеру вписать': 'reset camera fit frame',
  'Окна': 'Windows',
  'Заметки': 'Notes',
};
const shown = (text: string) => english[text] ?? text;
const items = [
  { id: 'camera', group: 'Инструменты', label: 'Камера: вся доска', keywords: 'вернуть камеру вписать' },
  { id: 'notes', group: 'Окна', label: 'Заметки' },
  { id: 'goblin', group: 'Объекты на сцене', label: 'Гоблин', sub: '7/7' },
];
const ids = (query: string, translate = shown) => searchPalette(items, query, translate).map(item => item.id);

test('english words find russian items by their shown translation', () => {
  assert.deepEqual(ids('camera'), ['camera']);
  assert.deepEqual(ids('notes'), ['notes']);
  assert.deepEqual(ids('fit'), ['camera'], 'keywords are searched in translation too');
  assert.deepEqual(ids('tools'), ['camera'], 'and the group');
});

test('russian words still work, also mixed with english', () => {
  assert.deepEqual(ids('заметки'), ['notes']);
  assert.deepEqual(ids('камера whole'), ['camera']);
  assert.deepEqual(ids('гоб'), ['goblin']);
});

test('without a translation only the source text is searched', () => {
  assert.deepEqual(ids('camera', text => text), []);
  assert.deepEqual(ids('кам', text => text), ['camera']);
});

test('words match by their start, every part must match', () => {
  assert.deepEqual(ids('amera'), []);
  assert.deepEqual(ids('camera notes'), []);
  assert.deepEqual(ids('7'), ['goblin'], 'the caption counts');
});

test('an empty query lists items up to the limit', () => {
  assert.equal(searchPalette(items, '  ', shown).length, 3);
  assert.equal(searchPalette(items, '', shown, 2).length, 2);
});
