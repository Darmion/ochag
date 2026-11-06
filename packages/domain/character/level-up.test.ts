import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyIncreases, levelHp, levelUpPlan, levelUpProblems} from './level-up.ts';
import {XP_THRESHOLDS} from './experience.ts';

const raw = JSON.parse(readFileSync(new URL('../srd/spells.json', import.meta.url), 'utf8'));
const spellBook = (Array.isArray(raw) ? raw : raw.spells).map((spell: any) => ({index: spell.index, level: spell.level, classes: spell.classes}));
const hero = (className: string, level: number, extra: any = {}) => ({
  level, experience: XP_THRESHOLDS[level]!, class_name: className, constitution: 14, hit_die: null, sheet_extra: {}, ...extra,
});
const scores = {strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8};
const context = (extra: any = {}) => ({scores, proficientSkills: ['athletics', 'perception', 'stealth'], expertiseSkills: [], knownSpells: [], spellBook, ...extra});

test('what the next level brings: ability increase, spells, cantrips, expertise, fighting style, features', () => {
  const fighter = levelUpPlan(hero('Воин', 3))!;
  assert.deepEqual([fighter.from, fighter.to, fighter.asi, fighter.spells, fighter.hitDie, fighter.averageHp], [3, 4, true, 0, 10, 8]);
  assert.deepEqual(fighter.features, ['Улучшение характеристик']);
  assert.equal(levelUpPlan(hero('Воин', 5))!.asi, true, 'fighters get an extra increase at 6');

  const wizard = levelUpPlan(hero('Волшебник', 3))!;
  assert.deepEqual([wizard.cantrips, wizard.spells, wizard.maxSpellLevel, wizard.asi], [1, 2, 2, true]);
  const bard = levelUpPlan(hero('Бард', 9))!;
  assert.deepEqual([bard.cantrips, bard.spells, bard.anyList, bard.expertise], [1, 2, true, 2]);
  const warlock = levelUpPlan(hero('Колдун', 2))!;
  assert.deepEqual([warlock.spells, warlock.maxSpellLevel], [1, 2]);
  const paladin = levelUpPlan(hero('Паладин', 1))!;
  assert.deepEqual(paladin.fightingStyles, ['defense', 'dueling', 'great-weapon', 'protection']);
  assert.ok(paladin.features.includes('Божественная кара'));
  assert.equal(levelUpPlan(hero('Жрец', 4))!.spells, 0, 'clerics prepare from the whole list');

  assert.equal(levelUpPlan({...hero('Воин', 3), experience: XP_THRESHOLDS[3]! - 1}), null, 'not enough experience yet');
  assert.equal(levelUpPlan({...hero('Воин', 3), experience: 0}, true)!.to, 4, 'the GM can level up by milestone');
  assert.equal(levelUpPlan(hero('Воин', 20)), null);
  assert.equal(levelUpPlan(hero('Чародей', 1, {sheet_extra: {builder: {class: 'sorcerer', subrace: 'hill'}}}))!.averageHp, 6 / 2 + 1 + 2 + 2);
});

test('hit points: average or the die, never below 1; increases cap at 20', () => {
  const plan = levelUpPlan(hero('Воин', 3))!;
  assert.equal(levelHp(plan, 14, null), 8);
  assert.equal(levelHp(plan, 14, 10), 12);
  assert.equal(levelHp(plan, 6, 1), 1, 'a 1 with Con −2 still gives 1');
  assert.deepEqual(applyIncreases(scores, {strength: 2}), {...scores, strength: 18});
  assert.equal(applyIncreases({...scores, strength: 19}, {strength: 2}).strength, 20);
});

test('choices are checked against what the level gives', () => {
  const fighter = levelUpPlan(hero('Воин', 3))!;
  assert.deepEqual(levelUpProblems(fighter, {hp: 'roll', asi: {kind: 'asi', increases: {strength: 2}}}, context()), []);
  assert.deepEqual(levelUpProblems(fighter, {hp: 'average', asi: {kind: 'asi', increases: {strength: 1, constitution: 1}}}, context()), []);
  assert.deepEqual(levelUpProblems(fighter, {hp: 'average', asi: {kind: 'feat', name: 'Борец'}}, context()), []);
  assert.match(levelUpProblems(fighter, {hp: 'average'}, context()).join(), /улучшение характеристик или черту/);
  assert.match(levelUpProblems(fighter, {hp: 'average', asi: {kind: 'asi', increases: {strength: 3}}}, context()).join(), /\+2 к одной/);
  assert.match(levelUpProblems(fighter, {hp: 'average', asi: {kind: 'asi', increases: {strength: 2}}}, context({scores: {...scores, strength: 19}})).join(), /не выше 20/);
  assert.match(levelUpProblems(levelUpPlan(hero('Воин', 1))!, {hp: 'average', asi: {kind: 'feat', name: 'x'}}, context()).join(), /не положено/);

  const wizard = levelUpPlan(hero('Волшебник', 3))!;
  const ok = {hp: 'average' as const, asi: {kind: 'asi' as const, increases: {intelligence: 2}}, cantrips: ['ray-of-frost'], spells: ['misty-step', 'shield']};
  assert.deepEqual(levelUpProblems(wizard, ok, context()), []);
  assert.match(levelUpProblems(wizard, {...ok, spells: ['misty-step', 'fireball']}, context()).join(), /не выше 2 уровня/);
  assert.match(levelUpProblems(wizard, {...ok, spells: ['misty-step', 'cure-wounds']}, context()).join(), /из списка класса/);
  assert.match(levelUpProblems(wizard, ok, context({knownSpells: ['shield']})).join(), /которых ещё нет/);
  const bard = levelUpPlan(hero('Бард', 9))!;
  assert.deepEqual(levelUpProblems(bard, {hp: 'average', cantrips: ['light'], spells: ['fireball', 'cure-wounds'], expertise: ['athletics', 'stealth']}, context()), [], 'magical secrets take any list');
  assert.match(levelUpProblems(bard, {hp: 'average', cantrips: ['light'], spells: ['fireball', 'cure-wounds'], expertise: ['athletics', 'arcana']}, context()).join(), /Компетентность/);
  const paladin = levelUpPlan(hero('Паладин', 1))!;
  assert.match(levelUpProblems(paladin, {hp: 'average', fightingStyle: 'archery'}, context()).join(), /боевой стиль/);
  assert.deepEqual(levelUpProblems(paladin, {hp: 'average', fightingStyle: 'defense'}, context()), []);
});

test('multiclass level-up: the chosen class decides the die, ASI, spells and features; 13+ only warns', () => {
  const fighter = hero('Воин', 3, {strength: 16, intelligence: 10});
  const wizard = levelUpPlan(fighter, false, 'wizard')!;
  assert.deepEqual([wizard.newClass, wizard.multiclass, wizard.classLevel, wizard.hitDie, wizard.classText], [true, true, 1, 6, 'Воин 3 / Волшебник 1']);
  assert.deepEqual([wizard.cantrips, wizard.spells, wizard.maxSpellLevel], [3, 6, 1], 'a new wizard: 3 cantrips, 6 spells in the book');
  assert.deepEqual(wizard.prerequisites, ['Волшебник: нужна Интеллект 13+'], 'warned, not refused');
  assert.equal(wizard.asi, false, 'level 4 overall, but wizard 1 — no ASI');

  const second = levelUpPlan(hero('Воин 3 / Волшебник 3', 6, {intelligence: 14}), false, 'wizard')!;
  assert.deepEqual([second.classLevel, second.asi, second.spells, second.classText], [4, true, 2, 'Воин 3 / Волшебник 4'], 'wizard 4 — ASI by the class level');
  const fighterAgain = levelUpPlan(hero('Воин 3 / Волшебник 3', 6), false, 'fighter')!;
  assert.deepEqual([fighterAgain.classLevel, fighterAgain.asi, fighterAgain.hitDie, fighterAgain.prerequisites], [4, true, 10, []]);

  const single = levelUpPlan(hero('Воин', 3), false)!;
  assert.deepEqual([single.classId, single.classLevel, single.newClass, single.multiclass, single.classText], ['fighter', 4, false, false, 'Воин'], 'one class — as before');
  assert.equal(levelUpPlan(hero('Воин 3 / Волшебник 3', 5), false)!.classProblem, 'сумма уровней классов (6) не равна уровню персонажа (5)');
});
