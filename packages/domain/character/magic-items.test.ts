import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  SRD_MAGIC_ITEMS, applyBonuses, bonusProblems, bonusText, dawnCount, findSrdMagicItem, itemActive, magicUseLabel, revertBonuses, type SheetNumbers,
} from './magic-items.ts';
import {magicBaseOptions, magicItemBase, magicItemCategory} from './magic-item-base.ts';
import {itemSpellId, itemSpellLevels, parseItemSpellId} from './item-spells.ts';
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

test('new kinds of item bonuses go on and come off: +N up to 20, immunities, spell attacks and DCs', () => {
  const belt = applyBonuses(sheet({abilities: {...sheet().abilities, constitution: 19}}), {abilityRaise: {constitution: 2}}, 'hero');
  assert.deepEqual([belt.sheet.abilities.constitution, belt.applied.abilities.constitution], [20, 1], 'capped at 20');
  assert.equal(revertBonuses(belt.sheet, belt.applied).abilities.constitution, 19);
  const periapt = applyBonuses(sheet({immunities: ['fire']}), {immunities: ['poison', 'fire']}, 'hero');
  assert.deepEqual([periapt.sheet.immunities, periapt.applied.immunities], [['fire', 'poison'], ['poison']]);
  assert.deepEqual(revertBonuses(periapt.sheet, periapt.applied).immunities, ['fire']);
  const robe = applyBonuses(sheet(), {spellAttack: 2, spellDc: 2}, 'hero');
  const wand = applyBonuses(robe.sheet, {spellAttack: 1}, 'hero');
  assert.deepEqual(wand.sheet.spellBonus, {attack: 3, dc: 2});
  assert.deepEqual(revertBonuses(wand.sheet, robe.applied).spellBonus, {attack: 1, dc: 0});
  assert.deepEqual(bonusProblems({resistances: ['nonmagical'], weapon: 3, spellDc: 2}), []);
  assert.equal(bonusText({weapon: 2, abilityRaise: {dexterity: 2}}), 'Ловкость +2 (до 20), атака и урон +2');
});

test('the full SRD 5.1 list: every item once, old indexes still found, spells the items cast exist', () => {
  assert.equal(SRD_MAGIC_ITEMS.length, 341);
  assert.equal(findSrdMagicItem('armor-plus-1')?.index, 'armor-1');
  assert.equal(findSrdMagicItem('ring-of-resistance')?.nameRu, 'Кольцо сопротивления огню');
  assert.equal(findSrdMagicItem('nope'), null);
  const spells = JSON.parse(readFileSync(new URL('../srd/spells.ru.json', import.meta.url), 'utf8'));
  for (const item of SRD_MAGIC_ITEMS) {
    for (const cast of item.castable ?? []) assert.ok(spells[cast.spell], `${item.index}: ${cast.spell}`);
    for (const spell of item.spells) assert.ok(spells[spell], `${item.index}: ${spell}`);
    assert.doesNotMatch(item.description, /@/, item.index);
  }
  assert.deepEqual(findSrdMagicItem('wand-of-fireballs')?.castable, [{spell: 'fireball', charges: 1, perCharge: true, dc: 15}]);
  assert.deepEqual(findSrdMagicItem('spell-scroll-3rd')?.use, {kind: 'scroll', level: 3, dc: 15, attack: 7});
  assert.equal(magicUseLabel('potion-of-healing-common'), 'Выпить');
  assert.equal(magicUseLabel('restorative-ointment'), 'Нанести');
  assert.equal(magicUseLabel('ring-of-protection'), null);
});

test('a magic weapon or armor is made from an ordinary one: «+N» items take its name', () => {
  const plus = findSrdMagicItem('weapon-1')!;
  assert.deepEqual(magicItemBase(plus, 'weapon:longsword'), {base: {ref: 'weapon:longsword', name: 'Длинный меч', category: 'weapon', weightLb: 3}, name: 'Длинный меч +1'});
  assert.equal((magicItemBase(findSrdMagicItem('flame-tongue')!, 'weapon:scimitar') as any).name, 'Язык пламени');
  assert.ok('problem' in magicItemBase(plus, 'gear:chain-mail'));
  assert.deepEqual(magicItemBase(plus, null), {base: null, name: 'Оружие +1'});
  assert.equal((magicItemBase(findSrdMagicItem('animated-shield')!, 'gear:shield') as any).base.category, 'shield');
  assert.ok('problem' in magicItemBase(findSrdMagicItem('animated-shield')!, 'gear:plate'));
  assert.deepEqual(magicBaseOptions(findSrdMagicItem('ring-of-protection')!), []);
});

test('item spells: the id names the item and the spell; charges pay for the level', () => {
  const id = itemSpellId('0b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6', 'fireball');
  assert.deepEqual(parseItemSpellId(id), {itemId: '0b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6', spell: 'fireball'});
  assert.equal(parseItemSpellId('fireball'), null);
  assert.deepEqual(itemSpellLevels({charges: 1, perCharge: true}, 3, 3), [{level: 3, cost: 1}, {level: 4, cost: 2}, {level: 5, cost: 3}]);
  assert.deepEqual(itemSpellLevels({charges: 1, perCharge: true, maxLevel: 4}, 1, 10).map(option => option.level), [1, 2, 3, 4], 'staff of healing: up to 4th');
  assert.deepEqual(itemSpellLevels({charges: 5, level: 5}, 3, 5), [{level: 5, cost: 5}], 'staff of power: the 5th-level fireball');
  assert.deepEqual(itemSpellLevels({charges: 5}, 5, 4), [], 'not enough charges');
  assert.deepEqual(itemSpellLevels({charges: 0}, 2, null), [{level: 2, cost: 0}], 'at will');
});

test('a magic item without a base finds its inventory place by its kind, not by its name', () => {
  assert.equal(magicItemCategory(findSrdMagicItem('wand-of-magic-missiles')!), 'focus', 'not ammunition for its «стрел»');
  assert.equal(magicItemCategory(findSrdMagicItem('potion-of-healing-common')!), 'consumable');
  assert.equal(magicItemCategory(findSrdMagicItem('spell-scroll-3rd')!), 'consumable');
  assert.equal(magicItemCategory(findSrdMagicItem('ammunition-2')!), 'ammo');
  assert.equal(magicItemCategory(findSrdMagicItem('ring-of-protection')!), null);
});
