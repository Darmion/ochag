import { type AutoTarget, loadAutoTarget, saveAutoTarget, autoPace } from '../autoTarget';
import { computed, ref, watch, type Ref, type ComputedRef } from 'vue';
import type { TabletopProps, SceneDetail, SceneObjectDTO, InitiativeEntry } from './types';
import type { TableToast } from '../toasts';

export type InitiativeDeps = {
  props: TabletopProps;
  sceneDetail: Ref<SceneDetail | null>;
  objects: Ref<SceneObjectDTO[]>;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  initiativePath: () => string;
  loadInitiative: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  actorEntry: ComputedRef<InitiativeEntry | null>;
  currentEntry: ComputedRef<InitiativeEntry | null>;
  currentEntries: ComputedRef<InitiativeEntry[]>;
};

export function useInitiative({ props, sceneDetail, objects, pushToast, initiativePath, loadInitiative, run, actorEntry, currentEntry, currentEntries }: InitiativeDeps) {
  function joinInitiative(characterId: string) {
    return run(async () => {
      await props.request(`${initiativePath()}/join`, 'POST', { characterId });
      await loadInitiative();
    });
  }

  function addNpcToInitiative(payload: { name: string; score: number }) {
    return run(async () => {
      await props.request(`${initiativePath()}/npc`, 'POST', payload);
      await loadInitiative();
    });
  }

  function advanceInitiative(entryId?: string) {
    const seen = currentEntries.value.map(entry => entry.id);
    return run(async () => {
      try {
        await props.request(`${initiativePath()}/advance`, 'POST', { ...(entryId ? { entryId } : {}), current: seen });
      } catch (cause) {
        if (!(cause instanceof Error && cause.message.startsWith('Ход уже передан'))) throw cause;
      }
      await loadInitiative();
    });
  }

  function advanceActorTurn() {
    const entry = actorEntry.value;
    if (entry?.is_current && currentEntries.value.length > 1) return advanceInitiative(entry.id);
    return advanceInitiative();
  }

  function endCombat() {
    return run(async () => {
      await props.request(initiativePath(), 'DELETE');
      await loadInitiative();
    });
  }

  function dashInitiative(entryId: string) {
    return run(async () => {
      await props.request(`${initiativePath()}/${entryId}/dash`, 'POST');
      await loadInitiative();
    });
  }

  const canAutoTurn = computed(() => {
    const characterId = currentEntry.value?.character_id;
    return Boolean(sceneDetail.value?.canManage && characterId && objects.value.some(object => object.character_id === characterId && object.kind === 'npc'));
  });

  const autoTarget = ref<AutoTarget>(loadAutoTarget());
  watch(autoTarget, value => saveAutoTarget(value));

  function autoTurn() {
    return run(async () => {
      const result = await props.request(`${initiativePath()}/auto`, 'POST', { target: autoTarget.value, pace: autoPace.value });
      pushToast({ tone: 'turn', title: `Ход: ${result.npc?.name ?? 'НПС'}`, detail: result.summary || 'ничего не сделал' }, 7000);
      await loadInitiative();
    });
  }

  function actInitiative(entryId: string, action: 'disengage' | 'dodge') {
    return run(async () => {
      await props.request(`${initiativePath()}/${entryId}/act`, 'POST', { action });
      await loadInitiative();
    });
  }

  function economyInitiative(entryId: string, field: 'action' | 'bonus' | 'reaction', used: boolean) {
    return run(async () => {
      await props.request(`${initiativePath()}/${entryId}/economy`, 'POST', { [field]: used });
      await loadInitiative();
    });
  }

  function deleteInitiativeEntry(entryId: string) {
    return run(async () => {
      await props.request(`${initiativePath()}/${entryId}`, 'DELETE');
      await loadInitiative();
    });
  }

  return { joinInitiative, addNpcToInitiative, advanceInitiative, advanceActorTurn, endCombat, dashInitiative, canAutoTurn, autoTarget, autoTurn, actInitiative, economyInitiative, deleteInitiativeEntry };
}
