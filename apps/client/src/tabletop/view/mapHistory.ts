import { wallCoords } from '../wallCoords';
import { watch, type Ref } from 'vue';
import type { WallSegment, Drawing } from '../scene';
import { createHistory, type HistoryEntry, type TableHistory } from '../history';
import type { AreaShape } from '../areas';
import type { SceneObjectDTO, ObjectSave, WallGroupEntry, WallCoords, DrawingData, SceneSize, TabletopProps, SceneDetail, TemplateDTO } from './types';

export type TemplateData = { shape: AreaShape; x: number; z: number; direction: number; sizeFeet: number; widthFeet?: number; color: string; label?: string };
export type TrapData = { shape: AreaShape; x: number; z: number; direction: number; sizeFeet: number };

export type MapHistoryDeps = {
  props: TabletopProps;
  sceneId: Ref<string>;
  sceneDetail: Ref<SceneDetail | null>;
  objects: Ref<SceneObjectDTO[]>;
  activeObjectId: Ref<string>;
  walls: Ref<WallSegment[]>;
  drawings: Ref<Array<Drawing & { created_by: string; author_name: string }>>;
  templates: Ref<TemplateDTO[]>;
  triggers: Ref<Array<{ id: string }>>;
  sizeWidthInput: Ref<number>;
  sizeHeightInput: Ref<number>;
  sizeFeetInput: Ref<number>;
  sizeVisionRadiusInput: Ref<number | null>;
  sizeLightingInput: Ref<'bright' | 'dim' | 'dark'>;
  drawingsPath: () => string;
  basePath: () => string;
  objectsPath: () => string;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  freshRevision: (id: string, listed: number) => number;
  rememberSaved: (objectId: string, result: { x: number; y: number; z: number; rotation_y: number; scale: number; revision: number }) => void;
};

export function useMapHistory({ props, sceneId, sceneDetail, objects, activeObjectId, walls, drawings, templates, triggers, sizeWidthInput, sizeHeightInput, sizeFeetInput, sizeVisionRadiusInput, sizeLightingInput, drawingsPath, basePath, objectsPath, refresh, run, freshRevision, rememberSaved }: MapHistoryDeps) {
  const history: TableHistory = createHistory();
  const aliases = new Map<string, string>();

  function resolveId(id: string) {
    let current = id;
    for (let step = 0; step < 50 && aliases.has(current); step += 1) current = aliases.get(current)!;
    return current;
  }

  function objectStateOf(object: SceneObjectDTO): ObjectSave {
    return {
      x: Number(object.x),
      y: Number(object.y),
      z: Number(object.z),
      rotationY: Number(object.rotation_y),
      scale: Number(object.scale),
      snapToGrid: object.snap_to_grid,
      parentObjectId: object.parent_object_id,
      animationName: object.animation_name,
      hidden: object.hidden,
    };
  }

  function sameObjectState(a: ObjectSave, b: ObjectSave) {
    const near = (p: number, q: number) => Math.abs(p - q) < 1e-6;
    return near(a.x, b.x) && near(a.y, b.y) && near(a.z, b.z) &&
      near(a.rotationY, b.rotationY) && near(a.scale, b.scale) &&
      a.snapToGrid === b.snapToGrid && a.parentObjectId === b.parentObjectId &&
      a.animationName === b.animationName && a.hidden === b.hidden;
  }

  async function putObjectState(objectId: string, state: ObjectSave) {
    const listed = objects.value.find(object => object.id === objectId);
    if (!listed) return;

    const parentId = state.parentObjectId ? resolveId(state.parentObjectId) : null;
    const parentHere = parentId !== null && objects.value.some(object => object.id === parentId);
    const result = await props.request(`${objectsPath()}/${objectId}`, 'PUT', {
      ...state,
      parentObjectId: parentHere ? parentId : null,
      revision: freshRevision(objectId, listed.revision),
    });

    rememberSaved(objectId, result);
  }

  function objectEditEntry(placementId: string, before: ObjectSave, label: string): HistoryEntry {
    return {
      label,
      revert: async () => {
        const id = resolveId(placementId);
        const current = objects.value.find(object => object.id === id);
        if (!current) return null;

        const now = objectStateOf(current);
        if (sameObjectState(now, before)) return 'noop';

        await putObjectState(id, before);
        return objectEditEntry(id, now, label);
      },
    };
  }

  function rememberObjectEdit(placementId: string, verb: string) {
    const object = objects.value.find(o => o.id === placementId);
    if (object) history.record(objectEditEntry(object.id, objectStateOf(object), `${verb} «${object.name}»`));
  }

  function placementAddedEntry(placementId: string, label: string): HistoryEntry {
    return {
      label,
      revert: async () => {
        const id = resolveId(placementId);
        const current = objects.value.find(object => object.id === id);
        if (!current) return null;

        const state = objectStateOf(current);
        const world = { x: current.world_x, y: current.world_y, z: current.world_z };
        await props.request(`${objectsPath()}/${id}`, 'DELETE');
        if (activeObjectId.value === id) activeObjectId.value = '';
        return placementRemovedEntry(id, current.character_id, state, world, label);
      },
    };
  }

  function placementRemovedEntry(
    placementId: string,
    characterId: string,
    state: ObjectSave,
    world: { x: number; y: number; z: number },
    label: string,
  ): HistoryEntry {
    return {
      label,
      revert: async () => {
        const parentId = state.parentObjectId ? resolveId(state.parentObjectId) : null;
        const parentHere = parentId !== null && objects.value.some(object => object.id === parentId);
        const at = parentHere ? state : { ...state, x: world.x, y: world.y, z: world.z };

        const created = await props.request(objectsPath(), 'POST', {
          characterId,
          x: at.x,
          y: at.y,
          z: at.z,
          rotationY: at.rotationY,
          scale: at.scale,
          snapToGrid: at.snapToGrid,
          hidden: at.hidden,
          ...(parentHere ? { parentObjectId: parentId } : {}),
        });

        aliases.set(placementId, created.id);
        return placementAddedEntry(created.id, label);
      },
    };
  }
  function wallsAddedEntry(created: WallSegment[], label: string): HistoryEntry {
    const data = created.map(wall => ({ id: wall.id, coords: wallCoords(wall) }));
    return {
      label,
      revert: async () => {
        const present = data.map(entry => ({ ...entry, id: resolveId(entry.id) })).filter(entry => walls.value.some(wall => wall.id === entry.id));
        if (!present.length) return null;
        await props.request(`${basePath()}/walls/remove`, 'POST', { ids: present.map(entry => entry.id) });
        return wallsRemovedEntry(present, label);
      },
    };
  }

  function wallsRemovedEntry(data: WallGroupEntry[], label: string): HistoryEntry {
    return {
      label,
      revert: async () => {
        const groups = new Map<string, WallGroupEntry[]>();
        for (const entry of data) {
          const key = `${entry.coords.style ?? 'stone'}|${entry.coords.textureAssetId ?? ''}`;
          groups.set(key, [...(groups.get(key) ?? []), entry]);
        }
        const created: WallSegment[] = [];
        for (const group of groups.values()) {
          const look = group[0]!.coords;
          const result = await props.request(`${basePath()}/walls/batch`, 'POST', {
            walls: group.map(({ coords }) => ({ x1: coords.x1, z1: coords.z1, x2: coords.x2, z2: coords.z2 })),
            style: look.style ?? 'stone', ...(look.textureAssetId ? { textureAssetId: look.textureAssetId } : {}),
          });
          result.walls.forEach((wall: WallSegment, index: number) => aliases.set(group[index]!.id, wall.id));
          created.push(...result.walls);
        }
        return wallsAddedEntry(created, label);
      },
    };
  }

  function wallAddedEntry(wallId: string, coords: WallCoords, label: string): HistoryEntry {
    return {
      label,
      revert: async () => {
        const id = resolveId(wallId);
        if (!walls.value.some(wall => wall.id === id)) return null;
        await props.request(`${basePath()}/walls/${id}`, 'DELETE');
        return wallRemovedEntry(id, coords, label);
      },
    };
  }

  function wallRemovedEntry(wallId: string, coords: WallCoords, label: string): HistoryEntry {
    return {
      label,
      revert: async () => {
        const created = await props.request(`${basePath()}/walls`, 'POST', coords);
        aliases.set(wallId, created.id);
        return wallAddedEntry(created.id, coords, label);
      },
    };
  }

  function drawingAddedEntry(drawingId: string, data: DrawingData, label: string): HistoryEntry {
    return {
      label,
      revert: async () => {
        const id = resolveId(drawingId);
        if (!drawings.value.some(drawing => drawing.id === id)) return null;
        await props.request(`${drawingsPath()}/${id}`, 'DELETE');
        return drawingRemovedEntry(id, data, label);
      },
    };
  }

  function drawingRemovedEntry(drawingId: string, data: DrawingData, label: string): HistoryEntry {
    return {
      label,
      revert: async () => {
        const created = await props.request(drawingsPath(), 'POST', data);
        aliases.set(drawingId, created.id);
        return drawingAddedEntry(created.id, data, label);
      },
    };
  }

  function templateData(template: TemplateDTO): TemplateData {
    return {
      shape: template.shape, x: Number(template.x), z: Number(template.z), direction: Number(template.direction ?? 0),
      sizeFeet: Number(template.size_feet), color: template.color,
      ...(template.width_feet != null ? { widthFeet: Number(template.width_feet) } : {}),
      ...(template.label ? { label: template.label } : {}),
    };
  }

  function templateAddedEntry(templateId: string, data: TemplateData, label: string): HistoryEntry {
    return {
      label,
      revert: async () => {
        const id = resolveId(templateId);
        if (!templates.value.some(template => template.id === id)) return null;
        await props.request(`${basePath()}/templates/${id}`, 'DELETE');
        return templateRemovedEntry(id, data, label);
      },
    };
  }

  function templateRemovedEntry(templateId: string, data: TemplateData, label: string): HistoryEntry {
    return {
      label,
      revert: async () => {
        const created = await props.request(`${basePath()}/templates`, 'POST', data);
        aliases.set(templateId, created.id);
        return templateAddedEntry(created.id, data, label);
      },
    };
  }

  function templateEditEntry(templateId: string, before: TemplateData, label: string): HistoryEntry {
    return {
      label,
      revert: async () => {
        const id = resolveId(templateId);
        const current = templates.value.find(template => template.id === id);
        if (!current) return null;
        const now = templateData(current);
        if (JSON.stringify(now) === JSON.stringify(before)) return 'noop';
        await props.request(`${basePath()}/templates/${id}`, 'PATCH', { ...before, label: before.label ?? null });
        return templateEditEntry(id, now, label);
      },
    };
  }

  function rememberTemplateEdit(templateId: string, label: string) {
    const template = templates.value.find(entry => entry.id === templateId);
    if (template) history.record(templateEditEntry(template.id, templateData(template), label));
  }

  function trapAddedEntry(triggerId: string, data: TrapData, label: string): HistoryEntry {
    return {
      label,
      revert: async () => {
        const id = resolveId(triggerId);
        if (!triggers.value.some(trigger => trigger.id === id)) return null;
        await props.request(`${basePath()}/triggers/${id}`, 'DELETE');
        return trapRemovedEntry(id, data, label);
      },
    };
  }

  function trapRemovedEntry(triggerId: string, data: TrapData, label: string): HistoryEntry {
    return {
      label,
      revert: async () => {
        const created = await props.request(`${basePath()}/triggers`, 'POST', { kind: 'enter', ...data, name: 'Ловушка' });
        aliases.set(triggerId, created.id);
        return trapAddedEntry(created.id, data, label);
      },
    };
  }

  function currentSceneSize(): SceneSize | null {
    const detail = sceneDetail.value;
    if (!detail) return null;
    return {
      widthCells: detail.width_cells,
      heightCells: detail.height_cells,
      feetPerUnit: detail.feet_per_unit,
      defaultVisionRadiusFeet: detail.default_vision_radius_feet,
      lighting: detail.lighting ?? 'bright',
    };
  }

  function sceneSizeEntry(before: SceneSize, label: string): HistoryEntry {
    return {
      label,
      revert: async () => {
        const now = currentSceneSize();
        if (!now) return null;
        if (JSON.stringify(now) === JSON.stringify(before)) return 'noop';
        await props.request(basePath(), 'PATCH', before);
        sizeWidthInput.value = before.widthCells;
        sizeHeightInput.value = before.heightCells;
        sizeFeetInput.value = before.feetPerUnit;
        sizeVisionRadiusInput.value = before.defaultVisionRadiusFeet;
        sizeLightingInput.value = before.lighting;
        return sceneSizeEntry(now, label);
      },
    };
  }

  function stepHistory(direction: 'undo' | 'redo') {
    if (history.running.value) return;

    return run(async () => {
      await refresh();
      await (direction === 'undo' ? history.undo() : history.redo());
      await refresh();
    });
  }

  watch(sceneId, () => {
    history.clear();
    aliases.clear();
  });

  return {
    history, objectStateOf, objectEditEntry, rememberObjectEdit, placementAddedEntry, placementRemovedEntry, wallsAddedEntry, wallsRemovedEntry,
    wallAddedEntry, wallRemovedEntry, drawingAddedEntry, drawingRemovedEntry, templateData, templateAddedEntry, templateRemovedEntry,
    rememberTemplateEdit, trapAddedEntry, currentSceneSize, sceneSizeEntry, stepHistory,
  };
}
