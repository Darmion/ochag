export function martialArtsDie(level: number | null | undefined): number {
  const at = level ?? 1;
  return at >= 17 ? 10 : at >= 11 ? 8 : at >= 5 ? 6 : 4;
}

export function unarmoredMovementFeet(monkLevel: number): number {
  return monkLevel >= 18 ? 30 : monkLevel >= 14 ? 25 : monkLevel >= 10 ? 20 : monkLevel >= 6 ? 15 : monkLevel >= 2 ? 10 : 0;
}

export function wholenessOfBodyHp(monkLevel: number): number {
  return 3 * Math.max(1, monkLevel);
}

export function kiSaveDc(proficiency: number, wisdomModifier: number) {
  return 8 + proficiency + wisdomModifier;
}

export const EMPTY_BODY_KI = 4;

export const EMPTY_BODY_ROUNDS = 10;

export function emptyBodyResists(damageType: string | null | undefined): boolean {
  return Boolean(damageType) && damageType !== 'force';
}

export const QUIVERING_PALM_KI = 3;

export const QUIVERING_PALM_DAMAGE = '10d10';

export function slowFallReduction(monkLevel: number): number {
  return 5 * Math.max(1, monkLevel);
}
