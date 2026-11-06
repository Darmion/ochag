// Russian «к» (1к20) becomes «d»: the server parses only «d» (packages/domain/dice/expression.ts).
const DIE = String.raw`\d{0,2}[dк]\d{1,4}(?:!|k[hl]\d{1,2})?`;
const TERM = String.raw`(?:${DIE}|\d{1,4}|@[a-z]+)`;
const FORMULA = new RegExp(String.raw`(?<![\p{L}\p{N}@])${DIE}(?:[+-]${TERM})*(?![\p{L}\p{N}])`, 'giu');

export function normalizeFormula(text: string) {
  return text.toLowerCase().replace(/к/g, 'd');
}

export function findFormulas(text: string): string[] {
  const found: string[] = [];

  for (const match of text.matchAll(FORMULA)) {
    const formula = normalizeFormula(match[0]);
    if (formula.length <= 100 && !found.includes(formula)) found.push(formula);
  }

  return found.slice(0, 12);
}

export type RollGroup = { notation: string; sign: 1 | -1; rolls: number[]; kept: number[] };

export function describeGroups(groups: RollGroup[]) {
  return groups
    .map(group => {
      const dropped = [...group.rolls];
      for (const value of group.kept) dropped.splice(dropped.indexOf(value), 1);
      const keptText = group.kept.join(', ');
      return `${group.sign < 0 ? '−' : ''}${group.notation}: ${keptText}${dropped.length ? ` (${dropped.join(', ')})` : ''}`;
    })
    .join(' · ');
}

export function fixedFormula(amount: number) {
  return amount <= 1 ? '1d1' : `1d1+${amount - 1}`;
}
