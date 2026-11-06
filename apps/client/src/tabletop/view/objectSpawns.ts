import { computed, type Ref, type ComputedRef } from 'vue';
import type { Tabletop, TableTool } from '../scene';
import type { Position } from '../grid';
import type { TableToast } from '../toasts';
import type { BestiaryPlacement } from '../../components/rules/BestiaryModal.vue';
import EncountersPanel from '../../components/campaign/EncountersPanel.vue';
import type { TabletopProps, SceneObjectDTO } from './types';

export type ObjectSpawnsDeps = {
  props: TabletopProps;
  sceneId: Ref<string>;
  duplicateCount: Ref<number>;
  placingEncounter: Ref<{ id: string; name: string; members: Array<{ dx: number; dz: number }> } | null>;
  bestiaryOpen: Ref<boolean>;
  compendiumOpen: Ref<boolean>;
  wizardOpen: Ref<boolean>;
  placingBestiary: Ref<BestiaryPlacement | null>;
  encountersPanel: Ref<InstanceType<typeof EncountersPanel> | null>;
  objects: Ref<SceneObjectDTO[]>;
  table: () => Tabletop | undefined;
  tool: Ref<TableTool>;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  activeObject: ComputedRef<SceneObjectDTO | undefined>;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  loadLists: () => Promise<void>;
  placeOnScene: (characterId: string) => Promise<void>;
};

export function useObjectSpawns({ props, sceneId, duplicateCount, placingEncounter, bestiaryOpen, compendiumOpen, wizardOpen, placingBestiary, encountersPanel, objects, table, tool, pushToast, activeObject, refresh, run, loadLists, placeOnScene }: ObjectSpawnsDeps) {
  const encounterCandidates = computed(() => objects.value
    .filter(object => object.kind !== 'character')
    .map(object => ({ id: object.id, name: object.name, kind: object.kind, disposition: object.disposition })));

  function announceCopies(title: string, created: Array<{ name: string }>) {
    pushToast({ tone: 'info', title, detail: created.map(item => item.name).join(', ') });
  }

  function duplicateActive() {
    const object = activeObject.value;
    if (!object) return;
    const count = Math.max(1, Math.min(20, Math.round(duplicateCount.value || 1)));

    void run(async () => {
      const result = await props.request(
        `/campaigns/${props.campaignId}/characters/${object.character_id}/duplicate`,
        'POST',
        { count, sceneId: sceneId.value },
      );
      await Promise.all([refresh(), loadLists()]);
      announceCopies(count > 1 ? `Добавлено копий: ${count}` : 'Добавлена копия', result.characters);
    });
  }

  function startEncounterPlacement(encounter: { id: string; name: string; members: Array<{ dx: number; dz: number }> }) {
    tool.value = 'place';
    placingBestiary.value = null;
    placingEncounter.value = encounter;
    table()?.setPlacePreview(encounter.members);
  }

  function startBestiaryPlacement(placement: BestiaryPlacement) {
    bestiaryOpen.value = false;
    compendiumOpen.value = false;
    tool.value = 'place';
    placingEncounter.value = null;
    placingBestiary.value = placement;
  }

  function spawnBestiaryAt(point: Position) {
    const placement = placingBestiary.value;
    if (!placement || !sceneId.value) return;

    void run(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/bestiary/spawn`, 'POST', {
        monsters: placement.monsters, hp: placement.hp, disposition: placement.disposition, hidden: placement.hidden,
        sceneId: sceneId.value, x: point.x, z: point.z,
      });
      tool.value = 'select';
      await Promise.all([refresh(), loadLists()]);
      announceCopies(`На столе: ${placement.label}`, result.characters);
    });
  }

  async function onWizardCreated(created: { id: string; name: string }) {
    wizardOpen.value = false;
    pushToast({ tone: 'info', title: `Герой «${created.name}» создан`, detail: sceneId.value ? 'Стоит на текущей сцене.' : 'Лист — в «Отряде».' });
    await run(loadLists);
    if (sceneId.value) await placeOnScene(created.id);
  }

  function onBestiaryCreated(created: Array<{ id: string; name: string }>) {
    bestiaryOpen.value = false;
    compendiumOpen.value = false;
    announceCopies('Созданы из бестиария', created);
    void run(loadLists);
  }

  function onBestiarySaved(name: string) {
    bestiaryOpen.value = false;
    compendiumOpen.value = false;
    pushToast({ tone: 'info', title: `Встреча «${name}» сохранена`, detail: 'Расставить — в окне «Встречи».' });
    void encountersPanel.value?.load();
  }

  function deployEncounterAt(point: Position) {
    const encounter = placingEncounter.value;
    if (!encounter || !sceneId.value) return;

    void run(async () => {
      const result = await props.request(
        `/campaigns/${props.campaignId}/encounters/${encounter.id}/deploy`,
        'POST',
        { sceneId: sceneId.value, x: point.x, z: point.z },
      );
      tool.value = 'select';
      await Promise.all([refresh(), loadLists()]);
      announceCopies(`Встреча «${encounter.name}» расставлена`, result.characters);
    });
  }

  return { encounterCandidates, duplicateActive, startEncounterPlacement, startBestiaryPlacement, spawnBestiaryAt, onWizardCreated, onBestiaryCreated, onBestiarySaved, deployEncounterAt };
}
