import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  attackOutcome,
  castingUse,
  concentrationDc,
  conditionState,
  d20Ruling,
  damageAtZero,
  deathSaveOutcome,
  effectiveSpeed,
  incapacitatedReason,
  isIncapacitated,
} from './conditions.ts';

const none = conditionState([]);

test('exhaustion is the highest level; other effects are plain codes', () => {
  const state = conditionState(['exhaustion_2', 'poisoned', 'exhaustion_4', 'concentration']);
  assert.equal(state.exhaustion, 4);
  assert.ok(state.codes.has('poisoned') && state.codes.has('concentration'));
  assert.ok(!state.codes.has('exhaustion_2'));
});

test('own conditions on attack rolls: poisoned, prone, restrained, blinded give disadvantage; invisible advantage', () => {
  for (const code of ['poisoned', 'prone', 'restrained', 'blinded', 'frightened']) {
    assert.equal(d20Ruling({kind: 'attack', ability: 'strength', own: conditionState([code])}).advantage, 'disadv', code);
  }
  assert.equal(d20Ruling({kind: 'attack', ability: 'strength', own: conditionState(['exhaustion_3'])}).advantage, 'disadv');
  assert.equal(d20Ruling({kind: 'attack', ability: 'strength', own: conditionState(['exhaustion_2'])}).advantage, 'none');
  const invisible = d20Ruling({kind: 'attack', ability: 'dexterity', own: conditionState(['invisible'])});
  assert.equal(invisible.advantage, 'adv');
  assert.deepEqual(invisible.reasons, ['преимущество: невидим']);
});

test('advantage and disadvantage cancel out however many there are (PHB p. 173)', () => {
  const ruling = d20Ruling({kind: 'attack', ability: 'dexterity', own: conditionState(['invisible', 'poisoned', 'prone']), requested: 'none'});
  assert.equal(ruling.advantage, 'none');
  assert.ok(ruling.reasons.includes('преимущество и помеха гасят друг друга'));
  assert.equal(d20Ruling({kind: 'skill', ability: 'wisdom', own: conditionState(['poisoned']), requested: 'adv'}).advantage, 'none');
  assert.equal(d20Ruling({kind: 'skill', ability: 'wisdom', own: none, requested: 'adv'}).advantage, 'adv');
});

test('target conditions: helpless targets grant advantage and auto-crit within 5 ft; invisible targets impose disadvantage', () => {
  for (const code of ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious']) {
    assert.equal(d20Ruling({kind: 'attack', ability: 'strength', own: none, target: conditionState([code]), targetWithin5ft: true}).advantage, 'adv', code);
  }
  assert.equal(d20Ruling({kind: 'attack', ability: 'strength', own: none, target: conditionState(['invisible'])}).advantage, 'disadv');

  const paralyzedClose = d20Ruling({kind: 'attack', ability: 'strength', own: none, target: conditionState(['paralyzed']), targetWithin5ft: true});
  assert.equal(paralyzedClose.autoCritOnHit, true);
  const paralyzedFar = d20Ruling({kind: 'attack', ability: 'dexterity', own: none, target: conditionState(['paralyzed']), targetWithin5ft: false});
  assert.equal(paralyzedFar.autoCritOnHit, false);
  assert.equal(paralyzedFar.advantage, 'adv');
  assert.equal(d20Ruling({kind: 'attack', ability: 'strength', own: none, target: conditionState(['stunned']), targetWithin5ft: true}).autoCritOnHit, false);
});

test('a prone target: advantage within 5 ft, disadvantage from farther', () => {
  assert.equal(d20Ruling({kind: 'attack', ability: 'strength', own: none, target: conditionState(['prone']), targetWithin5ft: true}).advantage, 'adv');
  assert.equal(d20Ruling({kind: 'attack', ability: 'dexterity', own: none, target: conditionState(['prone']), targetWithin5ft: false}).advantage, 'disadv');
});

test('saving throws: STR/DEX auto-fail when paralyzed, petrified, stunned or unconscious; restrained DEX disadvantage', () => {
  for (const code of ['paralyzed', 'petrified', 'stunned', 'unconscious']) {
    assert.equal(d20Ruling({kind: 'save', ability: 'dexterity', own: conditionState([code])}).autoFail, true, code);
    assert.equal(d20Ruling({kind: 'save', ability: 'strength', own: conditionState([code])}).autoFail, true, code);
    assert.equal(d20Ruling({kind: 'save', ability: 'wisdom', own: conditionState([code])}).autoFail, false, code);
  }
  assert.equal(d20Ruling({kind: 'save', ability: 'dexterity', own: conditionState(['restrained'])}).advantage, 'disadv');
  assert.equal(d20Ruling({kind: 'save', ability: 'strength', own: conditionState(['restrained'])}).advantage, 'none');
  assert.equal(d20Ruling({kind: 'save', ability: 'wisdom', own: conditionState(['exhaustion_3'])}).advantage, 'disadv');
  assert.equal(d20Ruling({kind: 'save', ability: 'wisdom', own: conditionState(['poisoned'])}).advantage, 'none', 'poisoned does not affect saves');
});

test('ability checks: poisoned, frightened and any exhaustion give disadvantage; sight/hearing checks only noted', () => {
  assert.equal(d20Ruling({kind: 'skill', ability: 'wisdom', own: conditionState(['poisoned'])}).advantage, 'disadv');
  assert.equal(d20Ruling({kind: 'ability', ability: 'strength', own: conditionState(['exhaustion_1'])}).advantage, 'disadv');
  const blind = d20Ruling({kind: 'skill', ability: 'wisdom', own: conditionState(['blinded'])});
  assert.equal(blind.advantage, 'none');
  assert.equal(blind.notes.length, 1);
});

test('speed: grappled or restrained stops, exhaustion 2 halves, exhaustion 5 stops, prone crawls', () => {
  assert.equal(effectiveSpeed(30, none).feet, 30);
  assert.equal(effectiveSpeed(30, conditionState(['grappled'])).feet, 0);
  assert.equal(effectiveSpeed(30, conditionState(['restrained'])).feet, 0);
  assert.equal(effectiveSpeed(30, conditionState(['exhaustion_2'])).feet, 15);
  assert.equal(effectiveSpeed(25, conditionState(['exhaustion_3'])).feet, 12);
  assert.equal(effectiveSpeed(30, conditionState(['exhaustion_5'])).feet, 0);
  const prone = effectiveSpeed(30, conditionState(['prone']));
  assert.equal(prone.feet, 30);
  assert.equal(prone.crawling, true);
  assert.equal(effectiveSpeed(30, conditionState(['incapacitated'])).feet, 30, 'incapacitated alone still moves');
});

test('incapacitation covers the conditions that include it', () => {
  for (const code of ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious', 'dead']) {
    assert.equal(isIncapacitated(conditionState([code])), true, code);
  }
  assert.equal(isIncapacitated(conditionState(['exhaustion_6'])), true);
  assert.equal(isIncapacitated(conditionState(['prone', 'poisoned'])), false);
  assert.equal(incapacitatedReason(conditionState(['stunned'])), 'ошеломлён');
  assert.equal(incapacitatedReason(none), null);
});

test('attack outcome: natural 20 hits and crits, natural 1 misses, otherwise against AC', () => {
  assert.deepEqual(attackOutcome(20, 5, 30, false), {hit: true, critical: true});
  assert.deepEqual(attackOutcome(1, 40, 10, true), {hit: false, critical: false});
  assert.deepEqual(attackOutcome(12, 15, 15, false), {hit: true, critical: false});
  assert.deepEqual(attackOutcome(12, 14, 15, false), {hit: false, critical: false});
  assert.deepEqual(attackOutcome(12, 16, 15, true), {hit: true, critical: true}, 'paralyzed target within 5 ft');
});

test('concentration DC is half the damage, at least 10', () => {
  assert.equal(concentrationDc(7), 10);
  assert.equal(concentrationDc(22), 11);
  assert.equal(concentrationDc(45), 22);
});

test('death saves: 10+ succeeds, 1 counts twice, 20 brings back, three of a kind decides', () => {
  assert.deepEqual(deathSaveOutcome(10, {successes: 0, failures: 0}), {successes: 1, failures: 0, regained: false, stable: false, dead: false});
  assert.deepEqual(deathSaveOutcome(9, {successes: 1, failures: 1}), {successes: 1, failures: 2, regained: false, stable: false, dead: false});
  assert.deepEqual(deathSaveOutcome(1, {successes: 0, failures: 2}), {successes: 0, failures: 3, regained: false, stable: false, dead: true});
  assert.equal(deathSaveOutcome(15, {successes: 2, failures: 2}).stable, true);
  assert.equal(deathSaveOutcome(20, {successes: 0, failures: 2}).regained, true);
});

test('damage at 0 HP: a failure, two on a crit, instant death from massive damage', () => {
  assert.deepEqual(damageAtZero({successes: 1, failures: 0}, 3, false, 12), {successes: 1, failures: 1, dead: false});
  assert.deepEqual(damageAtZero({successes: 1, failures: 1}, 3, true, 12), {successes: 1, failures: 3, dead: true});
  assert.equal(damageAtZero({successes: 0, failures: 0}, 12, false, 12).dead, true);
});

test('inspiration is advantage — and cancels against a disadvantage like any other', () => {
  const own = conditionState([]);
  assert.equal(d20Ruling({kind: 'save', ability: 'wisdom', own, inspiration: true}).advantage, 'adv');
  assert.equal(d20Ruling({kind: 'attack', ability: 'strength', own: conditionState(['poisoned']), inspiration: true}).advantage, 'none');
});

test('dodging: attacks against it at disadvantage, its DEX saves at advantage — not while incapacitated or held', () => {
  const dodging = conditionState(['dodging']);
  assert.equal(d20Ruling({kind: 'attack', ability: 'strength', own: conditionState([]), target: dodging}).advantage, 'disadv');
  assert.equal(d20Ruling({kind: 'save', ability: 'dexterity', own: dodging}).advantage, 'adv');
  assert.equal(d20Ruling({kind: 'save', ability: 'wisdom', own: dodging}).advantage, 'none');
  assert.equal(d20Ruling({kind: 'attack', ability: 'strength', own: conditionState([]), target: conditionState(['dodging', 'grappled'])}).advantage, 'none');
  assert.equal(castingUse('1 bonus action'), 'bonus');
  assert.equal(castingUse('1 реакция'), 'reaction');
  assert.equal(castingUse('1 action'), 'action');
  assert.equal(castingUse('1 minute'), 'action');
});
