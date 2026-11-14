import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MAX_EXPLOSION_CHAIN, MAX_REROLL_CHAIN, parseExpression, rollCriticalExtra, rollExpression, type Expression} from './expression.ts';

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

test('reroll once: 1d20r1 rolls a 1 again a single time, and the record keeps what was replaced', () => {
  const roll = rollExpression(parsed('1d20r1+2'), scripted([1, 1]));
  assert.equal(roll.ok, true);
  if (!roll.ok) return;
  assert.deepEqual([roll.groups[0]!.rolls, roll.groups[0]!.rerolled, roll.total], [[1], [1], 3], 'once means once, even if the new roll is a 1 again');
  assert.equal(roll.groups[0]!.notation, '1d20r1');
  const greatWeapon = rollExpression(parsed('2d6ro<3'), scripted([1, 5, 2, 2]));
  assert.equal(greatWeapon.ok && greatWeapon.total, 5 + 2, 'ro is an alias of once: 1 → 5, then 2 → 2');
  assert.deepEqual(greatWeapon.ok && greatWeapon.groups[0]!.rerolled, [1, 2]);
});

test('reroll until: rr<3 keeps rolling while the die is under 3, up to a cap', () => {
  const roll = rollExpression(parsed('1d6rr<3'), scripted([1, 2, 1, 5]));
  assert.equal(roll.ok, true);
  if (!roll.ok) return;
  assert.deepEqual([roll.groups[0]!.rolls, roll.groups[0]!.rerolled, roll.total], [[5], [1, 2, 1], 5]);
  const capped = rollExpression(parsed('1d6rr1'), () => 1);
  assert.equal(capped.ok && capped.groups[0]!.rerolled!.length, MAX_REROLL_CHAIN);
});

test('face limits: min2 and max5 hold every die within them', () => {
  const roll = rollExpression(parsed('3d6min2max5'), scripted([1, 6, 4]));
  assert.equal(roll.ok, true);
  if (!roll.ok) return;
  assert.deepEqual([roll.groups[0]!.rolls, roll.total], [[2, 5, 4], 11]);
});

test('a pool counts successes: 6d10cs>=8 counts eights and above; cf=1 takes ones away; 10s explode with !', () => {
  const roll = rollExpression(parsed('6d10cs>=8'), scripted([9, 8, 3, 2, 10, 1]));
  assert.equal(roll.ok, true);
  if (!roll.ok) return;
  assert.deepEqual([roll.groups[0]!.successes, roll.total], [3, 3]);
  const botched = rollExpression(parsed('4d10cs>=8cf=1'), scripted([9, 1, 1, 4]));
  assert.equal(botched.ok && botched.total, -1, 'one success, two ones');
  const again = rollExpression(parsed('2d10!cs>=8'), scripted([10, 9, 3]));
  assert.equal(again.ok && again.total, 2, 'the exploded 10 rolled a 9: two successes');
  const hits = rollExpression(parsed('5d6cs>=5+2'), scripted([5, 6, 1, 2, 3]));
  assert.equal(hits.ok && hits.total, 4, 'hits plus a flat bonus');
});

test('modifiers that make no sense are rejected', () => {
  for (const formula of ['1d6r<7', '1d6rr>=1', '1d6min0', '1d6min7', '1d6max0', '1d6min4max3', '1d6cf=1', '4d6kh3cs>=5', '1d6r1r2', '1d20q1']) {
    assert.equal(parseExpression(formula).ok, false, formula);
  }
  for (const formula of ['1d20r1', '1d20ro1', '2d6r<3', '1d8rr<=2', '4d6min2', '10d10!cs>=8', '6d6cs>4cf<2', '1d20kh1']) {
    assert.equal(parseExpression(formula).ok, true, formula);
  }
});
