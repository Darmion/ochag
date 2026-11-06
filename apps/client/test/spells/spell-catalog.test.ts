import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultFilters, filterCatalog, filtersActive, groupByLevel, ownSpellLists, spellListsLabel, statusOf, toggleLevel, toggleValue,
  type CatalogItem,
} from '../../src/spellsPanel/catalog.ts';

const item = (key: string, level: number, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  key, name: key, alt: '', level, school: 'Evocation', classes: ['Wizard'], purposes: [], damageTypes: [], entry: null, ...extra,
});
const known = (prepared: boolean, granted = false) => ({ prepared, granted });

const items = [
  item('Огненный снаряд', 0, { entry: known(false), damageTypes: ['fire'], purposes: ['damage'], alt: 'Fire Bolt' }),
  item('Щит', 1, { entry: known(false), school: 'Abjuration', purposes: ['protection'] }),
  item('Лечение ран', 1, { entry: known(true, true), classes: ['Cleric', 'Bard'], purposes: ['heal'] }),
  item('Огненный шар', 3, { entry: known(true), damageTypes: ['fire'], purposes: ['damage'] }),
  item('Сон', 1, { classes: ['Bard', 'Wizard'], school: 'Enchantment', purposes: ['control'] }),
  item('Слово исцеления', 1, { classes: ['Cleric'], purposes: ['heal'] }),
];
const none = () => false;
const names = (list: CatalogItem[]) => list.map(entry => entry.name);
const wizard = ownSpellLists(['wizard']);

test('default filters show the known spells only', () => {
  const filters = defaultFilters();
  assert.equal(filtersActive(filters), false);
  assert.deepEqual(names(filterCatalog(items, filters, wizard, none)), ['Огненный снаряд', 'Щит', 'Лечение ран', 'Огненный шар']);
  assert.notEqual(defaultFilters().levels, defaultFilters().levels);
});

test('unknown spells come from the hero lists unless another list is chosen', () => {
  const filters = { ...defaultFilters(), showUnknown: true };
  assert.equal(filtersActive(filters), true);
  assert.deepEqual(names(filterCatalog(items, filters, wizard, none)).slice(4), ['Сон']);
  assert.deepEqual(names(filterCatalog(items, filters, new Set(), none)).slice(4), ['Сон', 'Слово исцеления']);
  assert.deepEqual(names(filterCatalog(items, { ...filters, spellList: 'cleric' }, wizard, none)), ['Лечение ран', 'Слово исцеления']);
  assert.deepEqual(names(filterCatalog(items, { ...filters, onlyPrepared: true }, wizard, none)), ['Огненный снаряд', 'Лечение ран', 'Огненный шар']);
});

test('level, school, element, purpose, favourites and text narrow the list', () => {
  const base = { ...defaultFilters(), showUnknown: true, spellList: '' };
  assert.deepEqual(names(filterCatalog(items, { ...base, levels: [0, 3] }, wizard, none)), ['Огненный снаряд', 'Огненный шар']);
  assert.deepEqual(names(filterCatalog(items, { ...base, school: 'Abjuration' }, wizard, none)), ['Щит']);
  assert.deepEqual(names(filterCatalog(items, { ...base, element: 'fire' }, wizard, none)), ['Огненный снаряд', 'Огненный шар']);
  assert.deepEqual(names(filterCatalog(items, { ...base, purposes: ['heal', 'control'] }, wizard, none)), ['Лечение ран', 'Сон', 'Слово исцеления']);
  assert.deepEqual(names(filterCatalog(items, { ...base, onlyFavorites: true }, wizard, entry => entry.name === 'Щит')), ['Щит']);
  assert.deepEqual(names(filterCatalog(items, { ...base, text: '  fire ' }, wizard, none)), ['Огненный снаряд']);
  assert.deepEqual(names(filterCatalog(items, { ...base, showKnown: false }, wizard, none)), ['Сон', 'Слово исцеления']);
});

test('groups go by level, known and favourite spells first', () => {
  const groups = groupByLevel(filterCatalog(items, { ...defaultFilters(), showUnknown: true, spellList: '' }, wizard, none), entry => entry.name === 'Щит');
  assert.deepEqual(groups.map(group => [group.level, group.known, names(group.items)]), [
    [0, 1, ['Огненный снаряд']],
    [1, 2, ['Щит', 'Лечение ран', 'Слово исцеления', 'Сон']],
    [3, 1, ['Огненный шар']],
  ]);
});

test('toggles, hero lists and status labels', () => {
  assert.deepEqual(toggleLevel([3, 1], 2), [1, 2, 3]);
  assert.deepEqual(toggleLevel([1, 2], 1), [2]);
  assert.deepEqual(toggleValue(['heal'], 'damage'), ['heal', 'damage']);
  assert.deepEqual(toggleValue(['heal', 'damage'], 'heal'), ['damage']);
  assert.deepEqual([...ownSpellLists(['Wizard', 'fighter', 'Cleric'])], ['wizard', 'cleric']);
  assert.equal(spellListsLabel(ownSpellLists(['wizard', 'bard'])), 'Волшебник, Бард');
  assert.equal(spellListsLabel(new Set()), '');
  assert.deepEqual(items.slice(0, 5).map(entry => statusOf(entry).tone), ['known', 'unprepared', 'granted', 'known', 'unknown']);
});
