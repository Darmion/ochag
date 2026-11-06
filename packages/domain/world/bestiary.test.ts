import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  SRD_MONSTERS, attackBonusOf, attackText, averageOf, challengeText, findMonster, modifierOf, monsterProficiency,
  monsterSheet, monsterTexts, proficiencyLevel, rollHitPoints, skillAbility,
} from './bestiary.ts';
import {challengeExperience} from '../character/experience.ts';
import {parseFormula, proficiencyBonusForChallenge, proficiencyOf} from '../dice/dice.ts';

const spells = JSON.parse(readFileSync(new URL('../srd/spells.json', import.meta.url), 'utf8'));
const spellIndexes = new Set((Array.isArray(spells) ? spells : spells.spells).map((spell: any) => spell.index));

test('every monster adds up: hit points from hit dice, damage averages, bonuses from abilities and proficiency', () => {
  const indexes = new Set<string>();
  for (const monster of SRD_MONSTERS) {
    const where = monster.index;
    assert.ok(!indexes.has(where), `${where}: повтор`);
    indexes.add(where);
    assert.ok(challengeExperience(monster.cr) !== null, `${where}: опасность`);
    assert.equal(averageOf(monster.hitDice), monster.hp, `${where}: хиты`);
    const hitDice = parseFormula(monster.hitDice)!;
    assert.equal(hitDice.modifier, hitDice.count * modifierOf(monster, 'constitution'), `${where}: кости хитов и ТЕЛ`);

    const proficiency = monsterProficiency(monster);
    for (const [ability, total] of Object.entries(monster.saves ?? {})) {
      assert.equal(total, modifierOf(monster, ability as any) + proficiency, `${where}: спасбросок ${ability}`);
    }
    for (const [skill, total] of Object.entries(monster.skills ?? {})) {
      const ability = skillAbility(skill);
      assert.ok(ability, `${where}: навык ${skill}`);
      assert.ok(proficiencyLevel(modifierOf(monster, ability!), total, proficiency), `${where}: ${skill} ${total}`);
    }
    const perception = monster.skills?.perception ?? modifierOf(monster, 'wisdom');
    assert.equal(monster.passive, 10 + perception, `${where}: пассивное Восприятие`);

    assert.ok(monster.attacks.length || (monster.cr === 0 && monster.type === 'зверь'), `${where}: атаки`);
    for (const attack of monster.attacks) {
      const bonus = attackBonusOf(monster, attack);
      assert.equal(bonus !== 0, attack.quirk === true, `${where}/${attack.name}: попадание ${attack.toHit}`);
      if (attack.kind === 'ranged') assert.ok(attack.range, `${where}/${attack.name}: дистанция`);
      if (attack.damage === null) continue;
      assert.equal(averageOf(attack.damage), attack.average, `${where}/${attack.name}: средний урон`);
      assert.ok(attack.type, `${where}/${attack.name}: тип урона`);
      if (attack.extra) assert.equal(averageOf(attack.extra.damage), attack.extra.average, `${where}/${attack.name}: второй урон`);
      if (attack.versatile) assert.ok(averageOf(attack.versatile), `${where}/${attack.name}: двумя руками`);
    }
    for (const index of monster.spellcasting?.spells ?? []) assert.ok(spellIndexes.has(index), `${where}: заклинание ${index}`);
  }
  assert.ok(SRD_MONSTERS.length >= 50);
});

test('proficiency by challenge: +2 up to 4, then +1 every four ratings', () => {
  assert.deepEqual([0, 0.125, 0.25, 0.5, 1, 4, 5, 8, 9, 12, 13, 17, 21, 25, 29, 30].map(proficiencyBonusForChallenge), [2, 2, 2, 2, 2, 2, 3, 3, 4, 4, 5, 6, 7, 8, 9, 9]);
  assert.equal(proficiencyOf({level: 5, challenge_rating: 10}), 3);
  assert.equal(proficiencyOf({level: null, challenge_rating: 6}), 3);
  assert.equal(proficiencyOf({level: null, challenge_rating: '0.250'}), 2);
  assert.equal(proficiencyOf({level: null, challenge_rating: null, sheet_extra: {proficiency: 4}}), 4);
  assert.equal(proficiencyOf({level: null, challenge_rating: null}), null);
});

test('a goblin becomes a sheet: stealth with expertise, scimitar and bow with no extra bonus, SRD text', () => {
  const goblin = findMonster('goblin')!;
  const sheet = monsterSheet(goblin, goblin.hp);
  assert.equal(sheet.character.name, 'Гоблин');
  assert.equal(sheet.character.challenge_rating, 0.25);
  assert.equal(sheet.character.size, 'small');
  assert.deepEqual(sheet.skills, [{skill_index: 'stealth', proficient: true, expertise: true}]);
  assert.deepEqual(sheet.weapons.map(w => [w.name, w.ability, w.damage_formula, w.weapon_kind, w.range_feet, w.long_range_feet, w.attack_bonus]), [
    ['Скимитар', 'dexterity', '1d6+2', 'melee', 5, null, 0],
    ['Короткий лук', 'dexterity', '1d6+2', 'ranged', 80, 320, 0],
  ]);
  assert.equal((sheet.character.sheet_extra as any).darkvisionFeet, 60);
  assert.equal(attackText(goblin.attacks[0]!), 'Скимитар. Рукопашная атака оружием: +4 к попаданию, досягаемость 5 фт., одна цель. Попадание: 5 (1d6 + 2) рубящего урона.');
  assert.match(monsterTexts(goblin).traits, /^Ловкий побег\./);
  assert.match(monsterTexts(goblin).about, /Опасность 1\/4 \(50 опыта\), бонус мастерства \+2\./);
});

test('odd bonuses, second damage types, thrown weapons, spells', () => {
  const ghoul = monsterSheet(findMonster('ghoul')!, 22);
  assert.equal(ghoul.weapons.find(w => w.name === 'Укус')!.attack_bonus, -2);
  const dragon = monsterSheet(findMonster('young-red-dragon')!, 178);
  const bite = dragon.weapons.find(w => w.name === 'Укус')!;
  assert.deepEqual([bite.range_feet, bite.properties, bite.extra_damage_formula, bite.extra_damage_type], [10, ['reach'], '1d6', 'fire']);
  assert.deepEqual(dragon.character.damage_immunities, ['fire']);
  assert.equal(dragon.character.attacks_per_action, 3);
  assert.deepEqual(dragon.saves.map(s => s.ability).sort(), ['charisma', 'constitution', 'dexterity', 'wisdom']);
  const orc = monsterSheet(findMonster('orc')!, 15);
  const javelin = orc.weapons.find(w => w.name === 'Метательное копьё')!;
  assert.deepEqual([javelin.weapon_kind, javelin.range_feet, javelin.thrown_range_feet, javelin.long_range_feet, javelin.properties], ['melee', 5, 30, 120, ['thrown']]);
  const mage = monsterSheet(findMonster('mage')!, 40);
  assert.equal(mage.character.spellcasting_ability, 'intelligence');
  assert.deepEqual(mage.spellSlots, [{level: 1, max: 4}, {level: 2, max: 3}, {level: 3, max: 3}, {level: 4, max: 3}, {level: 5, max: 1}]);
  assert.equal(mage.spells.length, 16);
  assert.equal(challengeText(0.125), '1/8');
});

test('rolled hit points: the dice plus constitution, never below 1', () => {
  assert.equal(rollHitPoints('2d8+2', () => 1), 4);
  assert.equal(rollHitPoints('2d6-2', () => 1), 1);
  assert.equal(rollHitPoints('3d8', sides => sides), 24);
});
