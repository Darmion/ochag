import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeModMonster} from './mod-monsters.ts';
import {attackBonusOf, bestiaryMonsters, conditionImmunityCodes, defineModMonster, findMonster, monsterSheet, SRD_MONSTERS} from './bestiary.ts';

const base = {id: 'mod_mire_toad', name: 'Болотная жаба', type: 'зверь', ac: 11, hitDice: '3d8+3', cr: 0.5, abilities: {strength: 14, dexterity: 12, constitution: 13, intelligence: 2, wisdom: 10, charisma: 3}};

test('what the author leaves out is worked out: hit points, attack bonus, average damage, passive Perception, the English name', () => {
  const toad = normalizeModMonster({
    ...base, skills: {perception: 2}, conditionImmunities: ['poisoned', 'charmed'],
    attacks: [{name: 'Укус', damage: '1d10+2', type: 'piercing', extra: {damage: '1d4', type: 'poison'}}, {name: 'Плевок', kind: 'ranged', range: [20, 60], damage: '1d4+1', type: 'acid'}],
  }, 'Болота');
  assert.deepEqual([toad.hp, toad.passive, toad.name, toad.alignment, toad.languages, toad.speed, toad.size, toad.modName], [16, 12, 'Болотная жаба', 'без мировоззрения', '—', 30, 'medium', 'Болота']);
  assert.deepEqual(toad.abilities, [14, 12, 13, 2, 10, 3]);
  assert.deepEqual(toad.attacks.map(attack => [attack.ability, attack.toHit, attack.average, attack.extra?.average ?? null]), [['strength', 4, 7, 2], ['dexterity', 3, 3, null]]);
  assert.equal(attackBonusOf(toad, toad.attacks[0]!), 0, 'no hidden bonus when toHit is worked out');
  assert.deepEqual(conditionImmunityCodes(toad.conditionImmunities).sort(), ['charmed', 'poisoned'], 'the conditions engine reads the immunity back');
});

test('a wrong description says what is expected', () => {
  const wrong = (patch: Record<string, unknown>) => () => normalizeModMonster({...base, ...patch}, 'Болота');
  assert.throws(wrong({id: 'toad'}), /id — mod_/);
  assert.throws(wrong({cr: 0.75}), /cr — опасность/);
  assert.throws(wrong({hitDice: '3d7'}), /hitDice — кости хитов/);
  assert.throws(wrong({abilities: [10, 10, 10]}), /abilities —/);
  assert.throws(wrong({type: ''}), /нужен type/);
  assert.throws(wrong({attacks: [{name: 'Плевок', kind: 'ranged', damage: '1d4', type: 'acid'}]}), /атака 1: у дальнобойной атаки нужна range/);
  assert.throws(wrong({resistant: ['silver']}), /resistant — виды урона или nonmagical/);
  assert.throws(wrong({vulnerable: ['nonmagical']}), /vulnerable — виды урона$/);
  assert.throws(wrong({multiattack: {count: 2, text: 'Кусает дважды.'}}), /начинается со «Совершает…»/);
  assert.throws(wrong({conditionImmunities: ['scared']}), /conditionImmunities — коды состояний/);
  assert.throws(wrong({legendary: {actions: 3, options: []}}), /legendary —/);
  assert.throws(wrong({spellcasting: {ability: 'wisdom', spells: ['bless'], slotless: ['light']}}), /spellcasting —/);
});

test('the registry: a mod creature is found next to the SRD ones, and its sheet names the mod', () => {
  const count = SRD_MONSTERS.length;
  defineModMonster(normalizeModMonster({...base, saves: {constitution: 5}, attacks: [{name: 'Укус', damage: '1d6+2', type: 'piercing'}]}, 'Болота'));
  assert.equal(bestiaryMonsters().length, count + 1);
  const toad = findMonster('mod_mire_toad')!;
  const sheet = monsterSheet(toad, toad.hp);
  assert.equal((sheet.character.sheet_extra.text as any).source.value, 'мод «Болота»');
  assert.deepEqual(sheet.saves, [{ability: 'constitution', proficient: true, custom_bonus: 2}], 'CON +1, proficiency +2, the rest kept');
  assert.equal(findMonster('goblin')?.nameRu, 'Гоблин');
});
