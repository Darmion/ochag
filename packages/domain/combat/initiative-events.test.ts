import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LAIR_RULES_5E, eventEntryName, eventOf, eventProblems, freeOptions, type TurnEvent} from './initiative-events.ts';

const lair = (options: string[], rules = LAIR_RULES_5E, active = true): TurnEvent => ({
  kind: 'lair', active, rules, options: options.map(name => ({name, text: `${name}.`})),
});

test('a lair under D&D 5e rules: count 20, loses ties, the same action waits a round', () => {
  assert.deepEqual(LAIR_RULES_5E, {score: 20, tieRank: 1, noRepeat: true});
  const event = lair(['Обвал', 'Гейзер', 'Туман']);
  assert.deepEqual(eventProblems(event), []);
  assert.deepEqual(freeOptions(event, null), [0, 1, 2]);
  assert.deepEqual(freeOptions(event, 'Гейзер'), [0, 2]);
  assert.deepEqual(freeOptions({...event, rules: {...event.rules, noRepeat: false}}, 'Гейзер'), [0, 1, 2]);
  assert.equal(eventEntryName('Древний красный дракон', 'lair'), 'Логово: Древний красный дракон');
});

test('event settings are checked before they are stored; other systems bring their own numbers', () => {
  assert.match(eventProblems(lair([]))[0]!, /хотя бы один/);
  assert.deepEqual(eventProblems(lair([], LAIR_RULES_5E, false)), [], 'switched off and empty is fine');
  assert.match(eventProblems(lair(['Обвал']))[0]!, /второй вариант/);
  assert.match(eventProblems(lair(['Обвал', 'Обвал'])).join(' '), /Два варианта/);
  assert.match(eventProblems({...lair(['А', 'Б']), kind: 'storm'}).join(' '), /Неизвестный вид/);
  assert.match(eventProblems(lair(['А', 'Б'], {score: 99, tieRank: 1, noRepeat: true})).join(' '), /Счёт инициативы/);
  assert.deepEqual(eventProblems(lair(['А'], {score: 10, tieRank: -1, noRepeat: false})), [], 'a hazard on 10 that wins ties');
  assert.equal(eventOf([{kind: 'lair'}], 'lair')?.kind, 'lair');
  assert.equal(eventOf(null, 'lair'), null);
});
