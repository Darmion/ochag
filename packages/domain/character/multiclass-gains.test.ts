import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MULTICLASS_GAINS, multiclassGainText, weaponGained} from './multiclass-gains.ts';
import {levelUpPlan, levelUpProblems} from './level-up.ts';

test('multiclass proficiencies follow the PHB table', () => {
  assert.equal(multiclassGainText('fighter'), 'лёгкие доспехи, средние доспехи, щиты, простое оружие, воинское оружие');
  assert.equal(multiclassGainText('wizard'), 'новых владений нет');
  assert.match(multiclassGainText('rogue'), /лёгкие доспехи, навык на выбор из списка класса, воровские инструменты/);
  assert.deepEqual(MULTICLASS_GAINS.bard.skills, {count: 1, from: 'any'});
  assert.ok(Array.isArray(MULTICLASS_GAINS.ranger.skills?.from) && MULTICLASS_GAINS.ranger.skills!.from.includes('survival'));
  assert.equal(weaponGained('fighter', 'Длинный меч'), true, 'martial');
  assert.equal(weaponGained('warlock', 'Длинный меч'), false, 'warlocks gain simple weapons only');
  assert.equal(weaponGained('warlock', 'кинжал'), true);
  assert.equal(weaponGained('monk', 'Короткий меч'), true, 'monks — shortswords');
  assert.equal(weaponGained('fighter', 'Посох мага Хельги'), false, 'not an SRD weapon — left as it is');
});

test('the level-up plan asks for the new class’s skill; expertise may take it at once', () => {
  const mira = {level: 2, experience: 900, class_name: 'Волшебник 2', constitution: 12};
  const plan = levelUpPlan(mira, false, 'rogue')!;
  assert.deepEqual(plan.multiclassGain?.skills?.count, 1);
  const context = {scores: {strength: 10, dexterity: 14, constitution: 12, intelligence: 16, wisdom: 10, charisma: 10}, proficientSkills: ['arcana'], expertiseSkills: [], knownSpells: [], spellBook: []};
  assert.match(levelUpProblems(plan, {hp: 'average', expertise: ['arcana', 'stealth']}, context).join(' '), /Навык нового класса/);
  assert.match(levelUpProblems(plan, {hp: 'average', skills: ['history'], expertise: ['arcana', 'history']}, context).join(' '), /Навык нового класса/, 'history is not a rogue skill');
  assert.deepEqual(levelUpProblems(plan, {hp: 'average', skills: ['stealth'], expertise: ['arcana', 'stealth']}, context), []);
  const own = levelUpPlan(mira, false, 'wizard')!;
  assert.equal(own.multiclassGain, null, 'raising one’s own class gives nothing new');
  assert.match(levelUpProblems(own, {hp: 'average', skills: ['stealth']}, context).join(' '), /Навыков на этом уровне не выбирают/);
});
