import type { GameIconName } from '../ui/gameIcons.ts';

// The always-visible strip over the action bar (complaint list 2026-11-10, item 1): spell slots by level, pact slots and
// class pools, built from what the bar already loads. A pool shared by several features (ki, channel divinity) shows once.
export type StripSlot = { level: number; current: number; max: number };
export type StripPool = { key: string; name: string; icon: GameIconName; current: number; max: number; recharge: 'short' | 'long' | null; featureId: string };
export type StripModel = { slots: StripSlot[]; pact: StripSlot | null; pools: StripPool[] };

type SlotIn = { level: number; current: number; max: number };
type PactIn = { current: number; max: number; slotLevel: number };
type FeatureIn = { id: string; resource: { name: string; current: number; max: number; recharge?: string | null } | null };

// Each pool has its own icon (drawn by Codex for the strip), none of them a symbol of a real faith.
const POOL_ICONS: Record<string, GameIconName> = {
  'Ярость': 'poolRage', 'Непреклонная ярость': 'poolEndurance', 'Второе дыхание': 'poolSecondWind', 'Всплеск действий': 'poolActionSurge',
  'Упорный': 'poolIndomitable', 'Кости превосходства': 'poolSuperiority', 'Вдохновение барда': 'poolBardic', 'Божественный канал': 'poolChannel',
  'Святой нимб': 'poolNimbus', 'Наложение рук': 'poolLayOnHands', 'Ци': 'poolKi', 'Цельность тела': 'poolWholeness', 'Дикий облик': 'poolWildShape',
  'Природное восстановление': 'poolNaturalRecovery', 'Очки чародейства': 'poolSorcery', 'Арканное восстановление': 'poolArcaneRecovery',
  'Мастер таинств': 'poolEldritch', 'Удача тёмного': 'poolLuck', 'Бросок через ад': 'poolHurl', 'Удача': 'poolLuck',
  'Очищающее касание': 'poolCleansing', 'Оружие дыхания': 'poolBreath', 'Непоколебимость': 'poolEndurance',
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
export const roman = (level: number) => ROMAN[level] ?? String(level);

// Small pools are pips (filled = left); a big pool like Lay on Hands reads better as a number.
export const PIPS_UP_TO = 5;
export function pips(current: number, max: number): boolean[] | null {
  return max > 0 && max <= PIPS_UP_TO ? Array.from({ length: max }, (_, index) => index < current) : null;
}

export function stripModel(slots: SlotIn[], pact: PactIn | null, features: FeatureIn[]): StripModel {
  const pools: StripPool[] = [];
  for (const feature of features) {
    const resource = feature.resource;
    if (!resource || resource.max <= 0 || pools.some(pool => pool.key === resource.name)) continue;
    const recharge = resource.recharge === 'short' || resource.recharge === 'long' ? resource.recharge : null;
    pools.push({
      key: resource.name, name: resource.name, icon: POOL_ICONS[resource.name] ?? 'poolGeneric',
      current: Math.max(0, resource.current), max: resource.max, recharge, featureId: feature.id,
    });
  }
  return {
    slots: slots.filter(slot => slot.max > 0).sort((a, b) => a.level - b.level).map(slot => ({ level: slot.level, current: Math.max(0, slot.current), max: slot.max })),
    pact: pact && pact.max > 0 ? { level: pact.slotLevel, current: Math.max(0, pact.current), max: pact.max } : null,
    pools,
  };
}

export const stripEmpty = (model: StripModel) => !model.slots.length && !model.pact && !model.pools.length;

export function slotTitle(slot: StripSlot) {
  return `Ячейки ${slot.level} круга: ${slot.current} из ${slot.max}. Восстанавливаются после долгого отдыха. Щелчок — заклинания этого круга.`;
}

export function pactTitle(slot: StripSlot) {
  return `Ячейки договора, ${slot.level} круг: ${slot.current} из ${slot.max}. Восстанавливаются после короткого отдыха. Щелчок — заклинания договора.`;
}

export function poolTitle(pool: StripPool) {
  if (pool.recharge === 'short') return `${pool.name}: ${pool.current} из ${pool.max}. Восстанавливается после короткого отдыха. Щелчок — умения.`;
  if (pool.recharge === 'long') return `${pool.name}: ${pool.current} из ${pool.max}. Восстанавливается после долгого отдыха. Щелчок — умения.`;
  return `${pool.name}: ${pool.current} из ${pool.max}. Щелчок — умения.`;
}
