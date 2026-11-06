import type { SpellTemplate } from './types.ts';
import { averageFormula } from './formulas.ts';

const DMG_TABLE: ReadonlyArray<readonly [number, number]> = [
  [5.5, 3.5], [11, 7], [16.5, 14], [27.5, 21], [33, 24.5], [44, 28], [55, 38.5], [60.5, 42], [66, 45.5], [82.5, 49],
];

export type StrengthBand = 'none' | 'weak' | 'normal' | 'strong' | 'very-strong';
export const STRENGTH_LABELS: Readonly<Record<StrengthBand, string>> = {
  none: 'урона нет — шкалы нет', weak: 'слабее обычного', normal: 'обычно для круга', strong: 'сильнее обычного', 'very-strong': 'намного сильнее обычного',
};

export function templateStrength(t: SpellTemplate): { damage: number; expected: number; ratio: number; band: StrengthBand; multi: boolean } {
  const level = t.passport.level;
  const multi = t.targeting.kind === 'area' || t.targeting.kind === 'chain' || (t.targeting.kind === 'creatures' && t.targeting.count > 1);
  let damage = 0;
  const sample = { круг: Math.max(1, level), slot: Math.max(1, level) };
  const top = [...t.actions, ...(t.options.modes[0]?.actions ?? [])];
  for (const action of top) {
    if (action.when !== 'cast') continue;
    const hits = action.check.kind === 'attack' ? Math.max(1, action.check.attackCount) : 1;
    const chain = t.targeting.kind === 'chain' ? 1 + t.targeting.hops : 1;
    const outcome = action.check.kind === 'attack' ? 'hit' : action.check.kind === 'save' || action.check.kind === 'ability' ? 'fail' : action.check.kind === 'none' ? 'always' : 'met';
    for (const effect of action.outcomes[outcome] ?? []) {
      if (effect.kind === 'damage') damage += (averageFormula(String(effect.values.formula ?? ''), sample) ?? 0) * hits * (multi && t.targeting.kind !== 'chain' ? 1 : chain);
      if (effect.kind === 'zone') {
        for (const inner of effect.actions) {
          const innerOutcome = inner.check.kind === 'save' ? 'fail' : inner.check.kind === 'attack' ? 'hit' : 'always';
          for (const nested of inner.outcomes[innerOutcome] ?? []) if (nested.kind === 'damage') damage += averageFormula(String(nested.values.formula ?? ''), sample) ?? 0;
        }
      }
    }
  }
  const expected = DMG_TABLE[Math.min(9, Math.max(0, level))]![multi ? 1 : 0];
  if (damage <= 0) return { damage: 0, expected, ratio: 0, band: 'none', multi };
  const ratio = damage / expected;
  const band: StrengthBand = ratio < 0.75 ? 'weak' : ratio <= 1.25 ? 'normal' : ratio <= 1.75 ? 'strong' : 'very-strong';
  return { damage: Math.round(damage * 10) / 10, expected, ratio: Math.round(ratio * 100) / 100, band, multi };
}
