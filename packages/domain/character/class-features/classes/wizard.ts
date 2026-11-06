export function spellPicks(sheetExtra: unknown): { mastery: string[]; signature: string[] } {
  const picks = (sheetExtra as any)?.spellPicks;
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 2) : []);
  return { mastery: list(picks?.mastery), signature: list(picks?.signature) };
}

export function arcaneRecoveryProblem(wizardLevel: number, levels: number[]): string | null {
  const budget = Math.ceil(Math.max(1, wizardLevel) / 2);
  if (!levels.length) return 'выберите ячейки';
  if (levels.some(level => level > 5)) return 'ячейки 6-го уровня и выше так не вернуть';
  const sum = levels.reduce((total, level) => total + level, 0);
  if (sum > budget) return `сумма уровней ${sum} — больше ${budget} (половина уровня волшебника)`;
  return null;
}

export const OVERCHANNEL_MAX_LEVEL = 5;

export function overchannelSelfDice(usesBefore: number, spellLevel: number): number {
  return usesBefore <= 0 ? 0 : (usesBefore + 1) * Math.max(1, spellLevel);
}
