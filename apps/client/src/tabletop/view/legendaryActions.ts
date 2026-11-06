import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';
import type { LegendaryOption, TabletopProps, SceneDetail, SceneObjectDTO, InitiativeEntry } from './types';
import type { TableToast } from '../toasts';

export type LegendaryActionsDeps = {
  props: TabletopProps;
  sceneDetail: Ref<SceneDetail | null>;
  objects: Ref<SceneObjectDTO[]>;
  initiativeEntries: Ref<InitiativeEntry[]>;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  initiativePath: () => string;
  loadInitiative: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  currentEntry: ComputedRef<InitiativeEntry | null>;
};

export function useLegendaryActions({ props, sceneDetail, objects, initiativeEntries, pushToast, initiativePath, loadInitiative, run, currentEntry }: LegendaryActionsDeps) {
  const bossOptions = ref<Record<string, LegendaryOption[]>>({});
  const legendaryOpen = ref(false);
  const endedEntryId = ref<string | null>(null);
  const legendaryBosses = computed(() => {
    if (!sceneDetail.value?.canManage) return [];
    return initiativeEntries.value
      .filter(entry => entry.character_id && (entry.legendary_actions ?? 0) > 0 && !entry.is_current && entry.id !== endedEntryId.value)
      .map(entry => ({ entry, max: entry.legendary_actions ?? 0, left: (entry.legendary_actions ?? 0) - (entry.legendary_used ?? 0) }))
      .filter(boss => {
        const conditions = objects.value.find(object => object.character_id === boss.entry.character_id)?.conditions ?? [];
        return boss.left > 0 && !conditions.includes('dead');
      });
  });

  async function loadBossOptions(force = false) {
    for (const boss of legendaryBosses.value) {
      const id = boss.entry.character_id!;
      if (!force && bossOptions.value[id]) continue;
      try {
        const result = await props.request(`/campaigns/${props.campaignId}/characters/${id}/boss`);
        bossOptions.value = { ...bossOptions.value, [id]: Array.isArray(result.options) ? result.options : [] };
      } catch {
      }
    }
  }

  watch(() => currentEntry.value?.id, (id, previous) => {
    endedEntryId.value = previous ?? null;
    if (!id) legendaryOpen.value = false;
    else if (previous && legendaryBosses.value.length) {
      legendaryOpen.value = true;
      void loadBossOptions(true);
    }
  });

  function openLegendary() {
    endedEntryId.value = null;
    legendaryOpen.value = true;
    void loadBossOptions(true);
  }

  function useLegendary(entryId: string, option: number) {
    return run(async () => {
      const result = await props.request(`${initiativePath()}/${entryId}/legendary`, 'POST', { option });
      if (result?.summary) pushToast({ tone: 'info', title: result.option?.name ?? 'Легендарное действие', detail: result.summary }, 6000);
      await loadInitiative();
    });
  }

  return { bossOptions, legendaryOpen, legendaryBosses, openLegendary, useLegendary };
}
