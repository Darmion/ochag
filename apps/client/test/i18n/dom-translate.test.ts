import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildIndex, condense, createTranslator, englishQuotes} from '../../src/i18n/domTranslateCore.ts';

const dictionary: Array<[string, string]> = [
  ['Сохранить', 'Save'],
  ['Хиты: {hp} из {max}', 'HP: {hp} of {max}'],
  ['Заклинание: {spellName} — {name}', 'Spell: {spellName} — {name}'],
  ['Свет', 'Light'],
  ['{name}: в воздухе, высота {height} фут.', '{name}: in the air, height {height} ft.'],
  ['{value} фут.', '{value} ft.'],
  ['«{name}» вне досягаемости: {weapon} — {limit} фут.', '“{name}” is out of reach: {weapon} — {limit} ft.'],
  ['Не переведено', ''],
  ['{{x}} — скобки', '{{x}} — braces'],
];

test('exact strings and patterns with values', () => {
  const translator = createTranslator(buildIndex(dictionary));
  assert.equal(translator.translate('Сохранить'), 'Save');
  assert.equal(translator.translate('  Сохранить \n'), 'Save', 'whitespace around — as the template renders it');
  assert.equal(translator.translate('Хиты: 16 из 16'), 'HP: 16 of 16');
  assert.equal(translator.translate('Гарпия: в воздухе, высота 10 фут.'), 'Гарпия: in the air, height 10 ft.', 'a name stays as it is');
  assert.equal(translator.translate('30 фут.'), '30 ft.');
  assert.equal(translator.translate('Hello'), null, 'no Cyrillic — nothing to do');
  assert.equal(translator.translate('Не переведено'), null, 'an empty translation — leave the Russian');
  assert.equal(translator.translate('{x} — скобки'), '{x} — braces', 'escaped braces');
});

test('Russian values inside are translated too; the most specific pattern wins', () => {
  const translator = createTranslator(buildIndex(dictionary));
  assert.equal(translator.translate('Заклинание: Свет — Искатель'), 'Spell: Light — Искатель');
  assert.equal(translator.translate('«Гоблин» вне досягаемости: Меч — 5 фут.'), '“Гоблин” is out of reach: Меч — 5 ft.', 'not the shorter «{value} фут.»');
});

test('the first translation of a key wins; whitespace is condensed', () => {
  const translator = createTranslator(buildIndex([['Свет', 'Light'], ['Свет', 'Glow'], ['Длинная\n   строка', 'A long line']]));
  assert.equal(translator.translate('Свет'), 'Light');
  assert.equal(translator.translate('Длинная строка'), 'A long line');
  assert.equal(condense('  a \n\t b  '), 'a b');
});

test('icons, brackets and quotes around stay; parts joined by « · » are translated one by one', () => {
  const translator = createTranslator(buildIndex([['День {day}, {hh}:{mm}', 'Day {day}, {hh}:{mm}'], ['Вы', 'You'], ['добыча', 'loot'], ['Свет', 'Light']]));
  assert.equal(translator.translate('☀ День 1, 16:26'), '☀ Day 1, 16:26');
  assert.equal(translator.translate('(Вы)'), '(You)');
  assert.equal(translator.translate('«Свет»'), '«Light»');
  assert.equal(translator.translate('Жертва ✝ · ⚱ добыча'), 'Жертва ✝ · ⚱ loot', 'the name stays, the label part is translated');
  assert.equal(translator.translate('Жертва ✝'), null, 'nothing known — nothing changed');
});

test('names people gave are not translated — whole or inside a phrase', () => {
  const names = new Set(['Торговец']);
  const translator = createTranslator(buildIndex([...dictionary, ['Торговец', 'Merchant']]), {isProtected: text => names.has(text)});
  assert.equal(translator.translate('Торговец'), null);
  assert.equal(translator.translate('Заклинание: Свет — Торговец'), 'Spell: Light — Торговец');
});

test('ordinary words inside a name people gave stay too, even inside a longer message', () => {
  const names = new Set(['Жалобы, список 2', 'Ли']);
  const translator = createTranslator(buildIndex([
    ['Вы присоединились к кампании «{value}».', 'You joined the campaign “{value}”.'],
    ['Список', 'List'],
    ['Лист персонажа', 'Character sheet'],
  ]), {isProtected: text => names.has(text), shielded: () => names});
  assert.equal(translator.translate('Вы присоединились к кампании «Жалобы, список 2».'), 'You joined the campaign “Жалобы, список 2”.');
  assert.equal(translator.translate('Лист персонажа'), 'Character sheet', 'a short name inside another word is not a name');
});

test('the core of a key with icons around is known too', () => {
  const translator = createTranslator(buildIndex([[' · ⚱ добыча', ' · ⚱ loot']]));
  assert.equal(translator.translate('Жертва ✝ · ⚱ добыча'), 'Жертва ✝ · ⚱ loot');
  assert.equal(translator.translate('добыча'), 'loot');
});

test('an exact core beats a pattern of the whole line', () => {
  const translator = createTranslator(buildIndex([['Спасбросок от смерти', 'Death Saving Throw'], ['Спасбросок {check_key}', '{check_key} save']]));
  assert.equal(translator.translate('Спасбросок от смерти:'), 'Death Saving Throw:');
  assert.equal(translator.translate('Спасбросок ЛОВ'), 'ЛОВ save', 'the pattern still works where nothing exact fits');
});

test('a note in brackets, comma-joined parts and a log label without the name tail', () => {
  const translator = createTranslator(buildIndex([
    ['Сцены', 'Scenes'], ['Персонаж игрока', 'Player character'], ['средний', 'medium'],
    ['Падение с {feet} фут. — {name}', 'A fall from {feet} ft. — {name}'], ['{value} фут.', '{value} ft.'],
  ]));
  assert.equal(translator.translate('Сцены (1)'), 'Scenes (1)');
  assert.equal(translator.translate('Персонаж игрока, средний'), 'Player character, medium');
  assert.equal(translator.translate('Падение с 30 фут.'), 'A fall from 30 ft.', 'not the looser «{value} фут.»');
  assert.equal(translator.translate('Падение с 30 фут.:'), 'A fall from 30 ft.:');
});

test('case of the first letter, braces stay with the placeholder, the best pattern wins over cuts', () => {
  const translator = createTranslator(buildIndex([
    ['Средний', 'Medium'], ['· ведёт кампаний: {ownedCampaigns}', '· runs campaigns: {ownedCampaigns}'],
    ['Падение с {feet} фут.', 'A fall from {feet} ft.'], ['{value} фут.:', '{value} ft.:'],
  ]));
  assert.equal(translator.translate('средний'), 'medium');
  assert.equal(translator.translate('ведёт кампаний: 6'), 'runs campaigns: 6');
  assert.equal(translator.translate('Падение с 30 фут.:'), 'A fall from 30 ft.:');
});

test('a closing quote whose opening is inside stays with the key', () => {
  const translator = createTranslator(buildIndex([[' · лежит в «{container_name}»', ' · lies in “{container_name}”'], ['(Вы)', '(You)']]));
  assert.equal(translator.translate('лежит в «Искатель»'), 'lies in “Искатель”');
  assert.equal(translator.translate('Плащ · лежит в «Сундук»'), 'Плащ · lies in “Сундук”');
  assert.equal(translator.translate('(Вы)'), '(You)');
});

test('glued placeholders stay as they are, joined parts win when they leave less Russian', () => {
  const translator = createTranslator(buildIndex([
    ['{name}{value}. Щелчок — выбрать, двойной — лист', '{name}{value}. Click — select, double-click — sheet'], ['и', 'and'],
    ['Атака: {name}', 'Attack: {name}'], ['Длинный меч', 'Longsword'],
    ['Объект', 'Object'], ['крошечный', 'tiny'], ['{kind}, {size}', '{kind}, {size}'], [' · лежит в «{container_name}»', ' · lies in “{container_name}”'],
  ]));
  assert.equal(translator.translate('Искатель — 16/16. Щелчок — выбрать, двойной — лист'), 'Искатель — 16/16. Click — select, double-click — sheet');
  assert.equal(translator.translate('Атака: Длинный меч → Жертва:'), 'Attack: Longsword → Жертва:');
  assert.equal(translator.translate('Объект, крошечный · лежит в «Искатель»'), 'Object, tiny · lies in “Искатель”');
  assert.equal(translator.translate('И'), null, 'a lone initial is not a word');
});

test('Russian words between numbers, dice and Latin text are translated one by one', () => {
  const translator = createTranslator(buildIndex([
    ['рубящий', 'slashing'], ['зм', 'gp'], ['см', 'sp'], ['{x} мм', '{x} cp'], ['Воин', 'Fighter'], ['Волшебник', 'Wizard'], ['Действие', 'Action'],
  ]), { isProtected: text => text === 'Искатель' });
  assert.equal(translator.translate('1d8+@mod рубящий · 5 ft.'), '1d8+@mod slashing · 5 ft.');
  assert.equal(translator.translate('8 зм 5 см 7 мм'), '8 gp 5 sp 7 cp');
  assert.equal(translator.translate('Воин 3 / Волшебник 1'), 'Fighter 3 / Wizard 1');
  assert.equal(translator.translate('1 действие'), '1 action');
  assert.equal(translator.translate('Искатель 3 / Воин 1'), 'Искатель 3 / Fighter 1', 'a name stays');
});

test('a creature name takes its own translation before the dictionary', () => {
  const names = new Map([['Кошка', 'Cat']]);
  const translator = createTranslator(buildIndex([['Кошка', 'Grappling hook']]), {
    name: text => names.get(text) ?? (text === 'Кошка (Искатель)' ? 'Cat (Искатель)' : null),
    isProtected: text => text === 'Кошка (Искатель)',
  });
  assert.equal(translator.translate('Кошка'), 'Cat');
  assert.equal(translator.translate('Кошка (Искатель)'), 'Cat (Искатель)');
});

test('a reason after a name keeps its own key, also in a list of failures', () => {
  const translator = createTranslator(buildIndex([
    ['Не все сдвинулись: {failed}', 'Not everything moved: {failed}'],
    ['Клетка занята другим существом — встаньте рядом.', 'The square is taken by another creature — stand next to it.'],
  ]), { isProtected: text => text === 'Лира' || text === 'Борин' });
  assert.equal(translator.translate('Не все сдвинулись: Лира — Клетка занята другим существом — встаньте рядом.'), 'Not everything moved: Лира — The square is taken by another creature — stand next to it.');
  assert.equal(
    translator.translate('Не все сдвинулись: Лира — Клетка занята другим существом — встаньте рядом.; Борин — Клетка занята другим существом — встаньте рядом.'),
    'Not everything moved: Лира — The square is taken by another creature — stand next to it.; Борин — The square is taken by another creature — stand next to it.',
  );
});

test('a lone quote beside an untranslated name gets English quotes', () => {
  assert.equal(englishQuotes('«'), '“');
  assert.equal(englishQuotes('» —'), '” —');
  assert.equal(englishQuotes('Hello'), null, 'no quotes — nothing to do');
  assert.equal(englishQuotes('«Проба»'), null, 'Russian text is the translator’s job');
});
