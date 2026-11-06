import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatMessage, localeChain, localeTemplate, parseLocaleFile, sourcePlural, translate, translatePlural} from './i18n.ts';

test('format: {name} placeholders, missing ones stay, {{ }} are literal braces', () => {
  assert.equal(formatMessage('Версия {version}', {version: '0.32.0'}), 'Версия 0.32.0');
  assert.equal(formatMessage('{a} и {b}', {a: 1}), '1 и {b}');
  assert.equal(formatMessage('{{скобки}}'), '{скобки}');
});

test('translate: the chain, then the Russian source', () => {
  const en = {code: 'en', messages: {'Сохранить': 'Save', 'Версия {version}': 'Version {version}'}};
  const de = {code: 'de', messages: {'Сохранить': 'Speichern'}};
  assert.equal(translate([de, en], 'Сохранить'), 'Speichern');
  assert.equal(translate([de, en], 'Версия {version}', {version: 3}), 'Version 3', 'falls back to the base');
  assert.equal(translate([de, en], 'Нет такого'), 'Нет такого', 'the source text');
  assert.equal(translate([], 'Сохранить'), 'Сохранить');
});

test('plural: Russian forms from the key, target forms by its own rules', () => {
  const key = '{n} кость|{n} кости|{n} костей';
  assert.deepEqual([1, 2, 5, 21].map(n => translatePlural([], key, n)), ['1 кость', '2 кости', '5 костей', '21 кость']);
  const en = {code: 'en', messages: {[key]: {one: '{n} die', other: '{n} dice'}}};
  assert.deepEqual([1, 2].map(n => translatePlural([en], key, n)), ['1 die', '2 dice']);
  assert.equal(sourcePlural('один|два|пять', 3), 'два');
});

test('user locale files are checked: meta, strings, plural objects; junk is dropped', () => {
  const parsed = parseLocaleFile({$meta: {code: 'de', name: 'Deutsch', base: 'en'}, 'Сохранить': 'Speichern', 'Пусто': '', 'Число': 5, 'Кость|кости|костей': {one: 'Würfel', other: 'Würfel', bogus: 'x'}}, 'xx');
  assert.deepEqual(parsed.meta, {code: 'de', name: 'Deutsch', base: 'en'});
  assert.deepEqual(parsed.messages, {'Сохранить': 'Speichern', 'Кость|кости|костей': {one: 'Würfel', other: 'Würfel'}});
  assert.deepEqual(parsed.problems, [{kind: 'not-string', key: 'Число'}]);
  assert.equal(parseLocaleFile({}, 'fr').meta.code, 'fr', 'the file name gives the code');
  assert.equal(parseLocaleFile({$meta: {code: 'not a code'}}, 'fr').meta.code, 'fr');
  assert.deepEqual(parseLocaleFile([], 'fr').problems, [{kind: 'not-object'}]);
  assert.equal(parseLocaleFile({$meta: {code: 'en', base: 'en'}}, 'en').meta.base, null, 'no base loop');
});

test('a locale file may group strings into sections; $-keys are notes', () => {
  const parsed = parseLocaleFile({
    $meta: {code: 'en'}, $about: ['пояснение'],
    'Общие': {'Сохранить': 'Save', 'Пусто': ''},
    'Лист персонажа': {'Хиты': 'HP', '{n} кость|{n} кости|{n} костей': {one: '{n} die', other: '{n} dice'}},
    'Кость|кости|костей': {one: 'die', other: 'dice'},
    'Вне раздела': 'Outside',
  }, 'en');
  assert.deepEqual(parsed.messages, {
    'Сохранить': 'Save', 'Хиты': 'HP', '{n} кость|{n} кости|{n} костей': {one: '{n} die', other: '{n} dice'},
    'Кость|кости|костей': {one: 'die', other: 'dice'}, 'Вне раздела': 'Outside',
  });
  assert.deepEqual(parsed.problems, []);
});

test('chain and template', () => {
  const bases: Record<string, string | null> = {'pt-BR': 'pt', pt: 'en', en: null, loop: 'loop2', loop2: 'loop'};
  assert.deepEqual(localeChain('pt-BR', code => bases[code]), ['pt-BR', 'pt', 'en']);
  assert.deepEqual(localeChain('ru', code => bases[code]), [], 'the source needs no chain');
  assert.deepEqual(localeChain('loop', code => bases[code]), ['loop', 'loop2']);
  const sample = {$meta: {code: 'en', name: 'English', base: null}, $about: ['…'], 'Раздел': {'А': 'A', 'Б': ''}, 'В': 'V'};
  const template = localeTemplate(sample, {code: 'xx', name: 'Новый', base: 'en'});
  assert.deepEqual(template, {$meta: {code: 'xx', name: 'Новый', base: 'en'}, 'Раздел': {'А': 'A', 'Б': ''}, 'В': 'V'});
  (template['Раздел'] as Record<string, string>)['А'] = 'changed';
  assert.equal(sample['Раздел']['А'], 'A', 'the sample is copied, not shared');
});

// A Windows checkout with core.autocrlf turns line endings into CRLF; the content is what must match.
const sameLines = (text: string) => text.replace(/\r\n/g, '\n');

test('the client keeps an exact copy (it does not import packages/domain)', async () => {
  const {readFileSync} = await import('node:fs');
  const original = readFileSync(new URL('./i18n.ts', import.meta.url), 'utf8');
  const copy = readFileSync(new URL('../../../apps/client/src/i18n/i18nCore.ts', import.meta.url), 'utf8');
  assert.equal(sameLines(copy), sameLines(original), 'apps/client/src/i18n/i18nCore.ts — копия packages/domain/i18n/i18n.ts');
});

test('the client string list is fresh and English covers it (npm run i18n:extract)', async () => {
  const {readFileSync} = await import('node:fs');
  const {collectKeys, keysModule, readEnglish} = await import('../../../scripts/i18n-extract.mjs');
  const keys = collectKeys();
  const current = readFileSync(new URL('../../../apps/client/src/locales/keys.ts', import.meta.url), 'utf8');
  assert.equal(sameLines(current), sameLines(keysModule(keys)), 'apps/client/src/locales/keys.ts устарел — npm run i18n:extract');
  const en = parseLocaleFile(readEnglish(), 'en');
  assert.deepEqual(en.problems, []);
  assert.deepEqual(en.meta, {code: 'en', name: 'English', base: null});
  assert.deepEqual(keys.filter((key: string) => en.messages[key] === undefined), [], 'English is missing these strings (en.json)');
});

test('en.json merge: translations stay, new strings come empty, translated strings gone from code are kept', async () => {
  const {GONE_GROUP, SHARED_GROUP, flattenLocaleFile, mergeEnglishFile} = await import('../../../scripts/i18n-strings.mjs');
  const at = (file: string, offset: number, files = [file], plural = false) => ({files, first: {file, at: offset}, plural});
  const strings = new Map<string, any>([
    ['Хиты', at('components/Sheet.vue', 20)],
    ['Сохранить', at('App.vue', 5, ['App.vue', 'components/Sheet.vue'])],
    ['Броня', at('components/Sheet.vue', 10)],
    ['{n} кость|{n} кости|{n} костей', at('dice.ts', 1, ['dice.ts'], true)],
  ]);
  const previous = {$meta: {code: 'en', name: 'English', base: null}, 'старое': {'Хиты': 'HP', 'Удалённое': 'Removed', 'Пустое удалённое': ''}};
  const merged = mergeEnglishFile(previous, strings);
  assert.deepEqual(Object.keys(merged), ['$meta', '$about', SHARED_GROUP, 'components/Sheet.vue', 'dice.ts', GONE_GROUP]);
  assert.deepEqual(merged[SHARED_GROUP], {'Сохранить': ''});
  assert.deepEqual(Object.entries(merged['components/Sheet.vue']), [['Броня', ''], ['Хиты', 'HP']], 'source order, translation kept');
  assert.deepEqual(merged['dice.ts'], {'{n} кость|{n} кости|{n} костей': {one: '', other: ''}});
  assert.deepEqual(merged[GONE_GROUP], {'Удалённое': 'Removed'});
  assert.equal(flattenLocaleFile(mergeEnglishFile(merged, strings)).get('Удалённое'), 'Removed', 'stays on the next run');
});
