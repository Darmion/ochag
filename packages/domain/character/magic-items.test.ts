import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  SRD_MAGIC_ITEMS, applyBonuses, bonusProblems, bonusText, dawnCount, itemActive, revertBonuses, type SheetNumbers,
} from './magic-items.ts';
import {parseFormula} from '../dice/dice.ts';

const sheet = (extra: Partial<SheetNumbers> = {}): SheetNumbers => ({
  armorClass: 15, speed: 30, resistances: [], hpMax: 30, hpCurrent: 30, level: 4,
  abilities: {strength: 16, dexterity: 12, constitution: 12, intelligence: 10, wisdom: 10, charisma: 8},
  ...extra,
});

test('item bonuses are checked and described', () => {
  assert.deepEqual(bonusProblems({armorClass: 1, saves: 1, abilities: {strength: 19}, speed: 10, resistances: ['fire']}), []);
  const problems = bonusProblems({armorClass: 11, saves: 1.5, abilities: {luck: 3, strength: 31} as any, speed: 200, resistances: ['love']});
  assert.equal(problems.length, 6, problems.join('\n'));
  assert.equal(bonusText({armorClass: 1, saves: 1}), 'КД +1, спасброски +1');
  assert.equal(bonusText({abilities: {strength: 19}, speed: 10, resistances: ['fire', 'cold']}), 'Сила 19, скорость +10 фут., сопротивление: огонь, холод');
  assert.equal(bonusText({}), '');
});

test('an item works when worn by its holder — and attuned, if it needs attunement', () => {
  const base = {destroyed: false, equipped: true, requiresAttunement: false, attunedTo: null, holderId: 'hero', holderIsCreature: true};
  assert.equal(itemActive(base), true);
  assert.equal(itemActive({...base, equipped: false}), false);
  assert.equal(itemActive({...base, holderIsCreature: false}), false, 'in a chest it does nothing');
  assert.equal(itemActive({...base, destroyed: true}), false);
  assert.equal(itemActive({...base, requiresAttunement: true}), false);
  assert.equal(itemActive({...base, requiresAttunement: true, attunedTo: 'other'}), false);
  assert.equal(itemActive({...base, requiresAttunement: true, attunedTo: 'hero'}), true);
});

test('bonuses go onto the sheet and come off exactly', () => {
  const ring = applyBonuses(sheet(), {armorClass: 1, saves: 1}, 'hero');
  assert.equal(ring.sheet.armorClass, 16);
  assert.deepEqual(ring.applied, {characterId: 'hero', armorClass: 1, saves: 1, abilities: {}, speed: 0, resistances: [], hpMax: 0});
  assert.equal(revertBonuses({...ring.sheet, armorClass: 18}, ring.applied).armorClass, 17);

  const gauntlets = applyBonuses(sheet(), {abilities: {strength: 19}}, 'hero');
  assert.deepEqual([gauntlets.sheet.abilities.strength, gauntlets.applied.abilities.strength], [19, 3]);
  assert.equal(revertBonuses(gauntlets.sheet, gauntlets.applied).abilities.strength, 16);
  const strong = applyBonuses(sheet({abilities: {...sheet().abilities, strength: 20}}), {abilities: {strength: 19}}, 'hero');
  assert.deepEqual([strong.sheet.abilities.strength, strong.applied.abilities], [20, {}], 'no effect on a stronger hero');

  const amulet = applyBonuses(sheet(), {abilities: {constitution: 19}}, 'hero');
  assert.deepEqual([amulet.sheet.hpMax, amulet.sheet.hpCurrent, amulet.applied.hpMax], [42, 42, 12], 'CON +1 → +4: 3 hit points a level, 4 levels');
  const hurt = revertBonuses({...amulet.sheet, hpCurrent: 40}, amulet.applied);
  assert.deepEqual([hurt.hpMax, hurt.hpCurrent], [30, 30]);
  assert.deepEqual([revertBonuses({...amulet.sheet, hpCurrent: 10}, amulet.applied).hpCurrent], [10]);

  const fire = applyBonuses(sheet({resistances: ['cold']}), {resistances: ['fire', 'cold']}, 'hero');
  assert.deepEqual([fire.sheet.resistances, fire.applied.resistances], [['cold', 'fire'], ['fire']]);
  assert.deepEqual(revertBonuses(fire.sheet, fire.applied).resistances, ['cold'], 'an own resistance stays');

  const boots = applyBonuses(sheet(), {speed: 10}, 'hero');
  assert.equal(boots.sheet.speed, 40);
  assert.equal(revertBonuses(boots.sheet, boots.applied).speed, 30);
});

test('dawns by world time: 6:00 every day', () => {
  assert.deepEqual([0, 359, 360, 480, 1799, 1800, 1800 + 1440].map(dawnCount), [0, 0, 1, 1, 1, 2, 3]);
});

test('SRD magic items are consistent', () => {
  const indexes = new Set<string>();
  for (const item of SRD_MAGIC_ITEMS) {
    assert.ok(!indexes.has(item.index), item.index);
    indexes.add(item.index);
    assert.deepEqual(bonusProblems(item.bonuses ?? {}), [], item.index);
    if (item.charges?.formula) assert.ok(parseFormula(item.charges.formula), item.index);
    assert.ok(item.description.length > 10, item.index);
  }
  const wand = SRD_MAGIC_ITEMS.find(item => item.index === 'wand-of-magic-missiles')!;
  assert.deepEqual(wand.charges, {max: 7, recharge: 'dawn', formula: '1d6+1', destroyOnEmpty: true});
  assert.deepEqual(SRD_MAGIC_ITEMS.find(item => item.index === 'ring-of-protection')!.bonuses, {armorClass: 1, saves: 1});
});
