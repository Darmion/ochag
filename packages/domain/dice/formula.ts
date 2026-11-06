import { parseFormula, type ParsedFormula } from './dice.ts';

export const FORMULA_TOKENS = ['str', 'dex', 'con', 'int', 'wis', 'cha', 'prof'] as const;
export type FormulaToken = typeof FORMULA_TOKENS[number];

function isFormulaToken(value: string): value is FormulaToken {
  return (FORMULA_TOKENS as readonly string[]).includes(value);
}

export type FormulaContext = Partial<Record<FormulaToken, number>>;

export type TermsResolution =
  | { ok: true; modifier: number }
  | { ok: false; reason: 'invalid-formula' }
  | { ok: false; reason: 'unknown-token'; token: string }
  | { ok: false; reason: 'missing-value'; token: FormulaToken };

export type FormulaResolution =
  | { ok: true; formula: string; parsed: ParsedFormula }
  | { ok: false; reason: 'invalid-formula' }
  | { ok: false; reason: 'unknown-token'; token: string }
  | { ok: false; reason: 'missing-value'; token: FormulaToken };

const DICE_WITH_TERMS_PATTERN = /^([1-9][0-9]?)d([1-9][0-9]{0,2})((?:[+-](?:[0-9]{1,3}|@[a-z]+))*)$/i;
const TERMS_ONLY_PATTERN = /^(?:[+-](?:[0-9]{1,3}|@[a-z]+))*$/i;
const TERM_PATTERN = /([+-])(?:([0-9]{1,3})|@([a-z]+))/gi;

function formatModifier(modifier: number): string {
  if (modifier === 0) return '';
  return modifier > 0 ? `+${modifier}` : `${modifier}`;
}

function sumTerms(termsPart: string, context: FormulaContext): TermsResolution {
  let modifier = 0;

  for (const term of termsPart.matchAll(TERM_PATTERN)) {
    const [, sign, literal, rawToken] = term;
    let value: number;

    if (literal !== undefined) {
      value = Number(literal);
    } else {
      const token = rawToken!.toLowerCase();
      if (!isFormulaToken(token)) return { ok: false, reason: 'unknown-token', token: rawToken! };

      const contextValue = context[token];
      if (contextValue === undefined) return { ok: false, reason: 'missing-value', token };

      value = contextValue;
    }

    modifier += sign === '-' ? -value : value;
  }

  return { ok: true, modifier };
}

export function resolveModifier(terms: string, context: FormulaContext): TermsResolution {
  const trimmed = terms.trim();
  if (!TERMS_ONLY_PATTERN.test(trimmed)) return { ok: false, reason: 'invalid-formula' };

  return sumTerms(trimmed, context);
}

export function isFormulaShapeValid(formula: string): boolean {
  const match = DICE_WITH_TERMS_PATTERN.exec(formula.trim());
  if (!match) return false;

  for (const term of match[3]!.matchAll(TERM_PATTERN)) {
    const token = term[3];
    if (token !== undefined && !isFormulaToken(token.toLowerCase())) return false;
  }

  return true;
}

export function resolveFormula(formula: string, context: FormulaContext): FormulaResolution {
  const match = DICE_WITH_TERMS_PATTERN.exec(formula.trim());
  if (!match) return { ok: false, reason: 'invalid-formula' };

  const [, count, sides, termsPart] = match;
  const summed = sumTerms(termsPart!, context);
  if (!summed.ok) return summed;

  const resolvedFormula = `${count}d${sides}${formatModifier(summed.modifier)}`;
  const parsed = parseFormula(resolvedFormula);
  if (!parsed) return { ok: false, reason: 'invalid-formula' };

  return { ok: true, formula: resolvedFormula, parsed };
}
