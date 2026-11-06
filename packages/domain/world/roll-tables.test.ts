import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TABLE_PRESETS, entryFor, parseCount, rollCount, tableProblems} from './roll-tables.ts';

test('a table must cover every result of its die exactly once', () => {
  const rows = (pairs: Array<[number, number]>) => pairs.map(([from, to]) => ({from, to, text: 'x'}));
  assert.deepEqual(tableProblems('1d6', rows([[1, 2], [3, 6]])), []);
  assert.deepEqual(tableProblems('2d6', rows([[2, 6], [7, 7], [8, 12]])), []);
  assert.deepEqual(tableProblems('1d6', rows([[1, 2], [4, 6]])), ['Не покрыто: 3.']);
  assert.deepEqual(tableProblems('1d6', rows([[1, 4]])), ['Не покрыто: 5–6.']);
  assert.deepEqual(tableProblems('1d6', rows([[1, 3], [3, 6]])), ['Строка 3–6: пересекается с предыдущей.']);
  assert.deepEqual(tableProblems('1d6', rows([[1, 7]])), ['Строка 1–7: вне значений 1d6 (1–6).']);
  assert.match(tableProblems('1d6+1', rows([[1, 6]]))[0]!, /без прибавок/);
  assert.match(tableProblems('d6', [])[0]!, /Кость таблицы/);
  assert.deepEqual(tableProblems('1d4', []), ['В таблице нет строк.']);
  assert.deepEqual(tableProblems('1d2', [{from: 1, to: 2, text: ' '}]), ['Строка 1–2: пустой текст.']);
});

test('monsters in a row: from the bestiary, 1 to 20 of them', () => {
  const row = (monsters: any) => [{from: 1, to: 4, text: 'Волки', monsters}];
  assert.deepEqual(tableProblems('1d4', row([{index: 'wolf', count: '1d4+1'}])), []);
  assert.deepEqual(tableProblems('1d4', row([{index: 'tarrasque', count: '1'}])), ['Строка 1–4: в бестиарии нет «tarrasque».']);
  assert.match(tableProblems('1d4', row([{index: 'wolf', count: '3d10'}]))[0]!, /от 1 до 20/);
  assert.deepEqual(parseCount('3'), {min: 3, max: 3});
  assert.deepEqual(parseCount('1d4+1'), {min: 2, max: 5});
  assert.equal(parseCount('0'), null);
  assert.equal(parseCount('волк'), null);
  assert.equal(rollCount('2d4', () => 4), 8);
  assert.equal(rollCount('5', () => 1), 5);
});

test('the rolled row and the ready-made tables', () => {
  const entries = [{from: 1, to: 2, text: 'а'}, {from: 3, to: 6, text: 'б'}];
  assert.equal(entryFor(entries, 2)?.text, 'а');
  assert.equal(entryFor(entries, 5)?.text, 'б');
  assert.equal(entryFor(entries, 7), undefined);
  assert.ok(TABLE_PRESETS.length >= 4);
  for (const preset of TABLE_PRESETS) assert.deepEqual(tableProblems(preset.formula, preset.entries), [], preset.id);
});
