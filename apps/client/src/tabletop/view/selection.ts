import { computed, watch, ref, type Ref, type ComputedRef } from 'vue';
import type { MultiSelection, WallSegment, Tabletop, TableTool } from '../scene';
import type { Position } from '../grid';
import { inArea, type AreaShape } from '../areas';
import type { PickClass, TabletopProps, SceneObjectDTO, TemplateDTO, WallTool, ObjectSave } from './types';
import type { HistoryEntry, TableHistory } from '../history';

export type SelectionDeps = {
  props: TabletopProps;
  viewOnly: boolean;
  objects: Ref<SceneObjectDTO[]>;
  walls: Ref<WallSegment[]>;
  templates: Ref<TemplateDTO[]>;
  wallTool: Ref<WallTool | null>;
  terrainMode: Ref<boolean>;
  busy: Ref<boolean>;
  table: () => Tabletop | undefined;
  multiSelection: Ref<MultiSelection>;
  multiCount: ComputedRef<number>;
  tool: Ref<TableTool>;
  activeObject: ComputedRef<SceneObjectDTO | undefined>;
  basePath: () => string;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  saveObjectNow: (objectId: string, body: ObjectSave, refreshAfter?: boolean) => Promise<void>;
  objectStateOf: (object: SceneObjectDTO) => ObjectSave;
  history: TableHistory;
  objectEditEntry: (placementId: string, before: ObjectSave, label: string) => HistoryEntry;
  rememberTemplateEdit: (templateId: string, label: string) => void;
  templateAreas: ComputedRef<{ id: string; shape: AreaShape; x: number; z: number; direction: number; size: number; width: number; color: string; label: string | null; }[]>;
};

export function useSelection({ props, viewOnly, objects, walls, templates, wallTool, terrainMode, busy, table, multiSelection, multiCount, tool, activeObject, basePath, refresh, run, saveObjectNow, objectStateOf, history, objectEditEntry, rememberTemplateEdit, templateAreas }: SelectionDeps) {
  const selectedObjects = computed(() => objects.value.filter(object => multiSelection.value.objects.includes(object.id)));
  const selectedCreatures = computed(() => selectedObjects.value.filter(object => object.kind !== 'object'));
  watch(multiSelection, value => table()?.setMultiSelection(value), { deep: true });
  watch([objects, walls, templates], () => {
    const value = multiSelection.value;
    const next = {
      objects: value.objects.filter(id => objects.value.some(object => object.id === id)),
      walls: value.walls.filter(id => walls.value.some(wall => wall.id === id)),
      templates: value.templates.filter(id => templates.value.some(template => template.id === id)),
    };
    if (next.objects.length !== value.objects.length || next.walls.length !== value.walls.length || next.templates.length !== value.templates.length) multiSelection.value = next;
  });

  function toggleIn(list: string[], id: string) {
    return list.includes(id) ? list.filter(entry => entry !== id) : [...list, id];
  }
  const selectionClass = ref<PickClass | null>(null);
  watch(multiCount, count => { if (!count) selectionClass.value = null; });
  const objectClass = (objectId: string): PickClass => (objects.value.find(entry => entry.id === objectId)?.kind === 'object' ? 'things' : 'creatures');
  function onMultiPick(pick: { objectId: string | null; wallId: string | null; point: Position | null }) {
    const value = multiSelection.value;
    if (!multiCount.value) selectionClass.value = pick.objectId ? objectClass(pick.objectId) : pick.wallId ? 'walls' : 'areas';
    if (pick.objectId) multiSelection.value = { ...value, objects: toggleIn(value.objects, pick.objectId) };
    else if (pick.wallId) multiSelection.value = { ...value, walls: toggleIn(value.walls, pick.wallId) };
    else if (pick.point) {
      const area = templateAreas.value.find(entry => inArea(entry, pick.point!.x, pick.point!.z));
      if (area) multiSelection.value = { ...value, templates: toggleIn(value.templates, area.id) };
    }
  }
  function onMarquee(found: MultiSelection) {
    const value = multiSelection.value;
    const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
    const first = selectionClass.value ?? (activeObject.value ? objectClass(activeObject.value.id) : null);
    const take = (kind: PickClass) => !first || first === kind;
    const picked = {
      objects: found.objects.filter(id => take(objectClass(id))),
      walls: take('walls') ? found.walls : [],
      templates: take('areas') ? found.templates : [],
    };
    if (!multiCount.value && first && activeObject.value && !picked.objects.includes(activeObject.value.id)) picked.objects.unshift(activeObject.value.id);
    multiSelection.value = { objects: union(value.objects, picked.objects), walls: union(value.walls, picked.walls), templates: union(value.templates, picked.templates) };
    if (!selectionClass.value && multiCount.value) {
      selectionClass.value = first
        ?? (picked.objects.some(id => objectClass(id) === 'creatures') ? 'creatures' : picked.objects.length ? 'things' : picked.walls.length ? 'walls' : 'areas');
    }
  }
  function clearSelection() {
    multiSelection.value = { objects: [], walls: [], templates: [] };
  }

  const groupMovers = computed(() => {
    const chosen = new Set(multiSelection.value.objects);
    return selectedObjects.value.filter(object => object.canMove && !(object.parent_object_id && chosen.has(object.parent_object_id)));
  });
  const groupTemplates = computed(() => templates.value.filter(template => multiSelection.value.templates.includes(template.id)));
  const groupCenter = computed(() => {
    const points = [
      ...groupMovers.value.map(object => ({ x: object.world_x, z: object.world_z })),
      ...groupTemplates.value.map(template => ({ x: Number(template.x), z: Number(template.z) })),
    ];
    if (!points.length) return null;
    return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, z: points.reduce((sum, point) => sum + point.z, 0) / points.length, points };
  });

  // Leading objects move first, otherwise a tight group blocks itself.
  function moveSelection(dx: number, dz: number) {
    if (!dx && !dz) return;
    const movers = [...groupMovers.value].sort((a, b) => (b.world_x * dx + b.world_z * dz) - (a.world_x * dx + a.world_z * dz));
    const moving = groupTemplates.value;
    if (!movers.length && !moving.length) return;
    const formation = movers.map(object => object.id);
    return run(async () => {
      const failed: string[] = [];
      for (const object of movers) {
        const before = objectStateOf(object);
        try {
          await saveObjectNow(object.id, { ...before, x: Number(object.x) + dx, z: Number(object.z) + dz, formation }, false);
          history.record(objectEditEntry(object.id, before, `сдвиг «${object.name}»`));
        } catch (cause) {
          failed.push(`${object.name} — ${cause instanceof Error ? cause.message : 'не сдвинулся'}`);
        }
      }
      for (const template of moving) {
        rememberTemplateEdit(template.id, 'сдвиг области');
        await props.request(`${basePath()}/templates/${template.id}`, 'PATCH', { x: Number(template.x) + dx, z: Number(template.z) + dz });
      }
      await refresh();
      if (failed.length) throw new Error(`Не все сдвинулись: ${failed.join('; ')}`);
    });
  }

  function rotateSelection(quarterTurns: number) {
    const center = groupCenter.value;
    const turns = ((quarterTurns % 4) + 4) % 4;
    if (!center || !turns) return;
    const pivot = { x: Math.floor(center.x) + 0.5, z: Math.floor(center.z) + 0.5 };
    const turn = (x: number, z: number) => {
      let dx = x - pivot.x;
      let dz = z - pivot.z;
      for (let step = 0; step < turns; step++) [dx, dz] = [dz, -dx];
      return { x: pivot.x + dx, z: pivot.z + dz };
    };
    const movers = groupMovers.value;
    const areas = groupTemplates.value;
    const formation = movers.map(object => object.id);
    return run(async () => {
      const failed: string[] = [];
      for (const object of movers) {
        const before = objectStateOf(object);
        const to = turn(Number(object.x), Number(object.z));
        try {
          await saveObjectNow(object.id, { ...before, x: to.x, z: to.z, rotationY: (Number(object.rotation_y) + turns * 90) % 360, formation }, false);
          history.record(objectEditEntry(object.id, before, `поворот строя «${object.name}»`));
        } catch (cause) {
          failed.push(`${object.name} — ${cause instanceof Error ? cause.message : 'не повернулся'}`);
        }
      }
      for (const template of areas) {
        const to = turn(Number(template.x), Number(template.z));
        rememberTemplateEdit(template.id, 'поворот области');
        await props.request(`${basePath()}/templates/${template.id}`, 'PATCH', { x: to.x, z: to.z });
      }
      await refresh();
      if (failed.length) throw new Error(`Не все повернулись: ${failed.join('; ')}`);
    });
  }

  const groupMenu = ref<{ at: { x: number; y: number } } | null>(null);
  watch(multiCount, count => { if (count < 2) groupMenu.value = null; });
  watch(busy, (now, before) => { if (before && !now) groupMenu.value = null; });

  function moveSelectionTo(point: Position) {
    const center = groupCenter.value;
    if (!center) return;
    return moveSelection(Math.round(point.x - center.x), Math.round(point.z - center.z));
  }
  const groupMoveActive = computed(() => Boolean(groupCenter.value) && tool.value === 'select' && !wallTool.value && !terrainMode.value && !viewOnly);
  watch([groupMoveActive, groupCenter], () => {
    table()?.setGroupPreview(groupMoveActive.value && groupCenter.value ? { center: groupCenter.value, points: groupCenter.value.points } : null);
  });
  return { selectedObjects, selectedCreatures, onMultiPick, onMarquee, clearSelection, groupCenter, moveSelection, rotateSelection, groupMenu, moveSelectionTo, groupMoveActive };
}
