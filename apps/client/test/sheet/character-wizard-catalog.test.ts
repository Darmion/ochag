import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ABILITIES, CLASS_INFO, NAMES, RACE_INFO, bonusText, kitArt, mod, randomHeroName, signed, toggle } from '../../src/characterWizard/catalog.ts';

test('ability modifiers and signs follow the PHB table', () => {
  assert.deepEqual([1, 8, 9, 10, 11, 15, 20].map(mod), [-5, -1, -1, 0, 0, 2, 5]);
  assert.deepEqual([-1, 0, 3].map(signed), ['-1', '+0', '+3']);
});

test('race bonuses read as short ability names', () => {
  assert.equal(bonusText({ dexterity: 2, intelligence: 1 }), 'ЛОВ +2, ИНТ +1');
  assert.equal(bonusText({}), '');
});

test('every class ranks all six abilities once and every race but the custom one has names', () => {
  for (const [id, info] of Object.entries(CLASS_INFO)) {
    assert.deepEqual([...info.order].sort(), [...ABILITIES].sort(), id);
    assert.ok(['просто', 'средне', 'сложнее'].includes(info.difficulty), id);
  }
  for (const race of Object.keys(RACE_INFO).filter(race => race !== 'custom')) assert.ok(NAMES[race]?.length, race);
});

test('a chip list toggles off what is there and stops at the limit', () => {
  const list = ['athletics'];
  toggle(list, 'perception', 2);
  toggle(list, 'stealth', 2);
  assert.deepEqual(list, ['athletics', 'perception']);
  toggle(list, 'athletics', 2);
  assert.deepEqual(list, ['perception']);
});

test('a random name never repeats the current one and falls back to human names', () => {
  assert.equal(randomHeroName('elf', 'Лиэна', () => 0), 'Аэлин');
  assert.equal(randomHeroName('elf', '', () => 0.999), 'Элора');
  assert.ok(NAMES.human!.includes(randomHeroName('custom', '', () => 0.5)));
});

test('kit pictures skip repeats and names without a picture', () => {
  const kit = { id: 'k', nameRu: 'Набор', weaponNames: ['Длинный меч', 'Длинный меч', 'Неведомая штука'], armorName: null, gearNames: [] };
  assert.deepEqual(kitArt(kit), ['Длинный меч']);
});
