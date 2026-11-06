import { FORMULA_TOKENS, type FormulaContext, type FormulaToken } from './formula.ts';

export type DiceTerm = {
  kind: 'dice';
  sign: 1 | -1;
  count: number;
  sides: number;
  keep?: { mode: 'h' | 'l'; count: number };
  explode?: boolean;
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
const MAX_EXPLOSIONS = 100;

const TERM = /([+-]?)(?:(\d{0,3})d(\d{1,4})(!)?(?:k([hl])(\d{1,2}))?|(\d{1,4})|@([a-z]+))/giy;

function isToken(value: string): value is FormulaToken {
  return (FORMULA_TOKENS as readonly string[]).includes(value);
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

    const [, signText, countText, sidesText, explodeMark, keepMode, keepText, constantText, tokenText] = match;
    if (terms.length > 0 && !signText) return { ok: false, reason: 'invalid-formula' };
    const sign: 1 | -1 = signText === '-' ? -1 : 1;

    if (sidesText !== undefined) {
      const count = countText ? Number(countText) : 1;
      const sides = Number(sidesText);
      if (count > 50) return { ok: false, reason: 'too-many-dice' };
      if (count < 1 || sides < 1 || sides > 1000) return { ok: false, reason: 'invalid-formula' };

      const term: DiceTerm = { kind: 'dice', sign, count, sides };

      if (explodeMark) {
        if (sides < 2 || keepMode) return { ok: false, reason: 'invalid-formula' };
        term.explode = true;
      }

      if (keepMode) {
        const keep = Number(keepText);
        if (keep < 1 || keep > count) return { ok: false, reason: 'invalid-formula' };
        term.keep = { mode: keepMode as 'h' | 'l', count: keep };
      }

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

export type DiceGroupResult = { notation: string; sign: 1 | -1; rolls: number[]; kept: number[] };

export type ExpressionRoll = {
  ok: true;
  groups: DiceGroupResult[];
  modifier: number;
  total: number;
  dice: number[];
};

export function diceNotation(term: DiceTerm) {
  return `${term.count}d${term.sides}${term.explode ? '!' : ''}${term.keep ? `k${term.keep.mode}${term.keep.count}` : ''}`;
}

function rollGroup(term: DiceTerm, rollDie: (sides: number) => number, budget: { explosions: number }) {
  const rolls: number[] = [];

  for (let die = 0; die < term.count; die += 1) {
    let value = rollDie(term.sides);
    rolls.push(value);

    for (let chain = 0; term.explode && value === term.sides && chain < MAX_EXPLOSION_CHAIN && budget.explosions > 0; chain += 1) {
      budget.explosions -= 1;
      value = rollDie(term.sides);
      rolls.push(value);
    }
  }

  return rolls;
}

function keptDice(rolls: number[], keep: DiceTerm['keep']) {
  if (!keep) return rolls;
  const sorted = [...rolls].sort((a, b) => (keep.mode === 'h' ? b - a : a - b));
  return sorted.slice(0, keep.count);
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
      const rolls = rollGroup(term, rollDie, budget);
      const kept = keptDice(rolls, term.keep);
      groups.push({ notation: diceNotation(term), sign: term.sign, rolls, kept });
      total += term.sign * kept.reduce((sum, value) => sum + value, 0);
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
    const rolls = rollGroup(term, rollDie, budget);
    const kept = keptDice(rolls, term.keep);
    extra.push({ notation: diceNotation(term), sign: term.sign, rolls, kept });
    total += term.sign * kept.reduce((sum, value) => sum + value, 0);
  }

  return { groups: extra, total, dice: extra.flatMap(group => group.rolls) };
}
