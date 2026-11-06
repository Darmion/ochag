import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MAX_EXPLOSION_CHAIN, parseExpression, rollCriticalExtra, rollExpression, type Expression} from './expression.ts';

function parsed(formula: string): Expression {
  const result = parseExpression(formula);
  assert.equal(result.ok, true, `${formula} should parse`);
  return (result as {expression: Expression}).expression;
}

function scripted(values: number[]) {
  let index = 0;
  return () => values[index++ % values.length]!;
}

test('several dice groups, numbers and signs add up', () => {
  const roll = rollExpression(parsed('1d8+1d6+3'), scripted([5, 4]));
  assert.equal(roll.ok, true);
  if (!roll.ok) return;
  assert.equal(roll.total, 12);
  assert.equal(roll.modifier, 3);
  assert.deepEqual(roll.groups.map(g => [g.notation, g.rolls]), [['1d8', [5]], ['1d6', [4]]]);
  assert.deepEqual(roll.dice, [5, 4]);

  const minus = rollExpression(parsed('2d6-1d4-2'), scripted([3, 6, 2]));
  assert.equal(minus.ok && minus.total, 3 + 6 - 2 - 2);
});

test('a die count of one may be omitted: d20 is 1d20', () => {
  const roll = rollExpression(parsed('d20+5'), scripted([11]));
  assert.equal(roll.ok && roll.total, 16);
});

test('keep highest / lowest: 4d6kh3 drops the lowest, 2d20kl1 keeps the lowest', () => {
  const stats = rollExpression(parsed('4d6kh3'), scripted([2, 6, 1, 5]));
  assert.equal(stats.ok, true);
  if (!stats.ok) return;
  assert.equal(stats.total, 13);
  assert.deepEqual(stats.groups[0]!.rolls, [2, 6, 1, 5]);
  assert.deepEqual(stats.groups[0]!.kept, [6, 5, 2]);

  const disadvantage = rollExpression(parsed('2d20kl1+4'), scripted([17, 3]));
  assert.equal(disadvantage.ok && disadvantage.total, 7);
});

test('sheet variables need a character context', () => {
  const expression = parsed('1d20+@str+@prof');
  const missing = rollExpression(expression, scripted([10]));
  assert.deepEqual(missing, {ok: false, reason: 'missing-value', token: 'str'});

  const roll = rollExpression(expression, scripted([10]), {str: 3, prof: 2});
  assert.equal(roll.ok && roll.total, 15);
  assert.equal(roll.ok && roll.modifier, 5);
});

test('malformed or oversized formulas are rejected', () => {
  for (const formula of ['', 'abc', '1d', 'd', '2d6+', '+', '2d6++3', '2d6 + 3', '3', '0d6', '51d6', '1d1001', '4d6kh5', '4d6kh0', '2d6+5000']) {
    assert.equal(parseExpression(formula).ok, false, formula);
  }
  assert.deepEqual(parseExpression('1d6+@luck'), {ok: false, reason: 'unknown-token', token: 'luck'});
  assert.deepEqual(parseExpression('50d6+50d6+50d6'), {ok: false, reason: 'too-many-dice'});
  for (const formula of ['51d6', '60d6+1', '101d6']) assert.deepEqual(parseExpression(formula), {ok: false, reason: 'too-many-dice'}, formula);
  assert.equal(parseExpression('1d6'.repeat(1) + '+1'.repeat(60)).ok, false, 'over 100 characters or 20 terms');
});

test('old simple formulas keep working exactly as before', () => {
  const roll = rollExpression(parsed('1D20+5'), scripted([14]));
  assert.equal(roll.ok && roll.total, 19);
  assert.equal(roll.ok && roll.dice.length, 1);
});

test('a critical hit rolls every dice group again, not the numbers', () => {
  const extra = rollCriticalExtra(parsed('1d8+2d6+3'), scripted([7, 1, 2]));
  assert.equal(extra.total, 10);
  assert.deepEqual(extra.groups.map(g => g.notation), ['1d8', '2d6']);
});

test('exploding dice: a maximum rolls that die again and adds it', () => {
  const roll = rollExpression(parsed('2d6!+1'), scripted([6, 3, 2]));
  assert.equal(roll.ok, true);
  if (!roll.ok) return;
  assert.deepEqual(roll.groups.map(g => [g.notation, g.rolls, g.kept]), [['2d6!', [6, 3, 2], [6, 3, 2]]]);
  assert.equal(roll.total, 12);

  const chain = rollExpression(parsed('1d6!'), scripted([6, 6, 1]));
  assert.equal(chain.ok && chain.total, 13);

  const capped = rollExpression(parsed('1d6!'), () => 6);
  assert.equal(capped.ok && capped.groups[0]!.rolls.length, 1 + MAX_EXPLOSION_CHAIN);

  const crit = rollCriticalExtra(parsed('1d8!'), scripted([8, 2]));
  assert.equal(crit.total, 10);
});

test('exploding dice need at least two sides and do not mix with keep', () => {
  for (const formula of ['1d1!', '4d6!kh3', '2d20!kl1']) {
    assert.equal(parseExpression(formula).ok, false, formula);
  }
  assert.equal(parseExpression('d20!').ok, true);
});
