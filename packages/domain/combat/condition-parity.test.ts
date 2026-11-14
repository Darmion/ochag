import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONDITION_CODES, CONDITION_LABELS, conditionState, d20Ruling, effectiveSpeed, incapacitatedReason, isIncapacitated, reactionBlocked,
  type Advantage, type ConditionState, type RollContext, type RollRuling, type SpeedRuling,
} from './conditions.ts';

// The engine before condition rules, frozen: the SRD rules must give exactly its rulings.
const has = (state: ConditionState, code: string) => state.codes.has(code);

function legacy_isIncapacitated(state: ConditionState): boolean {
  return ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious', 'dead'].some(code => has(state, code)) || state.exhaustion >= 6;
}

function legacy_incapacitatedReason(state: ConditionState): string | null {
  if (has(state, 'dead') || state.exhaustion >= 6) return 'мёртв';
  for (const code of ['unconscious', 'paralyzed', 'petrified', 'stunned', 'incapacitated']) {
    if (has(state, code)) return CONDITION_LABELS[code]!;
  }
  return null;
}

function legacy_reactionBlocked(state: ConditionState): string | null {
  const unable = legacy_incapacitatedReason(state);
  if (unable) return unable;
  if (has(state, 'no_reactions')) return 'без реакций до начала своего хода';
  if (has(state, 'turned')) return 'изгнан';
  return null;
}

function legacy_effectiveSpeed(baseFeet: number, state: ConditionState): SpeedRuling {
  const stopped = ['grappled', 'restrained', 'paralyzed', 'petrified', 'stunned', 'unconscious', 'dead'].filter(code => has(state, code));
  if (stopped.length) return { feet: 0, reasons: stopped.map(code => `скорость 0: ${CONDITION_LABELS[code]}`), crawling: false };
  if (state.exhaustion >= 5) return { feet: 0, reasons: ['скорость 0: истощение 5'], crawling: false };

  const reasons: string[] = [];
  let feet = baseFeet;
  if (state.exhaustion >= 2) {
    feet = Math.floor(feet / 2);
    reasons.push(`скорость вдвое меньше: истощение ${state.exhaustion}`);
  }
  const crawling = has(state, 'prone');
  if (crawling) reasons.push('ползком: каждый фут стоит два');
  return { feet, reasons, crawling };
}

function legacy_d20Ruling(context: RollContext): RollRuling {
  const { own } = context;
  const advantages: string[] = [];
  const disadvantages: string[] = [];
  const notes: string[] = [];
  let autoFail = false;
  let autoCritOnHit = false;
  const autoFailReasons: string[] = [];

  if (context.requested === 'adv') advantages.push('выбрано преимущество');
  if (context.requested === 'disadv') disadvantages.push('выбрана помеха');
  if (context.inspiration) advantages.push('вдохновение');
  for (const reason of context.extraDisadvantages ?? []) disadvantages.push(reason);
  for (const reason of context.extraAdvantages ?? []) advantages.push(reason);

  if (context.kind === 'attack') {
    for (const code of ['blinded', 'frightened', 'poisoned', 'prone', 'restrained']) {
      if (code === 'blinded' && context.ignoreUnseen) continue;
      if (has(own, code)) disadvantages.push(CONDITION_LABELS[code]!);
    }
    if (own.exhaustion >= 3) disadvantages.push(`истощение ${own.exhaustion}`);
    if (has(own, 'invisible') && !context.unseenNoAdvantage) advantages.push('невидим');
    if (has(own, 'frightened')) notes.push('Испуган: помеха, пока источник страха в поле зрения.');

    const target = context.target;
    if (target && dodges(target)) disadvantages.push('цель уклоняется');
    if (target) {
      for (const code of ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious']) {
        if (has(target, code)) advantages.push(`цель ${CONDITION_LABELS[code]}`);
      }
      if (has(target, 'invisible') && !context.ignoreUnseen) disadvantages.push('цель невидима');
      if (has(target, 'prone')) {
        if (context.targetWithin5ft === false) disadvantages.push('цель лежит ничком, вы дальше 5 фут.');
        else advantages.push('цель лежит ничком, вы в 5 фут.');
      }
      if ((has(target, 'paralyzed') || has(target, 'unconscious')) && context.targetWithin5ft !== false) autoCritOnHit = true;
    }
  } else if (context.kind === 'save') {
    if (context.ability === 'strength' || context.ability === 'dexterity') {
      for (const code of ['paralyzed', 'petrified', 'stunned', 'unconscious']) {
        if (has(own, code)) {
          autoFail = true;
          autoFailReasons.push(`автопровал: ${CONDITION_LABELS[code]}`);
        }
      }
    }
    if (context.ability === 'dexterity' && has(own, 'restrained')) disadvantages.push('опутан');
    if (context.ability === 'dexterity' && dodges(own)) advantages.push('уклонение');
    if (context.ability === 'dexterity' && has(own, 'hasted')) advantages.push('ускорение');
    if (context.ability === 'wisdom' && has(own, 'beacon_of_hope')) advantages.push('маяк надежды');
    if (context.ability === 'strength' && has(own, 'raging')) advantages.push('ярость');
    if (own.exhaustion >= 3) disadvantages.push(`истощение ${own.exhaustion}`);
  } else {
    if (context.ability === 'strength' && has(own, 'raging')) advantages.push('ярость');
    for (const code of ['frightened', 'poisoned']) {
      if (has(own, code)) disadvantages.push(CONDITION_LABELS[code]!);
    }
    if (own.exhaustion >= 1) disadvantages.push(`истощение ${own.exhaustion}`);
    if (context.sense === 'sight' && (has(own, 'blinded') || context.sightBlocked)) {
      autoFail = true;
      autoFailReasons.push(`автопровал: ${has(own, 'blinded') ? 'ослеплён' : context.sightBlocked} — проверка зрением`);
    } else if (!context.sense && has(own, 'blinded')) notes.push('Ослеплён: проверка, требующая зрения, проваливается автоматически.');
    if (context.sense === 'hearing' && has(own, 'deafened')) {
      autoFail = true;
      autoFailReasons.push('автопровал: оглох — проверка слухом');
    } else if (!context.sense && has(own, 'deafened')) notes.push('Оглох: проверка, требующая слуха, проваливается автоматически.');
  }

  const blocked = context.kind === 'attack' && context.noAdvantage && advantages.length ? context.noAdvantage : null;
  if (blocked) advantages.length = 0;

  const advantage: Advantage =
    advantages.length && disadvantages.length ? 'none'
    : advantages.length ? 'adv'
    : disadvantages.length ? 'disadv'
    : 'none';

  const reasons = [
    ...autoFailReasons,
    ...advantages.map(reason => `преимущество: ${reason}`),
    ...disadvantages.map(reason => `помеха: ${reason}`),
    ...(blocked ? [`без преимущества: ${blocked}`] : []),
  ];
  if (advantages.length && disadvantages.length) reasons.push('преимущество и помеха гасят друг друга');

  return { advantage, autoFail, autoCritOnHit, reasons, notes };
}

function dodges(state: ConditionState) {
  return has(state, 'dodging') && !legacy_isIncapacitated(state) && !has(state, 'grappled') && !has(state, 'restrained') && state.exhaustion < 5;
}


const states: string[][] = [[]];
for (const a of CONDITION_CODES) {
  states.push([a]);
  for (const b of CONDITION_CODES) if (a < b) states.push([a, b]);
}
const sorted = (ruling: RollRuling) => ({ ...ruling, reasons: [...ruling.reasons].sort(), notes: [...ruling.notes].map(note => note.replace('источник страха', 'источник')).sort() });

test('the SRD condition rules rule every d20 roll, speed and action as the old engine did', () => {
  let compared = 0;
  const contexts: Array<Omit<RollContext, 'own' | 'target'>> = [];
  for (const kind of ['attack', 'save', 'ability', 'skill'] as const) {
    for (const ability of ['strength', 'dexterity', 'wisdom'] as const) {
      for (const sense of [null, 'sight', 'hearing'] as const) {
        for (const near of [null, true, false]) {
          for (const flags of [{}, { ignoreUnseen: true }, { unseenNoAdvantage: true }, { sightBlocked: 'темнота' }]) {
            contexts.push({ kind, ability, sense, targetWithin5ft: near, ...flags });
          }
        }
      }
    }
  }
  for (const own of states) {
    const ownState: ConditionState = conditionState([...own, ...(own.length === 1 ? ['exhaustion_3'] : [])]);
    assert.equal(isIncapacitated(ownState), legacy_isIncapacitated(ownState), own.join('+'));
    assert.equal(incapacitatedReason(ownState), legacy_incapacitatedReason(ownState), own.join('+'));
    assert.equal(reactionBlocked(ownState), legacy_reactionBlocked(ownState), own.join('+'));
    const speed = (ruling: SpeedRuling) => ({ ...ruling, reasons: [...ruling.reasons].sort() });
    assert.deepEqual(speed(effectiveSpeed(30, ownState)), speed(legacy_effectiveSpeed(30, ownState)), own.join('+'));
    for (const target of [[], ['prone'], ['invisible'], ['paralyzed'], ['blinded', 'restrained'], ['unconscious', 'dodging']]) {
      for (const context of contexts) {
        if (context.kind !== 'attack' && target.length) continue;
        const full = { ...context, own: ownState, target: target.length ? conditionState(target) : null } as RollContext;
        assert.deepEqual(sorted(d20Ruling(full)), sorted(legacy_d20Ruling(full)), `${own.join('+')} → ${target.join('+')} ${JSON.stringify(context)}`);
        compared += 1;
      }
    }
  }
  assert.ok(compared > 50000, `${compared} rulings compared`);
  assert.equal(CONDITION_LABELS.frightened, 'испуган');
});
