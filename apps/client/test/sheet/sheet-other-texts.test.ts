import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factLines, storyEntries, textOf, titledCards } from '../../src/characterSheet/otherTexts.ts';

test('languages and proficiencies split into labelled facts', () => {
  assert.deepEqual(factLines('Языки: Общий, Эльфийский\nДоспехи: лёгкие.\n\nВоровские инструменты'), [
    { label: 'Языки', value: 'Общий, Эльфийский' },
    { label: 'Доспехи', value: 'лёгкие' },
    { label: '', value: 'Воровские инструменты' },
  ]);
  assert.deepEqual(factLines(''), []);
});

test('features become titled cards by blank lines or by lines', () => {
  assert.deepEqual(titledCards('Тёмное зрение. Видит в темноте.\n\nЯрость. Бонусным действием.'), [
    { title: 'Тёмное зрение', body: 'Видит в темноте.' },
    { title: 'Ярость', body: 'Бонусным действием.' },
  ]);
  assert.deepEqual(titledCards('Скрытность\nУловка. Обмануть стражу.'), [
    { title: '', body: 'Скрытность' },
    { title: 'Уловка', body: 'Обмануть стражу.' },
  ]);
});

test('the rest of the imported texts is the story', () => {
  const texts = [{ key: 'prof', label: 'Владения', body: 'a' }, { key: 'ideals', label: 'Идеалы', body: 'b' }, { key: 'levels', label: 'Уровни', body: 'c' }];
  assert.deepEqual(storyEntries(texts).map(entry => entry.key), ['ideals']);
  assert.equal(textOf(texts, 'levels'), 'c');
  assert.equal(textOf(texts, 'features'), '');
});
