import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adjustD20, characterRace, hasRaceTrait, raceOfText, raceSaveAdvantages, raceTraits} from './races.ts';

test('race from builder, LSS text or plain field', () => {
  assert.equal(characterRace({sheet_extra: {builder: {race: 'halfling'}}}), 'halfling');
  assert.equal(characterRace({sheet_extra: {builder: {race: 'goblin'}, info: {race: 'Холмовой дварф'}}}), 'dwarf', 'unknown builder race — text wins');
  assert.equal(characterRace({sheet_extra: {info: {race: {value: 'Half-Orc'}}}}), 'half-orc');
  assert.equal(characterRace({sheet_extra: {race: 'Лесной эльф'}}), 'elf');
  assert.equal(characterRace({sheet_extra: null}), null);
  assert.equal(raceOfText('Полуэльф'), 'half-elf', 'half-elf before elf');
  assert.equal(raceOfText('Легконогий полурослик'), 'halfling');
  assert.equal(raceOfText('Скальный гном'), 'gnome');
  assert.equal(raceOfText('Орк'), null);
});

test('race traits and save advantages', () => {
  assert.deepEqual(raceTraits('halfling').map(trait => trait.id), ['lucky', 'brave']);
  assert.deepEqual(raceTraits('half-orc').map(trait => trait.id), ['relentless-endurance', 'savage-attacks']);
  assert.deepEqual(raceTraits('human'), []);
  assert.ok(hasRaceTrait('half-elf', 'fey-ancestry'));
  assert.ok(!hasRaceTrait(null, 'lucky'));
  assert.deepEqual(raceSaveAdvantages('halfling', 'wisdom', {condition: 'frightened'}), ['храбрый']);
  assert.deepEqual(raceSaveAdvantages('halfling', 'wisdom', {condition: 'charmed'}), []);
  assert.deepEqual(raceSaveAdvantages('elf', 'wisdom', {condition: 'charmed', magic: true}), ['наследие фей']);
  assert.deepEqual(raceSaveAdvantages('dwarf', 'constitution', {damageType: 'poison'}), ['дварфийская устойчивость']);
  assert.deepEqual(raceSaveAdvantages('dwarf', 'constitution', {condition: 'poisoned'}), ['дварфийская устойчивость']);
  assert.deepEqual(raceSaveAdvantages('gnome', 'wisdom', {magic: true}), ['гномья хитрость']);
  assert.deepEqual(raceSaveAdvantages('gnome', 'dexterity', {magic: true}), [], 'only INT/WIS/CHA');
  assert.deepEqual(raceSaveAdvantages('gnome', 'wisdom', {magic: false}), []);
  assert.deepEqual(raceSaveAdvantages('dwarf', 'constitution', null), []);
});

test('lucky rerolls a kept 1, reliable talent floors at 10', () => {
  const die = () => 15;
  assert.deepEqual(adjustD20([1], 'none', {lucky: true}, die), {results: [15], kept: 15, notes: ['везучий: 1 → 15']});
  assert.deepEqual(adjustD20([1, 12], 'adv', {lucky: true}, die).notes, [], 'advantage keeps 12 — no reroll');
  assert.deepEqual(adjustD20([1, 12], 'disadv', {lucky: true}, die), {results: [15, 12], kept: 12, notes: ['везучий: 1 → 15']});
  assert.deepEqual(adjustD20([1, 1], 'disadv', {lucky: true}, die).kept, 1, 'only one reroll');
  assert.deepEqual(adjustD20([1], 'none', {}, die).kept, 1);
  assert.deepEqual(adjustD20([4], 'none', {floor10: true}, die), {results: [10], kept: 10, notes: ['надёжный талант: 4 → 10']});
  assert.deepEqual(adjustD20([14], 'none', {floor10: true}, die).notes, []);
  assert.deepEqual(adjustD20([3, 16], 'adv', {floor10: true}, die), {results: [10, 16], kept: 16, notes: []});
  assert.deepEqual(adjustD20([1], 'none', {lucky: true, floor10: true}, () => 2), {results: [10], kept: 10, notes: ['везучий: 1 → 2', 'надёжный талант: 2 → 10']});
});

test('dragon ancestry, race resistances, breath weapon dice', async () => {
  const {breathWeaponDice, dragonAncestry, raceResistances} = await import('./races.ts');
  assert.equal(dragonAncestry({sheet_extra: {builder: {race: 'dragonborn', ancestry: 'gold'}}})?.id, 'gold');
  assert.equal(dragonAncestry({sheet_extra: {info: {race: 'Драконорождённый (красный)'}}})?.id, 'red');
  assert.equal(dragonAncestry({sheet_extra: {info: {race: 'Dragonborn', subrace: 'Silver'}}})?.id, 'silver');
  assert.equal(dragonAncestry({sheet_extra: {builder: {race: 'dragonborn', ancestry: 'gold'}, dragonAncestry: 'white'}})?.id, 'white', 'the choice in «Умения» wins');
  assert.equal(dragonAncestry({sheet_extra: {info: {race: 'Драконорождённый'}}}), null);
  assert.deepEqual(raceResistances({sheet_extra: {info: {race: 'Горный дварф'}}}), ['poison']);
  assert.deepEqual(raceResistances({sheet_extra: {info: {race: 'Тифлинг'}}}), ['fire']);
  assert.deepEqual(raceResistances({sheet_extra: {info: {race: 'Драконорождённый (синий)'}}}), ['lightning']);
  assert.deepEqual(raceResistances({sheet_extra: {info: {race: 'Драконорождённый'}}}), []);
  assert.deepEqual(raceResistances({sheet_extra: {info: {race: 'Человек'}}}), []);
  assert.deepEqual([1, 5, 6, 11, 16].map(breathWeaponDice), [2, 2, 3, 4, 5]);
  assert.deepEqual(raceTraits('dragonborn').map(trait => trait.id), ['breath-weapon', 'draconic-resistance']);
  assert.deepEqual(raceTraits('tiefling').map(trait => trait.id), ['hellish-resistance', 'infernal-legacy']);
});

test('infernal legacy: thaumaturgy, hellish rebuke from 3rd, darkness from 5th — tieflings only', async () => {
  const {infernalLegacySpell} = await import('./races.ts');
  const tiefling = (level: number) => ({level, sheet_extra: {info: {race: 'Тифлинг'}}});
  assert.equal(infernalLegacySpell(tiefling(1), 'thaumaturgy')?.castAt, 0);
  assert.equal(infernalLegacySpell(tiefling(2), 'hellish-rebuke'), null);
  assert.equal(infernalLegacySpell(tiefling(3), 'hellish-rebuke')?.castAt, 2);
  assert.equal(infernalLegacySpell(tiefling(4), 'darkness'), null);
  assert.equal(infernalLegacySpell(tiefling(5), 'darkness')?.resource, 'Наследие: Тьма');
  assert.equal(infernalLegacySpell(tiefling(5), 'shield'), null);
  assert.equal(infernalLegacySpell({level: 5, sheet_extra: {info: {race: 'Человек'}}}, 'hellish-rebuke'), null);
});
