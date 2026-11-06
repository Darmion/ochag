import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveFormula, isFormulaShapeValid, resolveModifier} from './formula.ts';

test('a plain formula without variables resolves exactly like parseFormula would', () => {
  const result = resolveFormula('2d6+3', {});
  assert.deepEqual(result, {ok: true, formula: '2d6+3', parsed: {count: 2, sides: 6, modifier: 3}});
});

test('a bare formula with no modifier at all round-trips without a trailing +0', () => {
  const result = resolveFormula('1d8', {});
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.formula, '1d8');
});

test('substitutes a single ability modifier', () => {
  const result = resolveFormula('1d20+@dex', {dex: 3});
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.parsed, {count: 1, sides: 20, modifier: 3});
});

test('sums several terms: dice modifier, ability, proficiency and a flat bonus', () => {
  const result = resolveFormula('1d20+@dex+@prof+1', {dex: 2, prof: 3});
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.formula, '1d20+6');
});

test('a negative ability modifier subtracts correctly, including through a minus sign', () => {
  const plus = resolveFormula('1d20+@dex', {dex: -1});
  assert.equal(plus.ok && plus.parsed.modifier, -1);

  const minus = resolveFormula('1d20-@dex', {dex: -1});
  assert.equal(minus.ok && minus.parsed.modifier, 1, 'subtracting a negative modifier adds');
});

test('an unknown token is rejected by name, not silently ignored', () => {
  const result = resolveFormula('1d20+@luck', {});
  assert.deepEqual(result, {ok: false, reason: 'unknown-token', token: 'luck'});
});

test('a known token without a value in context is reported, not treated as zero', () => {
  const result = resolveFormula('1d20+@prof', {dex: 2});
  assert.deepEqual(result, {ok: false, reason: 'missing-value', token: 'prof'});
});

test('the combined modifier is still bounded the same way parseFormula bounds a literal one', () => {
  const result = resolveFormula('1d20+@str+@dex', {str: 60, dex: 60});
  assert.deepEqual(result, {ok: false, reason: 'invalid-formula'});
});

test('garbage and malformed variable syntax are rejected, matching parseFormula on the same inputs', () => {
  for (const bad of ['', 'd20', '1d', '1x20', '1d20+', '20', '1d20 + @dex', '1d20+@', '1d20@dex']) {
    assert.deepEqual(resolveFormula(bad, {dex: 1}), {ok: false, reason: 'invalid-formula'}, bad);
  }
});

test('token matching is case-insensitive, same as dice notation itself', () => {
  const result = resolveFormula('1D20+@DEX', {dex: 4});
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.parsed.modifier, 4);
});

test('isFormulaShapeValid accepts plain and variable formulas without needing a character', () => {
  assert.equal(isFormulaShapeValid('2d6+3'), true);
  assert.equal(isFormulaShapeValid('1d20+@dex+@prof'), true);
  assert.equal(isFormulaShapeValid('1d8'), true);
});

test('isFormulaShapeValid rejects unknown tokens and garbage without evaluating any values', () => {
  assert.equal(isFormulaShapeValid('1d20+@luck'), false);
  assert.equal(isFormulaShapeValid('сколько-то кубиков'), false);
  assert.equal(isFormulaShapeValid(''), false);
});

test('isFormulaShapeValid does not require the final modifier to be resolvable, only well-formed', () => {
  assert.equal(isFormulaShapeValid('1d20+@str+@dex'), true);
});

test('resolveModifier sums plain and variable terms without any leading dice', () => {
  assert.deepEqual(resolveModifier('+2', {}), {ok: true, modifier: 2});
  assert.deepEqual(resolveModifier('+@prof', {prof: 3}), {ok: true, modifier: 3});
  assert.deepEqual(resolveModifier('+@dex-1', {dex: 2}), {ok: true, modifier: 1});
});

test('resolveModifier treats an empty string as a valid zero bonus', () => {
  assert.deepEqual(resolveModifier('', {}), {ok: true, modifier: 0});
  assert.deepEqual(resolveModifier('   ', {}), {ok: true, modifier: 0});
});

test('resolveModifier rejects a leading dice term — that belongs to resolveFormula, not here', () => {
  assert.deepEqual(resolveModifier('1d20+2', {}), {ok: false, reason: 'invalid-formula'});
});

test('resolveModifier reports unknown and missing tokens the same way resolveFormula does', () => {
  assert.deepEqual(resolveModifier('+@luck', {}), {ok: false, reason: 'unknown-token', token: 'luck'});
  assert.deepEqual(resolveModifier('+@prof', {dex: 1}), {ok: false, reason: 'missing-value', token: 'prof'});
});
