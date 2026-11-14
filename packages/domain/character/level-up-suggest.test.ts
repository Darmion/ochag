import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {levelUpPlan, levelUpProblems, usableLevelUpChoice} from './level-up.ts';
import {FAVORITE_SPELLS, suggestLevelUp} from './level-up-suggest.ts';
import {CLASS_IDS, CLASS_LABELS} from './classes.ts';
import {XP_THRESHOLDS} from './experience.ts';

const raw = JSON.parse(readFileSync(new URL('../srd/spells.json', import.meta.url), 'utf8'));
const spellBook = (Array.isArray(raw) ? raw : raw.spells).map((spell: any) => ({index: spell.index, level: spell.level, classes: spell.classes}));
const skillIndexes = JSON.parse(readFileSync(new URL('../srd/skills.json', import.meta.url), 'utf8')).map((skill: any) => skill.index);
const scores = {strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8};
const hero = (className: string, level: number, extra: any = {}) => ({
  level, experience: XP_THRESHOLDS[level]!, class_name: className, hit_die: null, sheet_extra: {}, ...scores, ...extra,
});
const context = (extra: any = {}) => ({
  scores, proficientSkills: ['athletics', 'perception', 'stealth'], expertiseSkills: [], knownSpells: [], spellBook, skillIndexes, knownFeats: [], ...extra,
});

test('the suggestion is a complete, valid choice for every class at every level', () => {
  for (const id of CLASS_IDS) {
    for (let level = 1; level < 20; level += 1) {
      const plan = levelUpPlan(hero(`${CLASS_LABELS[id]} ${level}`, level))!;
      const choice = suggestLevelUp(plan, context());
      assert.deepEqual(levelUpProblems(plan, choice, context()), [], `${id} ${level} → ${level + 1}`);
    }
  }
});

test('a multiclass level gets its new skill and stays valid', () => {
  const plan = levelUpPlan(hero('Воин 3', 3, {charisma: 14}), false, 'rogue')!;
  assert.ok(plan.newClass && plan.multiclassGain?.skills);
  const choice = suggestLevelUp(plan, context());
  assert.equal(choice.skills!.length, plan.multiclassGain!.skills!.count);
  assert.deepEqual(levelUpProblems(plan, choice, context()), []);
});

test('what it picks: main ability, odd scores, styles, expertise, the spells most players take', () => {
  assert.deepEqual(suggestLevelUp(levelUpPlan(hero('Воин 3', 3))!, context()).asi, {kind: 'asi', increases: {strength: 2}});
  const odd = context({scores: {...scores, strength: 17, constitution: 15}});
  assert.deepEqual(suggestLevelUp(levelUpPlan(hero('Воин 3', 3))!, odd).asi, {kind: 'asi', increases: {strength: 1, constitution: 1}}, 'two odd scores become two modifiers');
  const maxed = context({scores: {strength: 20, dexterity: 20, constitution: 20, intelligence: 20, wisdom: 20, charisma: 20}});
  assert.deepEqual(suggestLevelUp(levelUpPlan(hero('Воин 3', 3))!, maxed).asi, {kind: 'feat', id: 'tough', name: 'Крепкий'}, 'nothing to raise — a feat');

  const archer = context({scores: {...scores, strength: 10, dexterity: 16}});
  assert.equal(suggestLevelUp(levelUpPlan(hero('Следопыт 1', 1))!, archer).fightingStyle, 'archery');
  assert.equal(suggestLevelUp(levelUpPlan(hero('Паладин 1', 1))!, context()).fightingStyle, 'defense');
  assert.deepEqual(suggestLevelUp(levelUpPlan(hero('Плут 5', 5))!, context()).expertise, ['perception', 'stealth']);

  const wizard = suggestLevelUp(levelUpPlan(hero('Волшебник 4', 4))!, context());
  assert.deepEqual(wizard.spells, ['fireball', 'counterspell'], 'the highest circle first');
  const warlock = suggestLevelUp(levelUpPlan(hero('Колдун 3', 3))!, context({knownSpells: ['eldritch-blast']}));
  assert.equal(warlock.cantrips!.includes('eldritch-blast'), false, 'never a spell that is already known');
});

test('the favourite spells are all SRD spells', () => {
  const known = new Set(spellBook.map((spell: any) => spell.index));
  assert.deepEqual(FAVORITE_SPELLS.filter(index => !known.has(index)), []);
  assert.equal(new Set(FAVORITE_SPELLS).size, FAVORITE_SPELLS.length);
});

test('a dry run keeps what is chosen correctly and leaves out the rest', () => {
  const plan = levelUpPlan(hero('Волшебник 4', 4))!;
  const usable = usableLevelUpChoice(plan, {
    hp: 'roll', asi: {kind: 'asi', increases: {strength: 3}}, spells: ['fireball', 'wish', 'fireball'], cantrips: ['fire-bolt'],
    fightingStyle: 'archery', expertise: ['perception'],
  }, context());
  assert.deepEqual([usable.hp, usable.asi, usable.spells, usable.cantrips, usable.fightingStyle, usable.expertise], ['roll', null, ['fireball'], [], null, []]);
  assert.deepEqual(levelUpProblems(plan, {...usable, spells: ['fireball', 'counterspell']}, context()), [], 'only the second spell is missing');
});
