import { wallCoords } from '../wallCoords';
import { fixedFormula } from '../../rules/dice';
import { confirmAction } from '../../ui/confirmDialog';
import { computed, type Ref, type ComputedRef } from 'vue';
import type { MultiSelection, WallStyle, WallSegment } from '../scene';
import { conditionInfo } from '../../rules/conditions';
import type { TabletopProps, SceneObjectDTO, InitiativeEntry, ObjectSave, WallGroupEntry, TemplateDTO } from './types';
import type { TemplateData } from './mapHistory';
import type { TableToast } from '../toasts';
import type { HistoryEntry, TableHistory } from '../history';

export type GroupActionsDeps = {
  props: TabletopProps;
  activeObjectId: Ref<string>;
  walls: Ref<WallSegment[]>;
  initiativeEntries: Ref<InitiativeEntry[]>;
  multiSelection: Ref<MultiSelection>;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  basePath: () => string;
  objectsPath: () => string;
  initiativePath: () => string;
  loadRolls: () => Promise<void>;
  loadInitiative: () => Promise<void>;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  queueObjectSave: (id: string, value: ObjectSave) => void;
  restyleWalls: (ids: string[] | null, style: WallStyle, textureAssetId?: string | null) => Promise<void>;
  objectStateOf: (object: SceneObjectDTO) => ObjectSave;
  history: TableHistory;
  rememberObjectEdit: (placementId: string, verb: string) => void;
  placementRemovedEntry: (placementId: string, characterId: string, state: ObjectSave, world: { x: number; y: number; z: number; }, label: string) => HistoryEntry;
  wallsRemovedEntry: (data: WallGroupEntry[], label: string) => HistoryEntry;
  templates: Ref<TemplateDTO[]>;
  templateData: (template: TemplateDTO) => TemplateData;
  templateRemovedEntry: (templateId: string, data: TemplateData, label: string) => HistoryEntry;
  selectedObjects: ComputedRef<SceneObjectDTO[]>;
  selectedCreatures: ComputedRef<SceneObjectDTO[]>;
  clearSelection: () => void;
};

export function useGroupActions({ props, activeObjectId, walls, initiativeEntries, multiSelection, pushToast, basePath, objectsPath, initiativePath, loadRolls, loadInitiative, refresh, run, queueObjectSave, restyleWalls, objectStateOf, history, rememberObjectEdit, placementRemovedEntry, wallsRemovedEntry, templates, templateData, templateRemovedEntry, selectedObjects, selectedCreatures, clearSelection }: GroupActionsDeps) {
  function hideSelection(hidden: boolean) {
    for (const object of selectedObjects.value.filter(entry => entry.canEdit && entry.hidden !== hidden)) {
      rememberObjectEdit(object.id, hidden ? 'скрытие' : 'показ');
      queueObjectSave(object.id, { ...objectStateOf(object), hidden });
    }
  }
  function conditionSelection(code: string) {
    const ids = selectedCreatures.value.map(object => object.character_id).slice(0, 30);
    if (!ids.length) return;
    return run(async () => {
      await props.request(`/campaigns/${props.campaignId}/conditions/apply`, 'POST', { targetIds: ids, code });
      pushToast({ tone: 'info', title: conditionInfo(code).label, detail: `Наложено: ${selectedCreatures.value.map(object => object.name).join(', ')}.` });
      await refresh();
    });
  }
  function hpSelection(mode: 'damage' | 'heal', amount: number) {
    const targets = selectedCreatures.value;
    if (!targets.length || amount < 1) return;
    return run(async () => {
      const roll = await props.request(`/campaigns/${props.campaignId}/rolls`, 'POST', {
        formula: fixedFormula(amount), label: `${mode === 'damage' ? 'Урон' : 'Лечение'} → ${targets.map(object => object.name).join(', ')}`.slice(0, 100),
      });
      for (const object of targets) {
        await props.request(`/campaigns/${props.campaignId}/rolls/${roll.id}/apply`, 'POST', { characterId: object.character_id, mode });
      }
      await Promise.all([loadRolls(), refresh()]);
    });
  }
  const downedSelected = computed(() => selectedCreatures.value.filter(object => (object.conditions ?? []).includes('dead') || (object.hp !== null && object.hp.current <= 0)));
  function reviveSelection(options: { hp: 'one' | 'half' | 'full'; clearExhaustion: boolean; clearConditions: boolean }) {
    const targets = downedSelected.value;
    if (!targets.length) return;
    return run(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/characters/revive`, 'POST', {
        characterIds: targets.map(object => object.character_id), ...options,
      });
      if (result.skipped?.length) pushToast({ tone: 'info', title: 'Не воскрешены', detail: result.skipped.map((entry: { name: string; reason: string }) => `${entry.name} — ${entry.reason}`).join(', ') });
      await refresh();
    });
  }
  function combatSelection() {
    const joining = selectedCreatures.value.filter(object => !initiativeEntries.value.some(entry => entry.character_id === object.character_id));
    if (!joining.length) return;
    return run(async () => {
      for (const object of joining) await props.request(`${initiativePath()}/join`, 'POST', { characterId: object.character_id });
      await loadInitiative();
    });
  }
  function wallStyleSelection(style: WallStyle) {
    if (!style || !multiSelection.value.walls.length) return;
    return restyleWalls([...multiSelection.value.walls], style, null);
  }
  async function removeSelection() {
    const removing = selectedObjects.value.filter(object => object.canEdit);
    const wallIds = [...multiSelection.value.walls];
    const templateIds = [...multiSelection.value.templates];
    const total = removing.length + wallIds.length + templateIds.length;
    if (!total || !(await confirmAction(`Убрать со сцены выделенное (${total})? Объекты и их листы останутся в кампании.`, { title: 'Убрать', confirmLabel: 'Убрать', danger: true }))) return;
    return run(async () => {
      for (const object of removing) {
        const state = objectStateOf(object);
        await props.request(`${objectsPath()}/${object.id}`, 'DELETE');
        history.record(placementRemovedEntry(object.id, object.character_id, state, { x: object.world_x, y: object.world_y, z: object.world_z }, `снятие «${object.name}» со сцены`));
      }
      if (wallIds.length) {
        const removed = walls.value.filter(wall => wallIds.includes(wall.id)).map(wall => ({ id: wall.id, coords: wallCoords(wall) }));
        await props.request(`${basePath()}/walls/remove`, 'POST', { ids: wallIds });
        history.record(wallsRemovedEntry(removed, 'выделенные стены'));
      }
      for (const id of templateIds) {
        const template = templates.value.find(entry => entry.id === id);
        await props.request(`${basePath()}/templates/${id}`, 'DELETE');
        if (template) history.record(templateRemovedEntry(id, templateData(template), 'удаление области'));
      }
      if (removing.some(object => object.id === activeObjectId.value)) activeObjectId.value = '';
      clearSelection();
      await refresh();
    });
  }

  return { hideSelection, conditionSelection, hpSelection, downedSelected, reviveSelection, combatSelection, wallStyleSelection, removeSelection };
}
