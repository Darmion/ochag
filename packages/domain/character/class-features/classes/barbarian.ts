export function rageDamageBonus(level: number | null | undefined): number {
  const at = level ?? 1;
  return at >= 16 ? 4 : at >= 9 ? 3 : 2;
}

export function brutalCriticalDice(barbarianLevel: number): number {
  return barbarianLevel >= 17 ? 3 : barbarianLevel >= 13 ? 2 : barbarianLevel >= 9 ? 1 : 0;
}

export const RELENTLESS_RAGE_MAX = 6;

export function relentlessRageDc(usedTimes: number): number {
  return 10 + 5 * Math.max(0, usedTimes);
}

export const RAGE_ROUNDS = 10;

export function rageEndsEarly(kept: unknown, persistent: boolean): boolean {
  return kept === false && !persistent;
}

export const PRIMAL_CHAMPION_LIMIT = 24;

export function primalChampionScores<T extends { strength: number; constitution: number }>(scores: T): T {
  return {
    ...scores,
    strength: Math.min(PRIMAL_CHAMPION_LIMIT, scores.strength + 4),
    constitution: Math.min(PRIMAL_CHAMPION_LIMIT, scores.constitution + 4),
  };
}

export const INTIMIDATING_PRESENCE_FEET = 30;

export const RAGE_RESISTANCES = ['bludgeoning', 'piercing', 'slashing'];
