export function bardicDie(level: number | null | undefined): number {
  const at = level ?? 1;
  return at >= 15 ? 12 : at >= 10 ? 10 : at >= 5 ? 8 : 6;
}

export function songOfRestDie(bardLevel: number): number {
  return bardLevel >= 17 ? 12 : bardLevel >= 13 ? 10 : bardLevel >= 9 ? 8 : bardLevel >= 2 ? 6 : 0;
}

export const COUNTERCHARM_FEET = 30;
