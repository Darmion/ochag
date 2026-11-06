import { TransformNode, Quaternion, Scene } from '@babylonjs/core';
import type { LabelApi, OverlayLabel } from './labels';
import type { ObjectRecord, PlacedObject, ObjectContent } from '../sceneTypes';

const HIDDEN_VISIBILITY = 0.45;

export type ObjectApplyDeps = Pick<LabelApi, 'removeLabel'> & {
  scene: Scene;
  objectEntries: Map<string, ObjectRecord>;
  animationIndex: (assetId: string, name: string) => number;
  appearanceKey: (object: PlacedObject) => string;
  buildContent: (holder: TransformNode, object: PlacedObject) => Promise<ObjectContent>;
  selectedId: () => string | null;
  setActiveObject: (objectId: string | null, canMove: boolean) => void;
  refreshActiveObject: (objectId: string) => void;
  draggingId: () => string | null;
  syncHandleFromRoot: (root: TransformNode) => void;
  dropLivePose: (objectId: string) => void;
  isLivePosed: (objectId: string) => boolean;
  moveRoot: (objectId: string, root: TransformNode, x: number, y: number, z: number, rotationY: number, scale: number, glide: boolean) => void;
  makeLabel: (objectId: string) => OverlayLabel | null;
  makeHpBar: (objectId: string) => OverlayLabel | null;
  refreshLabel: (objectId: string) => void;
  refreshHpBar: (record: ObjectRecord) => void;
  refreshGlow: (record: ObjectRecord) => void;
  multi: () => { objects: Set<string>; walls: Set<string>; templates: Set<string>; };
  refreshAim: () => void;
  refreshMulti: () => void;
};

export function createObjectApply({
  scene, removeLabel, objectEntries, animationIndex, appearanceKey, buildContent, selectedId,
  setActiveObject, refreshActiveObject, draggingId, syncHandleFromRoot, dropLivePose,
  isLivePosed, moveRoot, makeLabel, makeHpBar, refreshLabel, refreshHpBar, refreshGlow, multi,
  refreshAim, refreshMulti,
}: ObjectApplyDeps) {
  function markObjectMeshes(record: ObjectRecord) {
    for (const mesh of record.content.meshes()) {
      mesh.metadata = { objectId: record.data.id };
      mesh.isPickable = true;
    }
  }

  function applyHiddenLook(record: ObjectRecord) {
    const visibility = record.data.hidden ? HIDDEN_VISIBILITY : 1;
    for (const mesh of record.content.meshes()) mesh.visibility = visibility;
  }

  function playAnimation(record: ObjectRecord) {
    const { data, content } = record;
    const wanted = data.animation_name;
    if (wanted === record.playing) return;

    for (const group of content.entries?.animationGroups ?? []) group.stop();

    // nameFunction renames cloned AnimationGroups too, so clips are matched by index in the container's own list.
    const look = data.appearance;
    const index = wanted && look.kind === 'model' && content.entries ? animationIndex(look.assetId, wanted) : -1;
    const target = index >= 0 ? content.entries!.animationGroups[index] : undefined;

    target?.play(true);
    record.playing = target ? wanted : null;
  }

  function disposeRecord(objectId: string) {
    const record = objectEntries.get(objectId);
    if (!record) return;

    record.content.dispose();
    record.holder.dispose();
    removeLabel(record.label);
    removeLabel(record.hpBar);
    record.glow?.mesh.material?.dispose();
    record.glow?.mesh.dispose();
    record.glow?.texture.dispose();
    objectEntries.delete(objectId);
    dropLivePose(objectId);
    if (objectId === selectedId()) setActiveObject(null, false);
  }

  // Single flight plus the latest pending call: overlapping calls would each create the same new object and leak one.
  let objectsInFlight: Promise<void> | null = null;
  let objectsPending: PlacedObject[] | null = null;

  async function setObjects(objects: PlacedObject[]) {
    if (objectsInFlight) {
      objectsPending = objects;
      return;
    }

    objectsInFlight = applyObjects(objects);
    await objectsInFlight;
    objectsInFlight = null;

    if (objectsPending) {
      const next = objectsPending;
      objectsPending = null;
      await setObjects(next);
    }
  }

  let turnObjectId = '';
  function turnObject() {
    return turnObjectId;
  }

  async function applyObjects(objects: PlacedObject[]) {
    const wanted = new Set(objects.map(o => o.id));

    for (const id of [...objectEntries.keys()]) {
      if (!wanted.has(id)) disposeRecord(id);
    }

    turnObjectId = objects.find(object => object.current)?.id ?? '';

    for (const object of objects) {
      let record = objectEntries.get(object.id);
      const placedBefore = Boolean(record);
      const key = appearanceKey(object);

      if (!record || record.appearanceKey !== key) {
        const holder = record?.holder ?? new TransformNode(`object-holder-${object.id}`, scene);
        if (!record) holder.rotationQuaternion = Quaternion.Identity();

        record?.content.dispose();
        const content = await buildContent(holder, object);

        if (holder.isDisposed()) {
          content.dispose();
          continue;
        }

        if (record) {
          record.content = content;
          record.appearanceKey = key;
          record.playing = null;
        } else {
          record = {
            holder, appearanceKey: key, content, data: object, playing: null,
            label: makeLabel(object.id), hpBar: makeHpBar(object.id), glow: null,
          };
          objectEntries.set(object.id, record);
        }

        markObjectMeshes(record);
        refreshActiveObject(object.id);
      }

      record.data = object;
      applyHiddenLook(record);
      refreshLabel(object.id);
      refreshHpBar(record);
      refreshGlow(record);

      // While an object is being pulled, live messages own its position; a stale one from a scene refresh is not applied.
      if (object.id !== draggingId() && !isLivePosed(object.id)) {
        moveRoot(object.id, record.holder, object.world_x, object.world_y, object.world_z, object.rotation_y, object.scale, placedBefore);
        if (object.id === selectedId()) syncHandleFromRoot(record.holder);
      }

      playAnimation(record);
    }
    if (multi().objects.size) refreshMulti();
    refreshAim();
  }

  return { setObjects, turnObject };
}
