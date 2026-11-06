import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {abilityFromDice, buildCharacter, pointBuyCost, type BuildInput} from './character-builder.ts';

const raw = JSON.parse(readFileSync(new URL('../srd/spells.json', import.meta.url), 'utf8'));
const spells = (Array.isArray(raw) ? raw : raw.spells).map((spell: any) => ({index: spell.index, level: spell.level, classes: spell.classes}));
const scores = (str: number, dex: number, con: number, int: number, wis: number, cha: number) =>
  ({strength: str, dexterity: dex, constitution: con, intelligence: int, wisdom: wis, charisma: cha});
const build = (input: Partial<BuildInput>) => buildCharacter({
  name: 'Герой', race: 'human', className: 'fighter', method: 'standard', abilities: scores(15, 13, 14, 10, 12, 8),
  background: 'acolyte', classSkills: ['athletics', 'perception'], kit: 'knight', fightingStyle: 'defense', ...input,
} as BuildInput, spells);

test('a hill dwarf fighter in chain mail: hit points, AC with the Defense style, weapons and resources', () => {
  const result = build({race: 'dwarf', subrace: 'hill'});
  assert.deepEqual(result.problems, []);
  const {character, saves, weapons, resources, skills} = result.sheet!;
  assert.deepEqual([character.strength, character.constitution, character.wisdom], [15, 16, 13]);
  assert.equal(character.hp_max, 10 + 3 + 1, 'd10 + Con +3 + dwarven toughness');
  assert.equal(character.armor_class, 16 + 2 + 1, 'chain mail, shield, Defense');
  assert.equal(character.speed_feet, 25);
  assert.equal(character.class_name, 'Воин');
  assert.equal(character.hit_die, 10);
  assert.deepEqual(character.damage_resistances, ['poison']);
  assert.equal((character.sheet_extra as any).darkvisionFeet, 60);
  assert.deepEqual(saves.map(save => save.ability), ['strength', 'constitution']);
  assert.deepEqual(skills.map(skill => skill.skill_index).sort(), ['athletics', 'insight', 'perception', 'religion']);
  assert.deepEqual(weapons.map(w => [w.name, w.ability, w.proficient, w.damage_formula, w.ammo_name]), [
    ['Длинный меч', 'strength', true, '1d8+@mod', null],
    ['Лёгкий арбалет', 'dexterity', true, '1d8+@mod', 'Болты'],
  ]);
  assert.deepEqual(resources, [{name: 'Второе дыхание', max: 1, recharge: 'short'}, {name: 'Болты', max: 20, recharge: 'none'}]);
  assert.equal(character.gp, 15);
  assert.ok(result.items!.includes('chain-mail') && result.items!.includes('shield') && result.items!.includes('crossbow-bolts-20'));
});

test('the three ways to set abilities are checked', () => {
  assert.match(build({abilities: scores(15, 15, 13, 12, 10, 8)}).problems.join(), /Стандартный набор/);
  assert.equal(pointBuyCost([15, 15, 15, 8, 8, 8]), 27);
  assert.deepEqual(build({method: 'pointbuy', abilities: scores(15, 15, 15, 8, 8, 8)}).problems, []);
  assert.match(build({method: 'pointbuy', abilities: scores(15, 15, 15, 9, 8, 8)}).problems.join(), /потрачено 28 из 27/);
  assert.match(build({method: 'pointbuy', abilities: scores(16, 14, 13, 8, 8, 8)}).problems.join(), /от 8 до 15/);
  assert.equal(abilityFromDice([1, 6, 4, 5]), 15);
  assert.deepEqual(build({method: 'roll', rolled: [17, 12, 11, 9, 14, 6], abilities: scores(17, 14, 12, 9, 11, 6)}).problems, []);
  assert.match(build({method: 'roll', rolled: [17, 12, 11, 9, 14, 6], abilities: scores(18, 14, 12, 9, 11, 6)}).problems.join(), /выпали на костях/);
});

test('skills: the class list and count, no skill twice, rogue expertise', () => {
  assert.match(build({classSkills: ['arcana', 'perception']}).problems.join(), /Навыки класса/);
  assert.match(build({classSkills: ['insight', 'perception']}).problems.join(), /не выбирают дважды/, 'Insight comes from the acolyte');
  const rogue = buildCharacter({
    name: 'Тень', race: 'halfling', subrace: 'lightfoot', className: 'rogue', method: 'standard', abilities: scores(8, 15, 14, 12, 13, 10),
    background: 'custom', backgroundSkills: ['history', 'survival'], classSkills: ['stealth', 'acrobatics', 'deception', 'sleight-of-hand'],
    expertise: ['stealth', 'sleight-of-hand'], kit: 'rapier',
  }, spells);
  assert.deepEqual(rogue.problems, []);
  const sheet = rogue.sheet!;
  assert.equal(sheet.character.size, 'small');
  assert.equal(sheet.character.dexterity, 17);
  assert.equal(sheet.character.armor_class, 11 + 3, 'leather armor + Dex');
  assert.deepEqual(sheet.skills.filter(skill => skill.expertise).map(skill => skill.skill_index).sort(), ['sleight-of-hand', 'stealth']);
  assert.equal(sheet.weapons.find(w => w.name === 'Рапира')!.ability, 'finesse');
  assert.equal(sheet.character.gp, 10);
  assert.match(build({expertise: ['athletics']}).problems.join(), /не выбирают/);
});

test('a high elf wizard: cantrips, a spellbook of six with Int + 1 prepared, slots, the elven cantrip', () => {
  const wizard = buildCharacter({
    name: 'Мирриэль', race: 'elf', subrace: 'high', className: 'wizard', method: 'standard', abilities: scores(8, 14, 13, 15, 12, 10),
    background: 'acolyte', classSkills: ['arcana', 'history'], kit: 'staff',
    cantrips: ['fire-bolt', 'light', 'mage-hand'], raceCantrip: 'chill-touch',
    spells: ['burning-hands', 'charm-person', 'color-spray', 'detect-magic', 'disguise-self', 'alarm'],
  }, spells);
  assert.deepEqual(wizard.problems, []);
  const sheet = wizard.sheet!;
  assert.equal(sheet.character.intelligence, 16);
  assert.equal(sheet.character.hp_max, 6 + 1);
  assert.equal(sheet.character.armor_class, 10 + 3);
  assert.equal(sheet.character.spellcasting_ability, 'intelligence');
  assert.deepEqual(sheet.spellSlots, [{level: 1, max: 2}]);
  assert.equal(sheet.spells.length, 3 + 6 + 1);
  assert.equal(sheet.spells.filter(spell => !spell.prepared).length, 6 - 4, 'Int +3 + 1 prepared');
  assert.ok(sheet.skills.some(skill => skill.skill_index === 'perception'), 'keen senses');
  assert.equal(sheet.weapons.find(w => w.name === 'Боевой посох')!.proficient, true);
  assert.match(buildCharacter({...wizardInput(), spells: ['burning-hands']}, spells).problems.join(), /Заклинания 1-го круга: 6/);
  assert.match(buildCharacter({...wizardInput(), cantrips: ['fire-bolt', 'light', 'sacred-flame']}, spells).problems.join(), /Заговоры: 3/);
});

function wizardInput(): BuildInput {
  return {
    name: 'М', race: 'elf', subrace: 'high', className: 'wizard', method: 'standard', abilities: scores(8, 14, 13, 15, 12, 10),
    background: 'acolyte', classSkills: ['arcana', 'history'], kit: 'staff', cantrips: ['fire-bolt', 'light', 'mage-hand'], raceCantrip: 'chill-touch',
    spells: ['burning-hands', 'charm-person', 'color-spray', 'detect-magic', 'disguise-self', 'alarm'],
  };
}

test('a life cleric always has bless and cure wounds; prepared count follows Wisdom', () => {
  const cleric = buildCharacter({
    name: 'Ансельм', race: 'human', className: 'cleric', method: 'standard', abilities: scores(14, 8, 13, 10, 15, 12),
    background: 'custom', backgroundSkills: ['athletics', 'perception'], classSkills: ['medicine', 'religion'], kit: 'chain',
    cantrips: ['sacred-flame', 'guidance', 'light'], spells: ['command', 'bane', 'detect-magic', 'cure-wounds'],
  }, spells);
  assert.deepEqual(cleric.problems, []);
  const names = cleric.sheet!.spells.map(spell => spell.srd_index);
  assert.ok(names.includes('bless') && names.includes('cure-wounds'));
  assert.equal(names.filter(index => index === 'cure-wounds').length, 1);
  assert.equal(cleric.sheet!.character.armor_class, 16 + 2, 'heavy armor through the Life domain');
});

test('unarmored defence, draconic resilience, a monk’s fists, a dragonborn’s breath', () => {
  const barbarian = build({className: 'barbarian', classSkills: ['athletics', 'survival'], kit: 'battleaxe', fightingStyle: null, abilities: scores(15, 14, 13, 8, 12, 10)});
  assert.deepEqual(barbarian.problems, []);
  assert.equal(barbarian.sheet!.character.armor_class, 10 + 2 + 2 + 2, 'Dex 15 → +2, Con 14 → +2, shield');
  assert.equal(barbarian.sheet!.character.hp_max, 12 + 2);

  const sorcerer = buildCharacter({
    name: 'Искра', race: 'dragonborn', ancestry: 'red', className: 'sorcerer', method: 'standard', abilities: scores(10, 14, 13, 12, 8, 15),
    background: 'acolyte', classSkills: ['arcana', 'persuasion'], kit: 'crossbow', cantrips: ['fire-bolt', 'light', 'mage-hand', 'prestidigitation'],
    spells: ['burning-hands', 'charm-person'],
  }, spells);
  assert.deepEqual(sorcerer.problems, []);
  assert.equal(sorcerer.sheet!.character.armor_class, 13 + 2);
  assert.equal(sorcerer.sheet!.character.hp_max, 6 + 1 + 1);
  assert.deepEqual(sorcerer.sheet!.character.damage_resistances, ['fire']);
  assert.ok(sorcerer.sheet!.resources.some(resource => resource.name === 'Оружие дыхания'));
  assert.match(buildCharacter({...sorcererInput(), ancestry: null}, spells).problems.join(), /дракона-предка/);

  const monk = buildCharacter({
    name: 'Ли', race: 'human', className: 'monk', method: 'standard', abilities: scores(12, 15, 13, 8, 14, 10),
    background: 'acolyte', classSkills: ['acrobatics', 'stealth'], kit: 'spear',
  }, spells);
  assert.deepEqual(monk.problems, []);
  assert.equal(monk.sheet!.character.armor_class, 10 + 3 + 2);
  assert.equal(monk.sheet!.weapons.find(w => w.name === 'Копьё')!.ability, 'finesse');
  assert.ok(monk.sheet!.weapons.some(w => w.name === 'Безоружный удар' && w.damage_formula === '1d4+@mod'));
});

function sorcererInput(): BuildInput {
  return {
    name: 'И', race: 'dragonborn', ancestry: 'red', className: 'sorcerer', method: 'standard', abilities: scores(10, 14, 13, 12, 8, 15),
    background: 'acolyte', classSkills: ['arcana', 'persuasion'], kit: 'crossbow', cantrips: ['fire-bolt', 'light', 'mage-hand', 'prestidigitation'],
    spells: ['burning-hands', 'charm-person'],
  };
}

test('a half-elf picks two abilities and two skills; fighting styles change the weapons', () => {
  assert.match(build({race: 'half-elf', raceSkills: ['stealth', 'history'], flexible: ['charisma', 'strength']}).problems.join(), /кроме Харизмы/);
  const halfElf = build({race: 'half-elf', raceSkills: ['stealth', 'history'], flexible: ['strength', 'constitution']});
  assert.deepEqual(halfElf.problems, []);
  assert.deepEqual([halfElf.sheet!.character.strength, halfElf.sheet!.character.constitution, halfElf.sheet!.character.charisma], [16, 15, 10]);
  const archer = build({kit: 'archer', fightingStyle: 'archery'});
  assert.equal(archer.sheet!.weapons.find(w => w.name === 'Длинный лук')!.attack_bonus, 2);
  assert.equal(archer.sheet!.character.armor_class, 11 + 2, 'leather, Dex 13 + 1 (human) → +2, no Defense');
  const duelist = build({fightingStyle: 'dueling'});
  assert.equal(duelist.sheet!.weapons.find(w => w.name === 'Длинный меч')!.damage_formula, '1d8+@mod+2');
  assert.match(build({fightingStyle: null}).problems.join(), /боевой стиль/);
});

test('a custom race: its own name, +2 and +1 to any two different abilities', () => {
  assert.match(build({race: 'custom', flexible: []}).problems.join(), /Своя раса: выберите характеристику для \+2/);
  assert.match(build({race: 'custom', flexible: ['charisma', 'charisma'] as any}).problems.join(), /Своя раса/);
  const result = build({race: 'custom', raceName: '  Табакси  ', flexible: ['dexterity', 'charisma'] as any});
  assert.deepEqual(result.problems, []);
  const {character} = result.sheet!;
  assert.deepEqual([character.dexterity, character.charisma, character.strength], [15, 9, 15], 'DEX 13+2, CHA 8+1, STR as rolled');
  assert.equal(character.speed_feet, 30);
  assert.equal((character.sheet_extra as any).builder.raceName, 'Табакси');
  assert.equal((build({race: 'custom', flexible: ['strength', 'constitution'] as any}).sheet!.character.sheet_extra as any).builder.raceName, 'Своя раса');
});

test('free ability scores: anything from 1 to 20 before racial bonuses', () => {
  const free = build({method: 'free', abilities: scores(18, 3, 20, 1, 17, 9)});
  assert.deepEqual(free.problems, []);
  assert.deepEqual([free.sheet!.character.strength, free.sheet!.character.dexterity], [19, 4], 'human +1 to everything');
  assert.match(build({method: 'free', abilities: scores(21, 10, 10, 10, 10, 10)}).problems.join(' '), /от 1 до 20/);
  assert.match(build({method: 'free', abilities: scores(0, 10, 10, 10, 10, 10)}).problems.join(' '), /от 1 до 20/);
});
