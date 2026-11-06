import { locale } from '../i18n/i18n';
import { ref, computed, watch, type Ref } from 'vue';
import type { BeastForm, SpellEntry } from './types';

export type SummonChoicesDeps = {
  castingEntry: Ref<SpellEntry | null>;
  castSlotLevel: (entry: SpellEntry) => number;
};

export const ELEMENT_LABELS: Record<string, string> = {
  acid: 'кислота', cold: 'холод', fire: 'огонь', lightning: 'электричество', thunder: 'звук', bludgeoning: 'дробящий', force: 'силовое поле',
  necrotic: 'некротический', piercing: 'колющий', poison: 'яд', psychic: 'психический', radiant: 'излучение', slashing: 'рубящий',
};

export const crLabel = (cr: number) => (cr > 0 && cr < 1 ? `1/${Math.round(1 / cr)}` : String(cr));

export function useSummonChoices({ castingEntry, castSlotLevel }: SummonChoicesDeps) {
  const castBeast = ref('');
  const castElement = ref('fire');
  const castMode = ref('');
  const conjureOption = ref(0);
  const beastLabel = (form: BeastForm) => (locale.value === 'ru' ? `${form.name} · опасность ${crLabel(form.cr)}` : `${form.nameEn} · CR ${crLabel(form.cr)}`);
  function conjureCountOf(entry: SpellEntry, option: number) {
    const base = entry.spell?.summon?.options?.[option];
    if (!base) return 1;
    const slot = castSlotLevel(entry);
    return base.count * (slot >= 9 ? 4 : slot >= 7 ? 3 : slot >= 5 ? 2 : 1);
  }
  const beastChoices = computed<BeastForm[]>(() => {
    const spell = castingEntry.value?.spell;
    if (spell?.summon) {
      const limit = spell.summon.options?.[conjureOption.value]?.cr ?? Infinity;
      return spell.summon.forms.filter(form => form.cr <= limit);
    }
    return spell?.shape?.forms ?? [];
  });
  watch(beastChoices, list => { if (!list.some(form => form.index === castBeast.value)) castBeast.value = list[0]?.index ?? ''; });
  const chosenBeast = computed(() => beastChoices.value.find(form => form.index === castBeast.value) ?? null);

  return { castBeast, castElement, castMode, conjureOption, beastLabel, conjureCountOf, beastChoices, chosenBeast };
}
