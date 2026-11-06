import type { Ref, ComputedRef } from 'vue';
import { confirmAction } from '../../ui/confirmDialog';
import type { ObjectTransform } from '../scene';
import { type Position, footprintCells, snapFootprint } from '../grid';
import type { TabletopProps, SceneDetail, SceneObjectDTO, LibraryAsset, ObjectSave, LivePoint } from './types';
import type { LiveKind } from '../live';
import type { TableHistory, HistoryEntry } from '../history';

export type ObjectTransformsDeps = {
  props: TabletopProps;
  sceneId: Ref<string>;
  sceneDetail: Ref<SceneDetail | null>;
  objects: Ref<SceneObjectDTO[]>;
  library: Ref<LibraryAsset[]>;
  activeObjectId: Ref<string>;
  selectedLibraryAssetId: Ref<string>;
  newObjectName: Ref<string>;
  editY: Ref<number>;
  editRotation: Ref<number>;
  editScale: Ref<number>;
  editSnap: Ref<boolean>;
  editParentId: Ref<string>;
  editAnimationName: Ref<string>;
  editHidden: Ref<boolean>;
  disposed: () => boolean;
  activeObject: ComputedRef<SceneObjectDTO | undefined>;
  objectsPath: () => string;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  loadLists: () => Promise<void>;
  queueObjectSave: (id: string, value: ObjectSave) => void;
  finishLiveGrab: (kind: LiveKind, id: string, point: LivePoint) => boolean;
  rememberObjectEdit: (placementId: string, verb: string) => void;
  history: TableHistory;
  placementAddedEntry: (placementId: string, label: string) => HistoryEntry;
  objectStateOf: (object: SceneObjectDTO) => ObjectSave;
  placementRemovedEntry: (placementId: string, characterId: string, state: ObjectSave, world: { x: number; y: number; z: number; }, label: string) => HistoryEntry;
};

export function useObjectTransforms({ props, sceneId, sceneDetail, objects, library, activeObjectId, selectedLibraryAssetId, newObjectName, editY, editRotation, editScale, editSnap, editParentId, editAnimationName, editHidden, disposed, activeObject, objectsPath, refresh, run, loadLists, queueObjectSave, finishLiveGrab, rememberObjectEdit, history, placementAddedEntry, objectStateOf, placementRemovedEntry }: ObjectTransformsDeps) {
  function moveObject(point: Position) {
    const object = activeObject.value;
    if (!object || !object.canMove || !sceneDetail.value) return;

    let x = point.x;
    let z = point.z;

    if (object.snap_to_grid) {
      const footprint = footprintCells(object.size);
      x = snapFootprint(x, sceneDetail.value.width_cells, footprint);
      z = snapFootprint(z, sceneDetail.value.height_cells, footprint);
    }

    const parent = object.parent_object_id
      ? objects.value.find(o => o.id === object.parent_object_id)
      : undefined;

    const localX = parent ? x - parent.world_x : x;
    const localZ = parent ? z - parent.world_z : z;

    rememberObjectEdit(object.id, 'перемещение');
    queueObjectSave(object.id, {
      x: localX,
      y: object.y,
      z: localZ,
      rotationY: object.rotation_y,
      scale: object.scale,
      snapToGrid: object.snap_to_grid,
      parentObjectId: object.parent_object_id,
      animationName: object.animation_name,
      hidden: object.hidden,
    });
  }

  function onObjectTransform(objectId: string, transform: ObjectTransform) {
    if (finishLiveGrab('object', objectId, transform)) {
      rememberObjectEdit(objectId, 'перемещение');
      return;
    }

    const object = objects.value.find(o => o.id === objectId);
    if (!object || !sceneDetail.value) return;

    let x = transform.x;
    let z = transform.z;

    if (object.snap_to_grid) {
      const footprint = footprintCells(object.size);
      x = snapFootprint(x, sceneDetail.value.width_cells, footprint);
      z = snapFootprint(z, sceneDetail.value.height_cells, footprint);
    }

    const parent = object.parent_object_id
      ? objects.value.find(o => o.id === object.parent_object_id)
      : undefined;

    const localX = parent ? x - parent.world_x : x;
    const localY = parent ? transform.y - parent.world_y : transform.y;
    const localZ = parent ? z - parent.world_z : z;
    const rotationY = ((transform.rotationY % 360) + 360) % 360;
    const scale = Math.min(50, Math.max(0.1, transform.scale));

    if (activeObjectId.value === object.id) {
      editY.value = localY;
      editRotation.value = rotationY;
      editScale.value = scale;
    }

    rememberObjectEdit(object.id, 'перемещение');
    queueObjectSave(object.id, {
      x: localX,
      y: localY,
      z: localZ,
      rotationY,
      scale,
      snapToGrid: object.snap_to_grid,
      parentObjectId: object.parent_object_id,
      animationName: object.animation_name,
      hidden: object.hidden,
    });
  }

  function onModelFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) return;

    return run(async () => {
      const uploaded = await props.request(
        `/campaigns/${props.campaignId}/assets?kind=object_model`,
        'POST',
        undefined,
        file,
      );

      const list = await props.request(
        `/campaigns/${props.campaignId}/assets?kind=object_model`,
      );

      if (disposed()) return;

      library.value = list.assets;
      selectedLibraryAssetId.value = uploaded.id;
    });
  }

  function createObjectFromModel() {
    return run(async () => {
      if (!sceneId.value || !selectedLibraryAssetId.value) return;

      const created = await props.request(`/campaigns/${props.campaignId}/characters`, 'POST', {
        kind: 'object',
        name: newObjectName.value.trim() || 'Объект',
        modelAssetId: selectedLibraryAssetId.value,
      });
      const placed = await props.request(objectsPath(), 'POST', { characterId: created.id });
      history.record(placementAddedEntry(placed.id, `постановка «${created.name}»`));

      await loadLists();
      await refresh();

      if (!disposed()) {
        activeObjectId.value = placed.id;
        newObjectName.value = '';
      }
    });
  }

  function saveObjectTransform() {
    const object = activeObject.value;
    if (!object) return;

    rememberObjectEdit(object.id, 'правка');
    queueObjectSave(object.id, {
      x: object.x,
      y: editY.value,
      z: object.z,
      rotationY: ((editRotation.value % 360) + 360) % 360,
      scale: editScale.value,
      snapToGrid: editSnap.value,
      parentObjectId: editParentId.value || null,
      animationName: editAnimationName.value || null,
      hidden: editHidden.value,
    });
  }

  async function removeFromScene() {
    const object = activeObject.value;
    if (!object || !object.canEdit) return;
    if (!(await confirmAction(`Убрать «${object.name}» со сцены? Сам объект и его лист останутся в кампании, прикреплённое к нему останется на месте.`, { title: 'Убрать', confirmLabel: 'Убрать', danger: true }))) return;

    const state = objectStateOf(object);
    const world = { x: object.world_x, y: object.world_y, z: object.world_z };

    return run(async () => {
      await props.request(`${objectsPath()}/${object.id}`, 'DELETE');
      history.record(placementRemovedEntry(object.id, object.character_id, state, world, `снятие «${object.name}» со сцены`));
      activeObjectId.value = '';

      await refresh();
    });
  }

  return { moveObject, onObjectTransform, onModelFileChange, createObjectFromModel, saveObjectTransform, removeFromScene };
}
