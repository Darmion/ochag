export function discipleOfLifeBonus(slotLevel: number): number {
  return slotLevel >= 1 ? 2 + slotLevel : 0;
}

export function preserveLifeProblem(clericLevel: number, heals: Array<{ name: string; amount: number; current: number; max: number }>): string | null {
  const pool = 5 * Math.max(1, clericLevel);
  const sum = heals.reduce((total, entry) => total + entry.amount, 0);
  if (!heals.length || sum <= 0) return 'кому сколько — укажите';
  if (sum > pool) return `всего ${sum} — больше запаса ${pool}`;
  for (const entry of heals) {
    const room = Math.max(0, Math.floor(entry.max / 2) - entry.current);
    if (entry.amount > room) return room ? `«${entry.name}» — не больше ${room} (до половины максимума)` : `у «${entry.name}» уже половина хитов или больше`;
  }
  return null;
}

export const DIVINE_INTERVENTION_COOLDOWN = 7 * 24 * 60;

export function divineInterventionBlock(
  last: { at: number; success: boolean } | null, now: number, longRestAt: number | null,
): string | null {
  if (!last) return null;
  if (last.success) {
    const left = last.at + DIVINE_INTERVENTION_COOLDOWN - now;
    return left > 0 ? `божество уже вмешалось — снова через ${Math.ceil(left / (24 * 60))} дн.` : null;
  }
  return longRestAt !== null && longRestAt > last.at ? null : 'не услышано — снова после долгого отдыха';
}

export function divineStrikeDice(clericLevel: number): number {
  return clericLevel >= 14 ? 2 : clericLevel >= 8 ? 1 : 0;
}

export function destroyUndeadCr(clericLevel: number | null | undefined): number | null {
  const at = clericLevel ?? 1;
  return at >= 17 ? 4 : at >= 14 ? 3 : at >= 11 ? 2 : at >= 8 ? 1 : at >= 5 ? 0.5 : null;
}
