import { computed, type ComputedRef, type Ref } from 'vue';
import type { InitiativeEntry, SceneDetail, TabletopProps } from './types';
import type { TableToast } from '../toasts';

export type InitiativeEventsDeps = {
  props: TabletopProps;
  sceneDetail: Ref<SceneDetail | null>;
  currentEntry: ComputedRef<InitiativeEntry | null>;
  pushToast: (toast: Omit<TableToast, 'id'>, durationMs?: number) => void;
  initiativePath: () => string;
  loadInitiative: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
};

// The GM's prompt on an initiative event slot (a lair): one action from its list, then the turn moves on.
export function useInitiativeEvents({ props, sceneDetail, currentEntry, pushToast, initiativePath, loadInitiative, run }: InitiativeEventsDeps) {
  const eventTurn = computed(() => {
    const entry = currentEntry.value;
    return sceneDetail.value?.canManage && entry?.event_kind && entry.event ? entry : null;
  });

  function passTurn(entryId: string) {
    return props.request(`${initiativePath()}/advance`, 'POST', { entryId });
  }

  function useEventOption(index: number) {
    const entry = eventTurn.value;
    if (!entry) return Promise.resolve();
    return run(async () => {
      const result = await props.request(`${initiativePath()}/${entry.id}/event`, 'POST', { option: index });
      pushToast({ tone: 'turn', title: entry.name, detail: result?.summary ?? '' }, 7000);
      await passTurn(entry.id);
      await loadInitiative();
    });
  }

  function skipEvent() {
    const entry = eventTurn.value;
    if (!entry) return Promise.resolve();
    return run(async () => {
      await passTurn(entry.id);
      await loadInitiative();
    });
  }

  return { eventTurn, useEventOption, skipEvent };
}
