import { computed, type Ref, type ComputedRef } from 'vue';
import { footprintCells } from '../grid';
import type { SceneObjectDTO, TabletopProps, SceneDetail } from './types';
import type { ObjectSide } from '../scene';

export type ActionTargetsDeps = {
  props: TabletopProps;
  sceneDetail: Ref<SceneDetail | null>;
  objects: Ref<SceneObjectDTO[]>;
  feetPerUnit: ComputedRef<number>;
  activeObject: ComputedRef<SceneObjectDTO | undefined>;
  sideOf: (object: SceneObjectDTO) => ObjectSide;
  actorObject: ComputedRef<SceneObjectDTO | null>;
};

export function useActionTargets({ props, sceneDetail, objects, feetPerUnit, activeObject, sideOf, actorObject }: ActionTargetsDeps) {
  const conditionSources = computed(() => objects.value
    .filter(object => object.kind !== 'object' && object.canEdit && object.character_id !== activeObject.value?.character_id)
    .map(object => ({ id: object.character_id, name: object.name })));

  function distanceFeet(a: SceneObjectDTO, b: SceneObjectDTO) {
    const side = (object: SceneObjectDTO) => footprintCells(object.size);
    const gapX = Math.max(0, Math.abs(a.world_x - b.world_x) - side(a) / 2 - side(b) / 2);
    const gapZ = Math.max(0, Math.abs(a.world_z - b.world_z) - side(a) / 2 - side(b) / 2);
    const lowA = (a.flightHeight ?? 0) / feetPerUnit.value;
    const lowB = (b.flightHeight ?? 0) / feetPerUnit.value;
    const gapY = Math.max(0, Math.max(lowA, lowB) - Math.min(lowA + side(a), lowB + side(b)));
    return Math.round((Math.max(gapX, gapZ, gapY) + 1) * feetPerUnit.value);
  }

  const attackTargets = computed(() => objects.value
    .filter(object => (object.kind !== 'object' || !object.parent_object_id) && object.character_id !== actorObject.value?.character_id)
    .map(object => ({
      characterId: object.character_id, name: object.name, side: sideOf(object),
      distanceFeet: actorObject.value ? distanceFeet(actorObject.value, object) : null,
    })));

  const lootTargets = computed(() => {
    const actor = actorObject.value;
    if (!actor || actor.kind === 'object' || !actor.canEdit) return [];
    return objects.value
      .filter(object => object.loot && object.id !== actor.id && (sceneDetail.value?.canManage || distanceFeet(actor, object) <= 5))
      .map(object => ({ characterId: object.character_id, name: object.name, count: object.loot ?? 0 }));
  });
  const tradeTargets = computed(() => {
    const actor = actorObject.value;
    if (!actor || actor.kind === 'object' || !actor.canEdit) return [];
    return objects.value
      .filter(object => object.merchant && object.id !== actor.id && !object.parent_object_id && (sceneDetail.value?.canManage || distanceFeet(actor, object) <= 10))
      .map(object => ({ characterId: object.character_id, name: object.name }));
  });
  const ownCharacterObject = computed(() =>
    objects.value.find(object => object.kind === 'character' && object.owner_user_id === props.currentUserId) ?? null);

  return { conditionSources, distanceFeet, attackTargets, lootTargets, tradeTargets, ownCharacterObject };
}
