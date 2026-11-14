import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castSource, castSummary } from '../../src/actionBar/castSummary.ts';

const slot = { level: 2, current: 1, max: 3 };
const pact = { level: 2, current: 2, max: 2 };
const base = { level: 1, slotless: false, ritual: false, racial: false, free: null, pact: null, slot };

test('the source follows the order of the cast request: ritual, heritage, a free cast, the pact, then a slot', () => {
  assert.deepEqual(castSource({ ...base, level: 0 }), { kind: 'cantrip' });
  assert.deepEqual(castSource({ ...base, ritual: true, racial: true, pact }), { kind: 'ritual' });
  assert.deepEqual(castSource({ ...base, racial: true, free: 'Мастерство', pact }), { kind: 'racial' });
  assert.deepEqual(castSource({ ...base, free: 'Мастерство', pact }), { kind: 'free', label: 'Мастерство' });
  assert.deepEqual(castSource({ ...base, pact }), { kind: 'pact', ...pact });
  assert.deepEqual(castSource(base), { kind: 'slot', ...slot });
  assert.deepEqual(castSource({ ...base, slot: null }), { kind: 'none' });
});

test('the summary says what is spent and what is left, and warns before a broken concentration', () => {
  const lines = castSummary({
    source: { kind: 'slot', ...slot }, points: { cost: 2, current: 3, max: 5 }, time: 'action', quickened: true,
    concentration: true, concentrating: true, targets: ['Гоблин', 'Волк'], area: false,
  });
  assert.deepEqual(lines, [
    { text: 'Ячейка 2 круга — останется 0 из 3.' },
    { text: 'Очки чародейства: −2, останется 1 из 5.' },
    { text: 'Время: бонусное действие.' },
    { text: 'Нужна концентрация — текущая прервётся.', warn: true },
    { text: 'Цели:', names: ['Гоблин', 'Волк'] },
  ]);
  const short = castSummary({
    source: { kind: 'none' }, points: { cost: 3, current: 1, max: 5 }, time: '10m', quickened: false,
    concentration: false, concentrating: false, targets: [], area: true,
  });
  assert.deepEqual(short.map(line => [line.text, Boolean(line.warn)]), [
    ['Свободной ячейки нет — заклинание не сотворить.', true],
    ['Очков чародейства не хватает: нужно 3, есть 1.', true],
    ['Время: 10 минут.', false],
    ['Область — там, где она поставлена на карте.', false],
  ]);
});
