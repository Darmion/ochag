import type { ClassLevel } from '../../classes.ts';

export function auraOfProtection(classes: ClassLevel[], charismaModifier: number): { feet: number; bonus: number } | null {
  const paladin = classes.find(entry => entry.id === 'paladin')?.level ?? 0;
  if (paladin < 6) return null;
  return { feet: paladin >= 18 ? 30 : 10, bonus: Math.max(1, charismaModifier) };
}

export function auraOfDevotion(classes: ClassLevel[]): { feet: number } | null {
  const entry = classes.find(item => item.id === 'paladin');
  if (!entry || entry.level < 7 || (entry.subclass && entry.subclass !== 'devotion')) return null;
  return { feet: entry.level >= 18 ? 30 : 10 };
}

export function auraOfCourage(classes: ClassLevel[]): { feet: number } | null {
  const entry = classes.find(item => item.id === 'paladin');
  if (!entry || entry.level < 10) return null;
  return { feet: entry.level >= 18 ? 30 : 10 };
}

export const HOLY_NIMBUS_DAMAGE = 10;

export const HOLY_NIMBUS_FEET = 30;

export const HOLY_NIMBUS_ROUNDS = 10;

export function smiteDice(slotLevel: number, undeadOrFiend: boolean): number {
  return Math.min(5, Math.max(1, slotLevel) + 1) + (undeadOrFiend ? 1 : 0);
}

export function isUndeadOrFiend(typeText: string | null | undefined): boolean {
  return /нежит|исчади|демон|дьявол|undead|fiend/i.test(typeText ?? '');
}
