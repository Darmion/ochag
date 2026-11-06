import { ref, watch, computed, type Ref } from 'vue';
import type { SpellEntry, ProjectileRule, Metamagic } from './types';

export const PROJECTILE_NOUN: Record<ProjectileRule['noun'], string> = { ray: 'лучей', dart: 'стрел', beam: 'зарядов' };

export type SpellTargetsDeps = {
  usePact: Ref<boolean>;
  castSlot: Ref<number>;
  castingEntry: Ref<SpellEntry | null>;
  castMetamagic: Ref<Metamagic>;
  castSlotLevel: (entry: SpellEntry) => number;
};

export function useSpellTargets({ usePact, castSlot, castingEntry, castMetamagic, castSlotLevel }: SpellTargetsDeps) {
  const castTargets = ref<string[]>([]);
  const castArea = ref('');
  watch(() => [castTargets.value.join(','), castMetamagic.value] as const, () => {
    const entry = castingEntry.value;
    if (!entry?.spell?.singleTarget) return;
    const most = castMetamagic.value === 'twinned' ? 2 : 1;
    if (castTargets.value.length > most) castTargets.value = castTargets.value.slice(-most);
  });
  const actorLevel = ref<number | null>(null);

  const shotsPer = ref<Record<string, number>>({});
  function projectileTotal(entry: SpellEntry) {
    const rule = entry.spell?.projectiles;
    if (!rule) return 0;
    const slot = castSlotLevel(entry);
    let count = rule.base + (rule.perSlotFrom !== null ? Math.max(0, slot - rule.perSlotFrom) : 0);
    for (const [level, value] of rule.byLevel ?? []) if ((actorLevel.value ?? 1) >= level) count = Math.max(count, value);
    return count;
  }
  watch(() => [castTargets.value.join(','), castingEntry.value?.id, castSlot.value, usePact.value] as const, () => {
    const entry = castingEntry.value;
    const total = entry ? projectileTotal(entry) : 0;
    const next: Record<string, number> = {};
    castTargets.value.forEach((id, index) => {
      next[id] = Math.floor(total / castTargets.value.length) + (index < total % castTargets.value.length ? 1 : 0);
    });
    shotsPer.value = next;
  });
  const shotsAssigned = computed(() => Object.values(shotsPer.value).reduce((sum, value) => sum + value, 0));
  function changeShots(id: string, delta: number) {
    const entry = castingEntry.value;
    if (!entry) return;
    const value = (shotsPer.value[id] ?? 0) + delta;
    if (value < 0 || (delta > 0 && shotsAssigned.value >= projectileTotal(entry))) return;
    shotsPer.value = { ...shotsPer.value, [id]: value };
  }

  return { castTargets, castArea, actorLevel, shotsPer, projectileTotal, shotsAssigned, changeShots };
}
