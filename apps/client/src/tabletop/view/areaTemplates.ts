import { computed, watch, ref, type Ref, type ComputedRef } from 'vue';
import type { Tabletop } from '../scene';
import { footprintCells } from '../grid';
import type { TableToast } from '../toasts';
import { cssZoom } from '../../settings/uiScale';
import { openGameWindow } from '../layout/gameHud';
import type { TemplateRow } from '../../components/tabletop/AreaTemplates.vue';
import type { TriggerRow } from '../../components/tabletop/TriggersPanel.vue';
import { inAreaAt, type AreaShape } from '../areas';
import { conditionInfo } from '../../rules/conditions';
import type { TableHistory, HistoryEntry } from '../history';
import type { TemplateData, TrapData } from './mapHistory';
import type { TabletopProps, SceneDetail, SceneObjectDTO, TemplateDTO } from './types';

export type AreaTemplatesDeps = {
  props: TabletopProps;
  sceneDetail: Ref<SceneDetail | null>;
  objects: Ref<SceneObjectDTO[]>;
  templates: Ref<TemplateDTO[]>;
  templateShape: Ref<AreaShape>;
  templateSizeFeet: Ref<number>;
  templateAsTrigger: Ref<boolean>;
  triggers: Ref<Array<TriggerRow & { x: number | null; z: number | null; direction: number }>>;
  feetPerUnit: ComputedRef<number>;
  table: () => Tabletop | undefined;
  drawColor: Ref<string>;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  basePath: () => string;
  loadRolls: () => Promise<void>;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  history: TableHistory;
  templateData: (template: TemplateDTO) => TemplateData;
  templateAddedEntry: (templateId: string, data: TemplateData, label: string) => HistoryEntry;
  templateRemovedEntry: (templateId: string, data: TemplateData, label: string) => HistoryEntry;
  trapAddedEntry: (triggerId: string, data: TrapData, label: string) => HistoryEntry;
};

export function useAreaTemplates({ props, sceneDetail, objects, templates, templateShape, templateSizeFeet, templateAsTrigger, triggers, feetPerUnit, table, drawColor, pushToast, basePath, loadRolls, refresh, run, history, templateData, templateAddedEntry, templateRemovedEntry, trapAddedEntry }: AreaTemplatesDeps) {
  const templateAreas = computed(() => templates.value.map(template => ({
    id: template.id,
    shape: template.shape,
    x: template.x,
    z: template.z,
    direction: template.direction,
    size: template.size_feet / feetPerUnit.value,
    width: (template.width_feet ?? 5) / feetPerUnit.value,
    color: template.color,
    label: template.label,
  })));

  const templateRows = computed<TemplateRow[]>(() => templates.value.map((template, index) => {
    const area = templateAreas.value[index]!;
    const affected = objects.value
      .filter(object => object.kind !== 'object')
      .filter(object => {
        const n = footprintCells(object.size);
        const up = (object.flightHeight ?? 0) / feetPerUnit.value;
        for (let dz = 0; dz < n; dz += 1) {
          for (let dx = 0; dx < n; dx += 1) {
            if (inAreaAt(area, object.world_x - n / 2 + 0.5 + dx, object.world_z - n / 2 + 0.5 + dz, up)) return true;
          }
        }
        return false;
      })
      .map(object => object.name);
    return { ...template, affected };
  }));

  watch([templateShape, templateSizeFeet, drawColor, feetPerUnit], () => {
    table()?.setTemplateStyle({
      shape: templateShape.value,
      size: Math.max(1, templateSizeFeet.value || 5) / feetPerUnit.value,
      width: 5 / feetPerUnit.value,
      color: drawColor.value,
    });
  }, { immediate: true });

  function placeTemplate(placed: { x: number; z: number; direction: number }) {
    return run(async () => {
      const area = {
        shape: templateShape.value,
        x: placed.x,
        z: placed.z,
        direction: templateShape.value === 'circle' ? 0 : placed.direction,
        sizeFeet: Math.max(1, Math.min(1000, templateSizeFeet.value || 5)),
      };
      if (templateAsTrigger.value && sceneDetail.value?.canManage) {
        const trap = await props.request(`${basePath()}/triggers`, 'POST', { kind: 'enter', ...area, name: 'Ловушка' });
        history.record(trapAddedEntry(trap.id, area, 'ловушка'));
        openGameWindow('triggers');
        pushToast({ tone: 'info', title: 'Область-ловушка поставлена', detail: 'Настройте последствия в панели «Триггеры (мастер)».' });
        await refresh();
        return;
      }

      const data: TemplateData = { ...area, color: drawColor.value };
      const created = await props.request(`${basePath()}/templates`, 'POST', data);
      history.record(templateAddedEntry(created.id, data, 'область'));
      await refresh();
    });
  }

  function removeTemplate(templateId: string) {
    return run(async () => {
      const template = templates.value.find(entry => entry.id === templateId);
      await props.request(`${basePath()}/templates/${templateId}`, 'DELETE');
      if (template) history.record(templateRemovedEntry(template.id, templateData(template), 'удаление области'));
      await refresh();
    });
  }

  function rollTemplateSaves(payload: {
    templateId: string; ability: string; dc: number; hidden: boolean;
    effect?: { code: string; durationRounds?: number; repeatSave?: 'end' };
  }) {
    return run(async () => {
      const result = await props.request(`${basePath()}/templates/${payload.templateId}/saves`, 'POST', {
        ability: payload.ability, dc: payload.dc, hidden: payload.hidden, ...(payload.effect ? { effect: payload.effect } : {}),
      });
      const cover = (entry: any) => (entry.cover === 'half' ? ', укрытие +2' : entry.cover === 'three-quarters' ? ', укрытие +5' : '');
      const passed = result.results.filter((entry: any) => entry.success).map((entry: any) => `${entry.name} (${entry.total}${cover(entry)})`);
      const failed = result.results.filter((entry: any) => !entry.success)
        .map((entry: any) => `${entry.name} (${entry.autoFail ? 'автопровал' : entry.total}${cover(entry)})${entry.conditionApplied ? ` — ${conditionInfo(payload.effect!.code).label.toLowerCase()}` : ''}`);
      pushToast({
        tone: 'info',
        title: `Спасброски против СЛ ${payload.dc}`,
        detail: [passed.length ? `прошли: ${passed.join(', ')}` : '', failed.length ? `провалили: ${failed.join(', ')}` : ''].filter(Boolean).join('; '),
      }, 12000);
      await loadRolls();
    });
  }

  const triggerAreaList = computed(() => triggers.value
    .filter(trigger => trigger.kind === 'enter' && trigger.shape && trigger.x !== null && trigger.z !== null && trigger.size_feet)
    .map(trigger => ({
      id: trigger.id,
      area: {
        shape: trigger.shape as AreaShape,
        x: trigger.x!,
        z: trigger.z!,
        direction: Number(trigger.direction ?? 0),
        size: trigger.size_feet! / feetPerUnit.value,
        width: 5 / feetPerUnit.value,
      },
    })));
  const triggerAreas = computed(() => triggerAreaList.value.map(entry => entry.area));
  const trapPopover = ref<{ at: { x: number; y: number }; triggerId: string } | null>(null);
  watch([trapPopover, triggerAreaList], () => {
    const entry = trapPopover.value ? triggerAreaList.value.find(item => item.id === trapPopover.value!.triggerId) : undefined;
    if (trapPopover.value && !entry) trapPopover.value = null;
    table()?.setTriggerHighlight(entry?.area ?? null);
  });
  const trapPopoverStyle = computed(() => {
    const at = trapPopover.value?.at;
    if (!at) return {};
    const zoom = cssZoom.value || 1;
    const left = Math.max(8, Math.min(at.x / zoom + 12, window.innerWidth / zoom - 380));
    const top = Math.max(60, Math.min(at.y / zoom - 20, window.innerHeight / zoom - 156 - 12 - 420));
    return { left: `${left}px`, top: `${top}px` };
  });

  const triggerItems = computed(() => objects.value
    .filter(object => object.kind === 'object')
    .map(object => ({ id: object.character_id, name: object.name })));

  function onTriggersChanged(message: string) {
    pushToast({ tone: 'info', title: message });
    void run(refresh);
  }

  return { templateAreas, templateRows, placeTemplate, removeTemplate, rollTemplateSaves, triggerAreaList, triggerAreas, trapPopover, trapPopoverStyle, triggerItems, onTriggersChanged };
}
