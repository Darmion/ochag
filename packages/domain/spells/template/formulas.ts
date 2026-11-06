export const FORMULA_VARIABLES = ['mod', 'prof', 'уровень', 'level', 'круг', 'slot', 'str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

const TERM = /([+-]?)\s*(?:(\d{0,3})[кkdд](\d{1,3})|(\d{1,4})|@([a-zа-яё]+))/giy;

export type FormulaTerm = { sign: 1 | -1; dice: number; sides: number; value: number; variable: string | null };

export function parseTemplateFormula(text: string): FormulaTerm[] | null {
  const source = String(text ?? '').replace(/\s+/g, '').toLowerCase();
  if (!source) return null;
  TERM.lastIndex = 0;
  const terms: FormulaTerm[] = [];
  let position = 0;
  while (position < source.length) {
    TERM.lastIndex = position;
    const match = TERM.exec(source);
    if (!match || match.index !== position || match[0].length === 0) return null;
    if (terms.length && !match[1]) return null;
    const sign = match[1] === '-' ? -1 : 1;
    if (match[3]) terms.push({ sign, dice: Number(match[2] || 1), sides: Number(match[3]), value: 0, variable: null });
    else if (match[4]) terms.push({ sign, dice: 0, sides: 0, value: Number(match[4]), variable: null });
    else {
      const variable = match[5]!;
      if (!(FORMULA_VARIABLES as readonly string[]).includes(variable)) return null;
      terms.push({ sign, dice: 0, sides: 0, value: 0, variable });
    }
    position += match[0].length;
  }
  if (!terms.length || terms.some(term => term.dice > 100 || term.sides > 100 || (term.dice && term.sides < 2))) return null;
  return terms;
}

export function averageFormula(text: string, sample: Partial<Record<string, number>> = {}): number | null {
  const terms = parseTemplateFormula(text);
  if (!terms) return null;
  const vars: Record<string, number> = { mod: 3, prof: 2, уровень: 5, level: 5, круг: 1, slot: 1, str: 0, dex: 2, con: 1, int: 0, wis: 0, cha: 0, ...sample };
  return terms.reduce((sum, term) => sum + term.sign * (term.dice ? term.dice * (term.sides + 1) / 2 : term.variable ? vars[term.variable] ?? 0 : term.value), 0);
}
