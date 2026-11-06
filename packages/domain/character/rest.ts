import { classOf, hitDieForClass, sheetClassText, type ClassLevel } from './classes.ts';

export type RestKind = 'short' | 'long';
export type Recharge = 'none' | 'short' | 'long';

export function guessHitDie(classText: string | null | undefined): number {
  return hitDieForClass(classOf(classText));
}

export const classTextOf = sheetClassText;

export function hitDiceTotal(level: number | null | undefined) {
  return Math.max(1, Math.min(20, Math.trunc(level ?? 1)));
}

export function hitDiceLeft(level: number | null | undefined, spent: number) {
  return Math.max(0, hitDiceTotal(level) - spent);
}

export function hitDiceRecovered(level: number | null | undefined) {
  return Math.max(1, Math.floor(hitDiceTotal(level) / 2));
}

export type HitDicePool = { die: number; total: number; spent: number };

export function hitDicePools(
  classes: ClassLevel[], dieOverride: number | null | undefined, totalLevel: number | null | undefined,
  spentTotal: number, spentByDie?: Record<string, number> | null,
): HitDicePool[] {
  const total = hitDiceTotal(totalLevel);
  const byDie = new Map<number, number>();
  if ((dieOverride && [6, 8, 10, 12].includes(dieOverride)) || classes.length <= 1) {
    byDie.set(dieOverride && [6, 8, 10, 12].includes(dieOverride) ? dieOverride : hitDieForClass(classes[0]?.id ?? null), total);
  } else {
    for (const entry of classes) byDie.set(hitDieForClass(entry.id), (byDie.get(hitDieForClass(entry.id)) ?? 0) + entry.level);
  }
  const pools = [...byDie.entries()].sort((a, b) => b[0] - a[0]).map(([die, count]) => ({ die, total: count, spent: 0 }));
  const spent = Math.max(0, Math.min(total, Math.trunc(spentTotal)));
  const stored = spentByDie && typeof spentByDie === 'object' ? spentByDie : null;
  const storedSum = stored ? pools.reduce((sum, pool) => sum + Math.max(0, Math.trunc(Number(stored[String(pool.die)]) || 0)), 0) : -1;
  if (stored && storedSum === spent) {
    for (const pool of pools) pool.spent = Math.min(pool.total, Math.max(0, Math.trunc(Number(stored[String(pool.die)]) || 0)));
  } else {
    let left = spent;
    for (const pool of pools) { pool.spent = Math.min(pool.total, left); left -= pool.spent; }
  }
  return pools;
}

export function spendHitDice(pools: HitDicePool[], count: number): { dice: number[]; pools: HitDicePool[] } {
  const next = pools.map(pool => ({ ...pool }));
  const dice: number[] = [];
  for (const pool of next) {
    while (dice.length < count && pool.spent < pool.total) { pool.spent += 1; dice.push(pool.die); }
  }
  return { dice, pools: next };
}

export function recoverHitDice(pools: HitDicePool[], count: number): { recovered: number; pools: HitDicePool[] } {
  const next = pools.map(pool => ({ ...pool }));
  let recovered = 0;
  for (const pool of next) {
    while (recovered < count && pool.spent > 0) { pool.spent -= 1; recovered += 1; }
  }
  return { recovered, pools: next };
}

export function spentByDieOf(pools: HitDicePool[]): Record<string, number> {
  return Object.fromEntries(pools.map(pool => [String(pool.die), pool.spent]));
}

export function hitDiceText(pools: HitDicePool[], which: 'total' | 'left' = 'total'): string {
  return pools.map(pool => `${which === 'total' ? pool.total : pool.total - pool.spent}d${pool.die}`).join(' + ');
}

export function hitDieHealing(roll: number, constitutionModifier: number) {
  return Math.max(0, roll + constitutionModifier);
}

export function recharges(recharge: Recharge, kind: RestKind) {
  return recharge === 'short' || (recharge === 'long' && kind === 'long');
}
