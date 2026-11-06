import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attacksForClass, characterClassText, classOf, hitDieForClass} from './classes.ts';

test('class by name, Russian or English; the first one in a multiclass', () => {
  assert.equal(classOf('Воин'), 'fighter');
  assert.equal(classOf('Wizard 3 / Fighter 5'), 'wizard', 'the first by position');
  assert.equal(classOf('Плут-вор'), 'rogue');
  assert.equal(classOf('Колдун'), 'warlock');
  assert.equal(classOf('Странник'), null);
  assert.equal(characterClassText({class_name: '  ', sheet_extra: {info: {charClass: {value: 'Паладин'}}}}), 'Паладин', 'empty own field — from the sheet');
  assert.equal(characterClassText({class_name: 'Друид', sheet_extra: {info: {charClass: {value: 'Паладин'}}}}), 'Друид');
  assert.equal(hitDieForClass('barbarian'), 12);
  assert.equal(hitDieForClass(null), 8);
});

test('Extra Attack: fighters 2/3/4 at 5/11/20, other martial classes 2 at 5, everyone else 1', () => {
  assert.equal(attacksForClass('fighter', 4), 1);
  assert.equal(attacksForClass('fighter', 5), 2);
  assert.equal(attacksForClass('fighter', 11), 3);
  assert.equal(attacksForClass('fighter', 20), 4);
  assert.equal(attacksForClass('paladin', 5), 2);
  assert.equal(attacksForClass('monk', 17), 2);
  assert.equal(attacksForClass('wizard', 20), 1);
  assert.equal(attacksForClass(null, 10), 1);
});

test('multiclass levels come from the class text and must add up to the character level', async () => {
  const {advanceClassText, attacksForClasses, multiclassPrerequisiteProblems, parseClassLevels} = await import('./classes.ts');
  assert.deepEqual(parseClassLevels('Воин 3 / Волшебник 2', 5), {classes: [{id: 'fighter', level: 3}, {id: 'wizard', level: 2}], multiclass: true, problem: null});
  assert.deepEqual(parseClassLevels('Воин (мастер боевых искусств) 3, Плут 2', 5).classes, [{id: 'fighter', level: 3}, {id: 'rogue', level: 2}], 'subclass text before the number');
  assert.deepEqual(parseClassLevels('Fighter 5', 3), {classes: [{id: 'fighter', level: 3}], multiclass: false, problem: null}, 'one class — the whole character level');
  assert.equal(parseClassLevels('Воин 3 / Волшебник 3', 5).problem, 'сумма уровней классов (6) не равна уровню персонажа (5)');
  assert.deepEqual(parseClassLevels('Воин 3 / Волшебник 3', 5).classes, [{id: 'fighter', level: 5}], 'not understood — the old way: the first class');
  assert.match(parseClassLevels('Воин / Волшебник', 4).problem!, /укажите уровень каждого класса/);
  assert.equal(parseClassLevels('Вор', 2).classes[0]!.id, 'rogue', 'Cyrillic word boundary: «вор» is found (\b never matched it)');
  assert.equal(parseClassLevels('Маг', 2).classes[0]!.id, 'wizard');
  assert.equal(parseClassLevels('Магистр', 2).classes.length, 0, '«маг» only as a whole word');

  assert.equal(advanceClassText('Воин', 3, 'wizard'), 'Воин 3 / Волшебник 1', 'a second class — numbers appear');
  assert.equal(advanceClassText('Воин (мастер) 3 / Волшебник 2', 5, 'wizard'), 'Воин (мастер) 3 / Волшебник 3', 'the number changes in place');
  assert.equal(advanceClassText('Воин', 3, 'fighter'), 'Воин', 'one class — the text stays');
  assert.equal(advanceClassText('', 1, 'cleric'), 'Жрец');

  assert.equal(attacksForClasses([{id: 'fighter', level: 5}, {id: 'paladin', level: 5}]), 2, 'Extra Attack does not stack');
  assert.equal(attacksForClasses([{id: 'fighter', level: 11}, {id: 'wizard', level: 2}]), 3);

  const scores = {strength: 15, dexterity: 12, constitution: 14, intelligence: 9, wisdom: 10, charisma: 13};
  assert.deepEqual(multiclassPrerequisiteProblems([{id: 'fighter', level: 3}], 'paladin', scores), [], 'STR 15 and CHA 13 — fine');
  assert.deepEqual(multiclassPrerequisiteProblems([{id: 'fighter', level: 3}], 'wizard', scores), ['Волшебник: нужна Интеллект 13+']);
  assert.deepEqual(multiclassPrerequisiteProblems([{id: 'fighter', level: 3}], 'fighter', scores), [], 'not a new class');
});

test('class text from the class and subclass dropdowns is recognised', async () => {
  const {characterClassLevels} = await import('./classes.ts');
  const cases: Array<[string, string, string | undefined]> = [
    ['Варвар (Путь берсерка)', 'barbarian', 'berserker'], ['Бард (Коллегия знаний)', 'bard', 'lore'],
    ['Волшебник (Школа Воплощения)', 'wizard', 'evocation'], ['Воин (Чемпион)', 'fighter', 'champion'],
    ['Воин (Мастер боевых искусств)', 'fighter', 'battle-master'], ['Друид (Круг Земли)', 'druid', 'land'],
    ['Жрец (Домен Жизни)', 'cleric', 'life'], ['Колдун (Исчадие)', 'warlock', 'fiend'],
    ['Монах (Путь открытой ладони)', 'monk', 'open-hand'], ['Паладин (Клятва преданности)', 'paladin', 'devotion'],
    ['Следопыт (Охотник)', 'ranger', 'hunter'], ['Чародей (Драконья кровь)', 'sorcerer', 'draconic'],
  ];
  for (const [text, classId, subclass] of cases) {
    const [entry] = characterClassLevels({class_name: text, level: 5, sheet_extra: {}}).classes;
    assert.deepEqual([entry?.id, entry?.subclass], [classId, subclass], text);
  }
});

test('a subclass in brackets is not another class; the chosen subclass goes into the text', async () => {
  const {parseClassLevels, withSubclassText, advanceClassText, characterClassLevels} = await import('./classes.ts');
  assert.deepEqual(parseClassLevels('Плут (Вор)', 3), {classes: [{id: 'rogue', level: 3}], multiclass: false, problem: null});
  assert.deepEqual(parseClassLevels('Воин (Пси-воин) 3', 3), {classes: [{id: 'fighter', level: 3}], multiclass: false, problem: null});
  assert.deepEqual(parseClassLevels('Варвар (Путь тотемного воина) 2 / Воин 1', 3).classes, [{id: 'barbarian', level: 2}, {id: 'fighter', level: 1}]);
  assert.equal(characterClassLevels({class_name: 'Варвар (Путь тотемного воина) 3', level: 3}).classes[0]!.subclass, 'totem-warrior');
  assert.equal(withSubclassText('Паладин', 3, 'paladin', 'Клятва мести'), 'Паладин (Клятва мести)');
  assert.equal(withSubclassText('Воин 3 / Волшебник 2', 5, 'wizard', 'Школа Воплощения'), 'Воин 3 / Волшебник (Школа Воплощения) 2');
  assert.equal(withSubclassText('Воин (Чемпион) 3', 3, 'fighter', 'Самурай'), 'Воин (Чемпион) 3', 'already described — unchanged');
  assert.equal(advanceClassText('Плут (Вор)', 3, 'fighter'), 'Плут (Вор) 3 / Воин 1');
});
