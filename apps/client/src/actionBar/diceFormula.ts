export const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100];

export type TrayAdvantage = 'none' | 'adv' | 'disadv';

export function singleD20(counts: Record<number, number>) {
  return counts[20] === 1 && QUICK_DICE.every(sides => sides === 20 || !counts[sides]);
}

export function trayFormula(counts: Record<number, number>, modifier: number, advantage: TrayAdvantage) {
  const single = singleD20(counts);
  const parts: string[] = [];
  for (const sides of QUICK_DICE) {
    const count = counts[sides] ?? 0;
    if (!count) continue;
    parts.push(sides === 20 && single && advantage !== 'none' ? `2d20k${advantage === 'adv' ? 'h' : 'l'}1` : `${count}d${sides}`);
  }
  if (!parts.length) return modifier ? String(modifier) : '';
  return parts.join('+') + (modifier > 0 ? `+${modifier}` : modifier < 0 ? String(modifier) : '');
}
