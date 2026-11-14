import type { Ref } from 'vue';
import type { SpellEntry, PactSlots, SpellSlot } from './types';

export type SpellSlotsDeps = {
  pactSlots: Ref<PactSlots | null>;
  usePact: Ref<boolean>;
  slotList: Ref<SpellSlot[]>;
  castSlot: Ref<number>;
};

export function useSpellSlots({ pactSlots, usePact, slotList, castSlot }: SpellSlotsDeps) {
  function slotChoices(entry: SpellEntry): SpellSlot[] {
    if (entry.item) {
      const charges = entry.item.charges;
      return entry.item.levels.map(option => ({ level: option.level, current: charges ? charges.current : 1, max: charges ? charges.max : 1, cost: option.cost }));
    }
    const level = entry.spell?.level ?? 0;
    if (level === 0 || entry.slotless) return [];
    return slotList.value.filter(slot => slot.level >= level && slot.current > 0).sort((a, b) => a.level - b.level);
  }

  function pactCastable(entry: SpellEntry) {
    if (entry.item) return false;
    const level = entry.spell?.level ?? 0;
    return Boolean(pactSlots.value && level > 0 && level <= pactSlots.value.slotLevel);
  }

  function castSlotLevel(entry: SpellEntry) {
    return usePact.value && pactCastable(entry) ? pactSlots.value?.slotLevel ?? 0 : castSlot.value || slotChoices(entry)[0]?.level || entry.spell?.level || 0;
  }

  return { slotChoices, pactCastable, castSlotLevel };
}
