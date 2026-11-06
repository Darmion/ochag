import type { Advantage } from '../../../combat/conditions.ts';

export function supremeSneakApplies(movedFeet: number, speedFeet: number): boolean {
  return movedFeet <= speedFeet / 2;
}

export const THIEFS_REFLEXES_OFFSET = 10;

export function sneakAttackDice(level: number | null | undefined): number {
  return Math.ceil(Math.max(1, Math.min(20, level ?? 1)) / 2);
}

export function sneakAttackRuling(input: {
  finesse: boolean; ranged: boolean; advantage: Advantage; allyNearTarget: boolean; usedThisTurn: boolean;
}): { ok: boolean; reason: string } {
  if (input.usedThisTurn) return { ok: false, reason: 'уже была в этот ход' };
  if (!input.finesse && !input.ranged) return { ok: false, reason: 'нужно фехтовальное или дальнобойное оружие' };
  if (input.advantage === 'adv') return { ok: true, reason: 'преимущество' };
  if (input.advantage === 'disadv') return { ok: false, reason: 'атака с помехой' };
  if (input.allyNearTarget) return { ok: true, reason: 'союзник рядом с целью' };
  return { ok: false, reason: 'нет преимущества и союзника рядом с целью' };
}
