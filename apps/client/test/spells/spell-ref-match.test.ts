import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIST_LABELS, matchRefs, refTitle, type RefTarget } from '../../src/spellsPanel/refMatch.ts';

const srd = (index: string, name: string, nameRu: string | null, level: number, classes: string[]) => ({ index, name, nameRu, level, classes });
const custom = (id: string, name: string, level: number, classes: string, status = 'approved') => ({ id, name, level, classes, status });
const library = [
  srd('fireball', 'Fireball', 'Огненный шар', 3, ['Sorcerer', 'Wizard']),
  srd('fire-bolt', 'Fire Bolt', 'Огненный снаряд', 0, ['Sorcerer', 'Wizard']),
  srd('cure-wounds', 'Cure Wounds', 'Лечение ран', 2, ['Bard', 'Cleric']),
  srd('shield', 'Shield', null, 1, ['Wizard']),
];
const campaign = [custom('c1', 'Огненная стрела Иры', 2, 'wizard, sorcerer'), custom('c2', 'Черновик огня', 1, 'wizard', 'pending')];
const wizard = new Set(['wizard']);
const target = (label: string | null, level: number | null): RefTarget => ({ ref: 'lss-000123456', label, level });
const keys = (list: Array<{ key: string }>) => list.map(item => item.key);

test('without a search only own class spells are offered, by level then name', () => {
  assert.deepEqual(keys(matchRefs(target(null, null), undefined, library, campaign, wizard)), ['srd:fire-bolt', 'srd:shield', 'custom:c1', 'srd:fireball']);
});

test('the label is the default search and the level narrows a text search', () => {
  assert.deepEqual(keys(matchRefs(target('огнен', 3), undefined, library, campaign, wizard)), ['srd:fireball']);
  assert.deepEqual(keys(matchRefs(target('огнен', null), undefined, library, campaign, wizard)), ['srd:fire-bolt', 'custom:c1', 'srd:fireball']);
});

test('a cleared search replaces the label and drops the level filter', () => {
  assert.deepEqual(keys(matchRefs(target('Огненный шар', 3), '', library, campaign, wizard)), ['srd:fire-bolt', 'srd:shield', 'custom:c1', 'srd:fireball']);
});

test('a search finds English names and other classes, which go last', () => {
  const found = matchRefs(target('Щит', null), 'R', library, campaign, wizard);
  assert.deepEqual(found.map(item => `${item.key}:${item.own}`), ['srd:fire-bolt:true', 'srd:fireball:true', 'srd:cure-wounds:false']);
  assert.equal(matchRefs(target(null, null), 'shield', library, campaign, wizard)[0]?.name, 'Shield');
});

test('without caster classes every approved spell is own', () => {
  assert.deepEqual(keys(matchRefs(target(null, null), undefined, library, campaign, new Set())), ['srd:fire-bolt', 'srd:shield', 'srd:cure-wounds', 'custom:c1', 'srd:fireball']);
});

test('at most 80 matches are offered', () => {
  const many = Array.from({ length: 100 }, (_, index) => srd(`s${index}`, `Spell ${index}`, null, 1, ['Wizard']));
  assert.equal(matchRefs(target(null, null), undefined, many, [], wizard).length, 80);
});

test('a reference without a label is titled by its number', () => {
  assert.equal(refTitle({ ref: 'lss-000123456', label: 'Огненный шар' }), 'Огненный шар');
  assert.equal(refTitle({ ref: 'lss-000123456', label: null }), 'Заклинание №123456');
  assert.equal(LIST_LABELS.granted, 'дарованное');
});
