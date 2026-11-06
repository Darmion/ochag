import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseFormula, rollDice, abilityModifier, proficiencyBonusForLevel, rollCheck, hitChance} from './dice.ts';

test('parses a simple formula with a positive modifier', () => {
  assert.deepEqual(parseFormula('1d20+5'), {count: 1, sides: 20, modifier: 5});
});

test('parses a formula with a negative modifier and no leading count sign', () => {
  assert.deepEqual(parseFormula('2d6-1'), {count: 2, sides: 6, modifier: -1});
});

test('parses a bare formula with no modifier', () => {
  assert.deepEqual(parseFormula('1d8'), {count: 1, sides: 8, modifier: 0});
});

test('rejects garbage input', () => {
  for (const bad of ['', 'd20', '1d', '1x20', '1d20+', '20', 'one d twenty']) {
    assert.equal(parseFormula(bad), null, bad);
  }
});

test('rejects out-of-range count, sides or modifier', () => {
  assert.equal(parseFormula('21d20'), null);
  assert.equal(parseFormula('1d1001'), null);
  assert.equal(parseFormula('1d20+101'), null);
});

test('rollDice sums the injected rolls plus the modifier', () => {
  const sequence = [4, 6, 2];
  let i = 0;
  const rollDie = () => sequence[i++];
  const result = rollDice({count: 3, sides: 6, modifier: 3}, rollDie);
  assert.deepEqual(result, {results: [4, 6, 2], total: 15});
});

test('rollDice passes the correct side count through to the roller', () => {
  const sides: number[] = [];
  rollDice({count: 2, sides: 20, modifier: 0}, s => { sides.push(s); return 1; });
  assert.deepEqual(sides, [20, 20]);
});

test('abilityModifier matches the standard D&D 5e table', () => {
  assert.equal(abilityModifier(8), -1);
  assert.equal(abilityModifier(10), 0);
  assert.equal(abilityModifier(11), 0);
  assert.equal(abilityModifier(20), 5);
  assert.equal(abilityModifier(1), -5);
});

test('proficiencyBonusForLevel matches the standard D&D 5e 2014 table', () => {
  assert.equal(proficiencyBonusForLevel(1), 2);
  assert.equal(proficiencyBonusForLevel(4), 2);
  assert.equal(proficiencyBonusForLevel(5), 3);
  assert.equal(proficiencyBonusForLevel(8), 3);
  assert.equal(proficiencyBonusForLevel(9), 4);
  assert.equal(proficiencyBonusForLevel(12), 4);
  assert.equal(proficiencyBonusForLevel(13), 5);
  assert.equal(proficiencyBonusForLevel(16), 5);
  assert.equal(proficiencyBonusForLevel(17), 6);
  assert.equal(proficiencyBonusForLevel(20), 6);
});

test('rollCheck with no advantage rolls a single d20', () => {
  const sequence = [14];
  let i = 0;
  const result = rollCheck(3, 'none', () => sequence[i++]);
  assert.deepEqual(result, {results: [14], kept: 14, total: 17});
});

test('rollCheck with advantage keeps the higher of two d20s', () => {
  const sequence = [5, 18];
  let i = 0;
  const result = rollCheck(2, 'adv', () => sequence[i++]);
  assert.deepEqual(result, {results: [5, 18], kept: 18, total: 20});
});

test('rollCheck with disadvantage keeps the lower of two d20s', () => {
  const sequence = [5, 18];
  let i = 0;
  const result = rollCheck(2, 'disadv', () => sequence[i++]);
  assert.deepEqual(result, {results: [5, 18], kept: 5, total: 7});
});

test('rollCheck with advantage still works when both dice tie', () => {
  const sequence = [11, 11];
  let i = 0;
  const result = rollCheck(0, 'adv', () => sequence[i++]);
  assert.deepEqual(result, {results: [11, 11], kept: 11, total: 11});
});

test('rollCheck applies a negative modifier the same way as a positive one', () => {
  const result = rollCheck(-4, 'none', () => 10);
  assert.equal(result.total, 6);
});

test('hitChance: a plain d20 needs total >= AC, nat 1 always misses, nat 20 always hits', () => {
  assert.equal(hitChance(0, 11, 'none'), 0.5, 'need an 11+ on a flat +0 against AC 11');
  assert.equal(hitChance(10, 5, 'none'), 0.95, 'always hits except a natural 1');
  assert.equal(hitChance(-10, 25, 'none'), 0.05, 'only a natural 20 lands');
  assert.equal(hitChance(5, 5, 'none'), 0.95, 'hits on anything but a natural 1, even though 1+5 would otherwise beat AC 5');
  assert.equal(hitChance(-20, 1, 'none'), 0.05, 'nat 1 misses even against AC 1 with a huge penalty');
});

test('hitChance with advantage and disadvantage matches an exhaustive count over both dice', () => {
  // +2 vs AC 15 hits on a natural 13+ (8 of 20 faces), so P = 0.4.
  const single = hitChance(2, 15, 'none');
  assert.equal(single, 0.4);
  // Advantage: miss only when BOTH dice miss — (1 - 0.4)^2 = 0.36 miss, 0.64 hit.
  assert.ok(Math.abs(hitChance(2, 15, 'adv') - 0.64) < 1e-9);
  // Disadvantage: hit only when BOTH dice hit — 0.4^2 = 0.16.
  assert.ok(Math.abs(hitChance(2, 15, 'disadv') - 0.16) < 1e-9);
  assert.ok(hitChance(2, 15, 'adv') > single && single > hitChance(2, 15, 'disadv'));
});
