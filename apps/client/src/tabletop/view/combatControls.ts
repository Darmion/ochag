import { confirmAction } from '../../ui/confirmDialog';
import { computed, type Ref, type ComputedRef } from 'vue';
import { clockText } from '../../campaign/worldClock';
import type { TabletopProps, SceneDetail, SceneObjectDTO, InitiativeEntry } from './types';
import type { TableToast } from '../toasts';

export type CombatControlsDeps = {
  props: TabletopProps;
  viewOnly: boolean;
  sceneId: Ref<string>;
  sceneDetail: Ref<SceneDetail | null>;
  objects: Ref<SceneObjectDTO[]>;
  initiativeEntries: Ref<InitiativeEntry[]>;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  initiativePath: () => string;
  loadInitiative: () => Promise<void>;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  joinInitiative: (characterId: string) => Promise<void>;
  dashInitiative: (entryId: string) => Promise<void>;
  deleteInitiativeEntry: (entryId: string) => Promise<void>;
  actorObject: ComputedRef<SceneObjectDTO | null>;
  actorEntry: ComputedRef<InitiativeEntry | null>;
};

export function useCombatControls({ props, viewOnly, sceneId, sceneDetail, objects, initiativeEntries, pushToast, initiativePath, loadInitiative, refresh, run, joinInitiative, dashInitiative, deleteInitiativeEntry, actorObject, actorEntry }: CombatControlsDeps) {
  function startCombat() {
    return run(async () => {
      const result = await props.request(`${initiativePath()}/start`, 'POST', {});
      pushToast({
        tone: 'info',
        title: 'Бой начался!',
        detail: result.joined.length
          ? `Инициатива: ${result.joined.map((entry: any) => `${entry.name} ${entry.score}`).join(', ')}.`
          : 'Все на сцене уже в бою.',
      }, 9000);
      await loadInitiative();
    });
  }

  function restParty(kind: 'short' | 'long') {
    if (!sceneId.value) return;
    return run(async () => {
      await props.request(`/campaigns/${props.campaignId}/scenes/${sceneId.value}/rest`, 'POST', { kind });
      await refresh();
    });
  }

  function beginRest(kind: 'short' | 'long') {
    if (!sceneId.value) return;
    return run(async () => {
      await props.request(`/campaigns/${props.campaignId}/scenes/${sceneId.value}/rest/begin`, 'POST', { kind });
      await refresh();
    });
  }

  function finishRest() {
    if (!sceneId.value) return;
    return run(async () => {
      await props.request(`/campaigns/${props.campaignId}/scenes/${sceneId.value}/rest/finish`, 'POST', {});
      await refresh();
    });
  }

  function cancelRest() {
    if (!sceneId.value) return;
    return run(async () => {
      await props.request(`/campaigns/${props.campaignId}/scenes/${sceneId.value}/rest/cancel`, 'POST', {});
      await refresh();
    });
  }

  const restBanner = computed(() => {
    const rest = sceneDetail.value?.rest;
    if (!rest) return null;
    const what = rest.kind === 'long' ? 'долгий отдых' : 'короткий отдых';
    const state = rest.interrupted
      ? `сорван: ${rest.interrupted}`
      : rest.kind === 'long' && rest.strenuousMinutes ? `напряжённого — ${rest.strenuousMinutes} мин из 60` : 'идёт';
    return { text: `Привал: ${what} · с ${clockText(rest.startedMinutes)} · ${state}`, interrupted: Boolean(rest.interrupted) };
  });

  function joinActorInitiative() {
    if (actorObject.value) joinInitiative(actorObject.value.character_id);
  }

  const canLeaveCombat = computed(() => Boolean(!viewOnly && actorEntry.value && actorObject.value?.canEdit && !sceneDetail.value?.canManage));
  async function leaveCombat(characterId: string) {
    const entry = initiativeEntries.value.find(row => row.character_id === characterId);
    if (!entry) return;
    const name = objects.value.find(object => object.character_id === characterId)?.name ?? 'Существо';
    const confirmed = await confirmAction(`${name} выйдет из боя: запись в очереди хода пропадёт${entry.is_current ? ', ход перейдёт следующему' : ''}. Вернуться — снова «В бой» (инициатива бросится заново).`, {
      title: 'Выйти из боя?', confirmLabel: 'Выйти', cancelLabel: 'Остаться',
    });
    if (confirmed) await deleteInitiativeEntry(entry.id);
  }
  function leaveActorCombat() {
    if (actorObject.value) void leaveCombat(actorObject.value.character_id);
  }

  function dashActor() {
    if (actorEntry.value) dashInitiative(actorEntry.value.id);
  }

  return { startCombat, restParty, beginRest, finishRest, cancelRest, restBanner, joinActorInitiative, canLeaveCombat, leaveCombat, leaveActorCombat, dashActor };
}
