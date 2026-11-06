import { watch, computed, type Ref, type ComputedRef } from 'vue';
import type { FogState } from '../scene';
import { LIGHTING_INFO } from '../lightPresets';
import { WEATHER_INFO, PHASE_INFO, dayPhase, clockText } from '../../campaign/worldClock';
import type { TabletopProps, SceneDetail, SceneObjectDTO, InitiativeEntry } from './types';
import type { PortraitEntry } from '../../components/game/GamePortraits.vue';

export type VisionDeps = {
  props: TabletopProps;
  viewOnly: boolean;
  sceneDetail: Ref<SceneDetail | null>;
  objects: Ref<SceneObjectDTO[]>;
  fog: Ref<FogState>;
  visionInfo: Ref<{ fogEnabled: boolean; partyVision: boolean; alliedChoice: 'own' | 'allies' | null } | null>;
  visionPreview: Ref<boolean>;
  eyesOfSelected: Ref<boolean>;
  eyesTarget: Ref<{ characterId: string; name: string } | null>;
  initiativeEntries: Ref<InitiativeEntry[]>;
  activeObject: ComputedRef<SceneObjectDTO | undefined>;
  reframeForHud: () => void;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  partyPortraits: ComputedRef<PortraitEntry[]>;
};

export function useVision({ props, viewOnly, sceneDetail, objects, fog, visionInfo, visionPreview, eyesOfSelected, eyesTarget, initiativeEntries, activeObject, reframeForHud, refresh, run, partyPortraits }: VisionDeps) {
  const creatureOf = (object: typeof activeObject.value) =>
    object && (object.kind === 'character' || object.kind === 'npc') && !object.parent_object_id ? { characterId: object.character_id, name: object.name } : null;
  watch(eyesOfSelected, on => {
    if (on) {
      visionPreview.value = false;
      eyesTarget.value = creatureOf(activeObject.value) ?? eyesTarget.value;
    }
    void refresh();
  });
  watch(activeObject, object => {
    const creature = creatureOf(object);
    if (eyesOfSelected.value && creature && creature.characterId !== eyesTarget.value?.characterId) {
      eyesTarget.value = creature;
      void refresh();
    }
  });

  const lightSources = computed(() => objects.value
    .filter(object => object.state?.light)
    .map(object => ({ characterId: object.character_id, name: object.name, kind: object.kind, light: object.state!.light! })));
  const partySight = computed(() => objects.value
    .filter(object => object.kind === 'character' && !object.parent_object_id)
    .map(object => ({ characterId: object.character_id, name: object.name, darkvisionFeet: Number(object.darkvision_feet ?? 0) })));
  const lightTarget = computed(() => {
    const object = activeObject.value;
    return object?.canEdit ? { characterId: object.character_id, name: object.name, light: object.state?.light ?? null } : null;
  });
  const visionChip = computed(() => {
    if (sceneDetail.value?.canManage && visionPreview.value) return 'Карта глазами отряда — тёмное игроки не видят';
    if (sceneDetail.value?.canManage && eyesOfSelected.value && !eyesTarget.value) return 'Глазами выбранного — выберите существо на карте';
    return '';
  });
  const eyesChipName = computed(() => (sceneDetail.value?.canManage && eyesOfSelected.value ? eyesTarget.value?.name ?? '' : ''));
  const visionChipParts = computed(() => {
    if (visionChip.value || eyesChipName.value || viewOnly) return [];
    const lighting = sceneDetail.value?.effective_lighting ?? sceneDetail.value?.lighting ?? 'bright';
    const weather = sceneDetail.value?.weather ?? 'clear';
    return [
      ...(lighting === 'bright' ? [] : [LIGHTING_INFO[lighting]]),
      ...(weather === 'clear' ? [] : [WEATHER_INFO[weather]]),
    ];
  });
  watch(
    () => `${initiativeEntries.value.length > 0}|${partyPortraits.value.length}|${Boolean(visionChip.value || eyesChipName.value || visionChipParts.value.length)}`,
    () => reframeForHud(),
  );
  const worldClock = computed(() => {
    const minutes = sceneDetail.value?.world_minutes;
    if (minutes === undefined) return null;
    const weather = sceneDetail.value?.weather && sceneDetail.value.weather !== 'clear' ? WEATHER_INFO[sceneDetail.value.weather].icon : null;
    return { phase: PHASE_INFO[dayPhase(minutes)].icon, text: clockText(minutes), weather };
  });

  const alliedToggle = computed(() => {
    const info = visionInfo.value;
    return !sceneDetail.value?.canManage && !viewOnly && fog.value && info && !info.partyVision && info.alliedChoice ? info.alliedChoice : null;
  });

  function chooseVision(mode: 'own' | 'allies') {
    return run(async () => {
      await props.request(`/campaigns/${props.campaignId}/me/vision`, 'PUT', { mode });
      await refresh();
    });
  }

  return { lightSources, partySight, lightTarget, visionChip, eyesChipName, visionChipParts, worldClock, alliedToggle, chooseVision };
}
