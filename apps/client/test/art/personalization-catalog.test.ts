import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COMMON_THINGS, RARITIES, SCHOOLS, appliesText, buildElementGroups, matchesWords, queryWords, searchLibrary, type ArtElement, type LibraryGroup,
} from '../../src/personalization/catalog.ts';

const sources = {
  weapons: [
    { index: 'longsword', nameRu: 'Длинный меч', name: 'Longsword', category: 'martial', kind: 'melee' },
    { index: 'battleaxe', nameRu: 'Боевой топор', name: 'Battleaxe', category: 'martial', kind: 'melee' },
    { index: 'dagger', nameRu: 'Кинжал', name: 'Dagger', category: 'simple', kind: 'melee' },
  ],
  gear: [{ index: 'key', nameRu: 'Ключ', category: 'gear' }, { index: 'rope', nameRu: 'Верёвка', category: 'gear' }],
  magic: [{ index: 'ring-of-protection', nameRu: 'Кольцо защиты', name: 'Ring of Protection', rarity: 'rare' }],
  customNames: ['Фамильный клинок'],
};

test('element groups follow the SRD lists, sorted by name, and skip empty sections', () => {
  const groups = buildElementGroups(sources);
  assert.deepEqual(groups.map(group => group.id), ['simple/melee', 'martial/melee', 'gear-gear', 'magic', 'schools', 'rarity', 'common', 'custom']);
  const martial = groups.find(group => group.id === 'martial/melee')!;
  assert.equal(martial.label, 'Оружие · воинское рукопашное');
  assert.deepEqual(martial.elements.map(element => element.name), ['Боевой топор', 'Длинный меч']);
  assert.deepEqual(martial.elements[1], {
    key: 'item:длинный меч', name: 'Длинный меч', kind: 'item', group: 'Оружие · воинское рукопашное', srdIndex: 'longsword', section: 'Оружие',
    search: 'длинный меч longsword longsword оружие · воинское рукопашное',
  });
  const gear = groups.find(group => group.id === 'gear-gear')!;
  assert.equal(gear.label, 'Снаряжение');
  assert.deepEqual(gear.elements.map(element => [element.name, element.section]), [['Верёвка', 'Вещи'], ['Ключ', 'Вещи']]);
  assert.deepEqual(groups.find(group => group.id === 'magic')!.elements.map(element => [element.srdIndex, element.rarity, element.section]), [['ring-of-protection', 'rare', 'Магия']]);
});

test('schools and rarity frames are always listed; common things skip names the SRD already has', () => {
  const groups = buildElementGroups({ weapons: [], gear: sources.gear, magic: [], customNames: [] });
  const schools = groups.find(group => group.id === 'schools')!.elements;
  assert.equal(schools.length, SCHOOLS.length);
  assert.ok(schools.every(element => element.kind === 'school' && element.key === `school:${element.school}` && element.section === 'Магия'));
  const frames = groups.find(group => group.id === 'rarity')!.elements;
  assert.equal(frames.length, RARITIES.length);
  assert.ok(frames.some(element => element.key === 'rarity:very_rare' && element.section === 'Интерфейс'));
  const common = groups.find(group => group.id === 'common')!.elements;
  assert.equal(common.length, COMMON_THINGS.length - 1);
  assert.ok(!common.some(element => element.name === 'Ключ'));
  assert.ok(!groups.some(group => group.id === 'custom'));
});

test('custom names are marked and searchable as «своё»', () => {
  const custom = buildElementGroups(sources).find(group => group.id === 'custom')!;
  assert.equal(custom.label, 'Свои названия');
  assert.deepEqual(custom.elements.map(element => [element.key, element.custom, element.search]), [['item:фамильный клинок', true, 'фамильный клинок свое']]);
  assert.ok(queryWords('своё').every(word => custom.elements[0]!.search.includes(word)));
});

test('query words are normalized and every word has to match', () => {
  assert.deepEqual(queryWords('  Синее  ЗЕЛЬЁ '), ['синее', 'зелье']);
  assert.deepEqual(queryWords('   '), []);
  assert.equal(matchesWords('Зелье синее (малое)', ['синее', 'зелье']), true);
  assert.equal(matchesWords('Зелье синее', ['красное']), false);
  assert.equal(matchesWords('что угодно', []), true);
});

test('library search filters by section or group id and matches labels and file names', () => {
  const library: LibraryGroup[] = [
    { id: 'weapons/swords', label: 'Оружие · Мечи', section: 'Оружие', items: [{ path: 'items/weapons/longsword', label: 'Длинный меч' }, { path: 'items/weapons/sword-rusty', label: 'Ржавый меч' }] },
    { id: 'items/potions', label: 'Вещи · Зелья', section: 'Вещи', items: [{ path: 'items/potions/potion-blue', label: 'Синее зелье' }] },
    { id: 'ui/frames', label: 'Интерфейс · Рамки', section: 'Интерфейс', items: [{ path: 'ui/frames/slot-gold', label: 'Золотая рамка' }] },
  ];
  assert.deepEqual(searchLibrary(library, '', []).map(group => group.id), ['weapons/swords', 'items/potions', 'ui/frames']);
  assert.deepEqual(searchLibrary(library, 'Оружие', []).map(group => group.id), ['weapons/swords']);
  assert.deepEqual(searchLibrary(library, 'ui/frames', []).map(group => group.id), ['ui/frames']);
  assert.deepEqual(searchLibrary(library, '', ['rusty']).map(group => group.items.map(item => item.label)), [['Ржавый меч']]);
  assert.deepEqual(searchLibrary(library, '', queryWords('Меч')).map(group => group.items.length), [2]);
  assert.deepEqual(searchLibrary(library, 'Оружие', ['зелье']), []);
  assert.equal(library[0]!.items.length, 2);
});

test('the «applies to» line names where the picture shows', () => {
  const element = (kind: ArtElement['kind'], name: string): ArtElement => ({ key: '', name, kind, group: '', section: '', search: '' });
  assert.equal(appliesText(element('school', 'Ограждение'), false), 'Заклинания школы «Ограждение» — в листе, библиотеке и заявках.');
  assert.equal(appliesText(element('school', 'Ограждение'), true), 'Заклинания школы «Ограждение» — в листе, библиотеке и заявках — у всех участников кампании.');
  assert.equal(appliesText(element('rarity', 'Легендарный'), false), 'Рамка магических предметов редкости «легендарный».');
  assert.equal(appliesText(element('item', 'Стрелы (20)'), false), 'Вещи и оружие с названием «Стрелы» (и «+1», «+2» к нему) — в листе, панели «Атака», лавке, добыче.');
});
