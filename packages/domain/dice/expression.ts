import { FORMULA_TOKENS, type FormulaContext, type FormulaToken } from './formula.ts';

export type Compare = '=' | '<' | '>' | '<=' | '>=';
export type DieCondition = { compare: Compare; value: number };

export type DiceTerm = {
  kind: 'dice';
  sign: 1 | -1;
  count: number;
  sides: number;
  keep?: { mode: 'h' | 'l'; count: number };
  explode?: boolean;
  // A die that meets the condition is rolled again: once, or until it no longer does.
  reroll?: DieCondition & { once: boolean };
  min?: number;
  max?: number;
  // A pool: the group counts dice that meet the success condition, minus those that meet the failure one.
  successes?: DieCondition;
  failures?: DieCondition;
};
export type ConstantTerm = { kind: 'constant'; sign: 1 | -1; value: number };
export type TokenTerm = { kind: 'token'; sign: 1 | -1; token: FormulaToken };
export type ExpressionTerm = DiceTerm | ConstantTerm | TokenTerm;

export type Expression = { terms: ExpressionTerm[] };

export type ExpressionError =
  | { ok: false; reason: 'invalid-formula' }
  | { ok: false; reason: 'too-many-dice' }
  | { ok: false; reason: 'unknown-token'; token: string }
  | { ok: false; reason: 'missing-value'; token: FormulaToken };

export const MAX_FORMULA_LENGTH = 100;
const MAX_TERMS = 20;
const MAX_TOTAL_DICE = 100;
const MAX_CONSTANT = 1000;
export const MAX_EXPLOSION_CHAIN = 10;
export const MAX_REROLL_CHAIN = 10;
const MAX_EXPLOSIONS = 100;

const COMPARE = '(?:<=|>=|<|>|=)?';
const COMPARE_CAPTURE = '(<=|>=|<|>|=)?';
const MODIFIER = String.raw`!|k[hl]\d{1,2}|r[or]?${COMPARE}\d{1,4}|min\d{1,4}|max\d{1,4}|c[sf]${COMPARE}\d{1,4}`;
const TERM = new RegExp(String.raw`([+-]?)(?:(\d{0,3})d(\d{1,4})((?:${MODIFIER})*)|(\d{1,4})|@([a-z]+))`, 'giy');
const MODIFIERS = new RegExp(String.raw`(!)|k([hl])(\d{1,2})|r([or]?)${COMPARE_CAPTURE}(\d{1,4})|min(\d{1,4})|max(\d{1,4})|c([sf])${COMPARE_CAPTURE}(\d{1,4})`, 'gy');

function isToken(value: string): value is FormulaToken {
  return (FORMULA_TOKENS as readonly string[]).includes(value);
}

export function meets(value: number, condition: DieCondition): boolean {
  switch (condition.compare) {
    case '<': return value < condition.value;
    case '>': return value > condition.value;
    case '<=': return value <= condition.value;
    case '>=': return value >= condition.value;
    default: return value === condition.value;
  }
}

const condition = (compare: string | undefined, value: string): DieCondition => ({ compare: (compare || '=') as Compare, value: Number(value) });

function applyModifiers(term: DiceTerm, text: string): boolean {
  MODIFIERS.lastIndex = 0;
  const seen = new Set<string>();
  while (MODIFIERS.lastIndex < text.length) {
    const start = MODIFIERS.lastIndex;
    const match = MODIFIERS.exec(text);
    if (!match || match.index !== start) return false;
    const [, bang, keepMode, keepCount, rerollMode, rerollCompare, rerollValue, minValue, maxValue, countMode, countCompare, countValue] = match;
    const name = bang ? '!' : keepMode ? 'k' : rerollValue !== undefined ? 'r' : minValue !== undefined ? 'min' : maxValue !== undefined ? 'max' : `c${countMode}`;
    if (seen.has(name)) return false;
    seen.add(name);
    if (bang) term.explode = true;
    else if (keepMode) term.keep = { mode: keepMode as 'h' | 'l', count: Number(keepCount) };
    else if (rerollValue !== undefined) term.reroll = { ...condition(rerollCompare, rerollValue), once: rerollMode !== 'r' };
    else if (minValue !== undefined) term.min = Number(minValue);
    else if (maxValue !== undefined) term.max = Number(maxValue);
    else if (countMode === 's') term.successes = condition(countCompare, countValue!);
    else term.failures = condition(countCompare, countValue!);
  }
  return true;
}

function sensible(term: DiceTerm): boolean {
  const faces = Array.from({ length: term.sides }, (_, index) => index + 1);
  if (term.explode && (term.sides < 2 || term.keep)) return false;
  if (term.keep && (term.keep.count < 1 || term.keep.count > term.count || term.successes)) return false;
  if (term.reroll && faces.every(face => meets(face, term.reroll!))) return false;
  if (term.min !== undefined && (term.min < 1 || term.min > term.sides)) return false;
  if (term.max !== undefined && (term.max < 1 || term.max > term.sides || term.max < (term.min ?? 1))) return false;
  if (term.failures && !term.successes) return false;
  return true;
}

export function parseExpression(formula: string): { ok: true; expression: Expression } | ExpressionError {
  const text = formula.trim().toLowerCase();
  if (!text || text.length > MAX_FORMULA_LENGTH) return { ok: false, reason: 'invalid-formula' };

  const terms: ExpressionTerm[] = [];
  let totalDice = 0;
  TERM.lastIndex = 0;

  while (TERM.lastIndex < text.length) {
    const start = TERM.lastIndex;
    const match = TERM.exec(text);
    if (!match || match.index !== start) return { ok: false, reason: 'invalid-formula' };

    const [, signText, countText, sidesText, modifierText, constantText, tokenText] = match;
    if (terms.length > 0 && !signText) return { ok: false, reason: 'invalid-formula' };
    const sign: 1 | -1 = signText === '-' ? -1 : 1;

    if (sidesText !== undefined) {
      const count = countText ? Number(countText) : 1;
      const sides = Number(sidesText);
      if (count > 50) return { ok: false, reason: 'too-many-dice' };
      if (count < 1 || sides < 1 || sides > 1000) return { ok: false, reason: 'invalid-formula' };

      const term: DiceTerm = { kind: 'dice', sign, count, sides };
      if (modifierText && !applyModifiers(term, modifierText)) return { ok: false, reason: 'invalid-formula' };
      if (!sensible(term)) return { ok: false, reason: 'invalid-formula' };

      totalDice += count;
      terms.push(term);
    } else if (constantText !== undefined) {
      const value = Number(constantText);
      if (value > MAX_CONSTANT) return { ok: false, reason: 'invalid-formula' };
      terms.push({ kind: 'constant', sign, value });
    } else {
      if (!isToken(tokenText!)) return { ok: false, reason: 'unknown-token', token: tokenText! };
      terms.push({ kind: 'token', sign, token: tokenText });
    }

    if (terms.length > MAX_TERMS) return { ok: false, reason: 'invalid-formula' };
  }

  if (totalDice > MAX_TOTAL_DICE) return { ok: false, reason: 'too-many-dice' };
  if (!terms.some(term => term.kind === 'dice')) return { ok: false, reason: 'invalid-formula' };

  return { ok: true, expression: { terms } };
}

export function hasTokens(expression: Expression) {
  return expression.terms.some(term => term.kind === 'token');
}

export type DiceGroupResult = {
  notation: string; sign: 1 | -1; rolls: number[]; kept: number[];
  // Values that were rolled again; and, for a pool, how many dice met the success and the failure conditions.
  rerolled?: number[]; successes?: number; failures?: number;
};

export type ExpressionRoll = {
  ok: true;
  groups: DiceGroupResult[];
  modifier: number;
  total: number;
  dice: number[];
};

const conditionText = (item: DieCondition, plain = true) => `${plain && item.compare === '=' ? '' : item.compare}${item.value}`;

export function diceNotation(term: DiceTerm) {
  return `${term.count}d${term.sides}${term.explode ? '!' : ''}${term.keep ? `k${term.keep.mode}${term.keep.count}` : ''}`
    + `${term.reroll ? `${term.reroll.once ? 'r' : 'rr'}${conditionText(term.reroll)}` : ''}`
    + `${term.min !== undefined ? `min${term.min}` : ''}${term.max !== undefined ? `max${term.max}` : ''}`
    + `${term.successes ? `cs${conditionText(term.successes, false)}` : ''}${term.failures ? `cf${conditionText(term.failures, false)}` : ''}`;
}

// One die with its rerolls and its face limits; the values it replaced go to `rerolled`.
export function rollOneDie(term: Pick<DiceTerm, 'sides' | 'reroll' | 'min' | 'max'>, rollDie: (sides: number) => number, rerolled: number[]): number {
  let value = rollDie(term.sides);
  if (term.reroll) {
    const rounds = term.reroll.once ? 1 : MAX_REROLL_CHAIN;
    for (let round = 0; round < rounds && meets(value, term.reroll); round += 1) {
      rerolled.push(value);
      value = rollDie(term.sides);
    }
  }
  return Math.min(term.max ?? term.sides, Math.max(term.min ?? 1, value));
}

// The same reroll on dice already thrown: a feature that lets some dice of a roll be rolled again (`ro<3`).
export function rerollDice(dice: number[], sides: number, rule: DieCondition & { once: boolean }, rollDie: (sides: number) => number) {
  const changes: Array<[from: number, to: number]> = [];
  const next = dice.map(value => {
    if (!meets(value, rule)) return value;
    let now = rollDie(sides);
    for (let round = 1; !rule.once && round < MAX_REROLL_CHAIN && meets(now, rule); round += 1) now = rollDie(sides);
    changes.push([value, now]);
    return now;
  });
  return { dice: next, changes };
}

function rollGroup(term: DiceTerm, rollDie: (sides: number) => number, budget: { explosions: number }): DiceGroupResult {
  const rolls: number[] = [];
  const rerolled: number[] = [];

  for (let die = 0; die < term.count; die += 1) {
    let value = rollOneDie(term, rollDie, rerolled);
    rolls.push(value);

    for (let chain = 0; term.explode && value === term.sides && chain < MAX_EXPLOSION_CHAIN && budget.explosions > 0; chain += 1) {
      budget.explosions -= 1;
      value = rollOneDie(term, rollDie, rerolled);
      rolls.push(value);
    }
  }

  const kept = keptDice(rolls, term.keep);
  return {
    notation: diceNotation(term), sign: term.sign, rolls, kept,
    ...(rerolled.length ? { rerolled } : {}),
    ...(term.successes ? { successes: kept.filter(value => meets(value, term.successes!)).length } : {}),
    ...(term.failures ? { failures: kept.filter(value => meets(value, term.failures!)).length } : {}),
  };
}

function keptDice(rolls: number[], keep: DiceTerm['keep']) {
  if (!keep) return rolls;
  const sorted = [...rolls].sort((a, b) => (keep.mode === 'h' ? b - a : a - b));
  return sorted.slice(0, keep.count);
}

export function groupValue(group: DiceGroupResult): number {
  const amount = group.successes !== undefined ? group.successes - (group.failures ?? 0) : group.kept.reduce((sum, value) => sum + value, 0);
  return group.sign * amount;
}

export function rollExpression(
  expression: Expression,
  rollDie: (sides: number) => number,
  context: FormulaContext = {},
): ExpressionRoll | ExpressionError {
  const groups: DiceGroupResult[] = [];
  const budget = { explosions: MAX_EXPLOSIONS };
  let modifier = 0;
  let total = 0;

  for (const term of expression.terms) {
    if (term.kind === 'dice') {
      const group = rollGroup(term, rollDie, budget);
      groups.push(group);
      total += groupValue(group);
    } else {
      const value = term.kind === 'constant' ? term.value : context[term.token];
      if (value === undefined) return { ok: false, reason: 'missing-value', token: (term as TokenTerm).token };
      modifier += term.sign * value;
      total += term.sign * value;
    }
  }

  return { ok: true, groups, modifier, total, dice: groups.flatMap(group => group.rolls) };
}

export function rollCriticalExtra(expression: Expression, rollDie: (sides: number) => number) {
  const extra: DiceGroupResult[] = [];
  const budget = { explosions: MAX_EXPLOSIONS };
  let total = 0;

  for (const term of expression.terms) {
    if (term.kind !== 'dice') continue;
    const group = rollGroup(term, rollDie, budget);
    extra.push(group);
    total += groupValue(group);
  }

  return { groups: extra, total, dice: extra.flatMap(group => group.rolls) };
}
