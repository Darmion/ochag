import { computed, reactive, ref, type Ref } from 'vue';
import type { SrdSpell } from '../rules/srd';
import { matchRefs } from './refMatch';
import type { CampaignSpell, PendingRef, Spellcasting, SpellsRequest } from './types';

type RefMappingInput = {
  props: { campaignId: string; request: SpellsRequest };
  busy: Ref<boolean>;
  error: Ref<string>;
  casting: Ref<Spellcasting | null>;
  srdLibrary: Ref<SrdSpell[]>;
  customLibrary: Ref<CampaignSpell[]>;
  loadKnown: () => Promise<void>;
  loadCasting: () => Promise<void>;
};

export function useRefMapping({ props, busy, error, casting, srdLibrary, customLibrary, loadKnown, loadCasting }: RefMappingInput) {
  const refQuery = ref<Record<string, string>>({});
  const refChoice = ref<Record<string, string>>({});
  const casterClasses = computed(() => new Set(casting.value?.classes ?? []));

  function refMatches(ref: PendingRef) {
    return matchRefs(ref, refQuery.value[ref.ref], srdLibrary.value, customLibrary.value, casterClasses.value);
  }

  async function mapRef(ref: PendingRef, skip = false) {
    const choice = refChoice.value[ref.ref];
    if (!skip && !choice) return;
    busy.value = true;
    error.value = '';
    try {
      const body = skip
        ? { source: 'skip' }
        : choice!.startsWith('srd:') ? { source: 'srd', srdIndex: choice!.slice(4) } : { source: 'custom', customSpellId: choice!.slice(7) };
      await props.request(`/campaigns/${props.campaignId}/spell-refs/${encodeURIComponent(ref.ref)}`, 'PUT', body);
      await Promise.all([loadKnown(), loadCasting()]);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось сопоставить. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }

  return reactive({ refQuery, refChoice, refMatches, mapRef });
}

export type RefMapping = ReturnType<typeof useRefMapping>;
