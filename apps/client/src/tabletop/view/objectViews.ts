import { computed, watch, type Ref, type ComputedRef } from 'vue';
import type { ObjectSide, PlacedObject, GizmoMode, Tabletop } from '../scene';
import { OBJECT_KINDS, KIND_GROUP_LABELS } from '../../campaign/objects';
import type { ObjectState } from '../../components/objects/ObjectStatePanel.vue';
import { objectImageId } from '../../art/portraitArt';
import { conditionInfo } from '../../rules/conditions';
import type { SceneObjectDTO, TabletopProps, Character, InitiativeEntry } from './types';
import type { GameIconName } from '../../ui/gameIcons';

export type ObjectViewsDeps = {
  props: TabletopProps;
  characters: Ref<Character[]>;
  objects: Ref<SceneObjectDTO[]>;
  activeObjectId: Ref<string>;
  initiativeEntries: Ref<InitiativeEntry[]>;
  editY: Ref<number>;
  editRotation: Ref<number>;
  editScale: Ref<number>;
  editSnap: Ref<boolean>;
  editParentId: Ref<string>;
  editAnimationName: Ref<string>;
  editHidden: Ref<boolean>;
  activeObjectAnimations: Ref<string[]>;
  gizmoMode: Ref<GizmoMode>;
  feetPerUnit: ComputedRef<number>;
  table: () => Tabletop | undefined;
};

export function useObjectViews({ props, characters, objects, activeObjectId, initiativeEntries, editY, editRotation, editScale, editSnap, editParentId, editAnimationName, editHidden, activeObjectAnimations, gizmoMode, feetPerUnit, table }: ObjectViewsDeps) {
  const currentTurnCharacterId = computed(
    () => initiativeEntries.value.find(entry => entry.is_current)?.character_id ?? '',
  );

  function sideOf(object: SceneObjectDTO): ObjectSide {
    if (object.kind === 'object') return 'object';
    if (object.kind === 'character' && object.owner_user_id === props.currentUserId) return 'mine';
    if (!object.side) return object.kind === 'npc' ? object.disposition ?? 'neutral' : 'party';
    if (object.side === 'enemy') return 'hostile';
    if (object.side === 'neutral') return 'neutral';
    return object.kind === 'npc' ? 'friendly' : 'party';
  }
  const allyOfViewer = (object: SceneObjectDTO) => object.kind !== 'object' && (object.side
    ? object.side === 'self' || object.side === 'ally'
    : object.kind === 'character' || object.disposition === 'friendly');

  function stateSuffix(state: ObjectState | null | undefined) {
    if (!state) return '';
    const parts: string[] = [];
    if (state.broken) parts.push('сломано');
    else if (state.openable) parts.push(state.locked ? 'заперто' : state.open ? 'открыто' : 'закрыто');
    if (state.trap?.armed && state.trap.detected) parts.push('ловушка');
    return parts.length ? ` · ${parts.join(', ')}` : '';
  }

  const objectViews = computed<PlacedObject[]>(() => objects.value.map(object => ({
    id: object.id,
    name: `${object.name}${stateSuffix(object.state)}${object.loot ? ' · добыча' : ''}`,
    icons: labelIcons(object),
    creature: object.kind !== 'object',
    size: object.size,
    side: sideOf(object),
    appearance: object.model_asset_id
      ? { kind: 'model', assetId: object.model_asset_id }
      : objectImageId(object)
        ? { kind: 'image', assetId: objectImageId(object)! }
        : { kind: 'default' },
    world_x: object.world_x,
    world_y: object.world_y,
    world_z: object.world_z,
    rotation_y: object.rotation_y,
    scale: object.scale,
    animation_name: object.animation_name,
    current: Boolean(currentTurnCharacterId.value) && object.character_id === currentTurnCharacterId.value,
    hidden: object.hidden || (object.conditions ?? []).includes('invisible'),
    hp: object.hp ?? null,
    dead: object.kind !== 'object' && (object.conditions ?? []).includes('dead'),
    light: object.state?.light?.lit
      ? {
        bright: object.state.light.bright / feetPerUnit.value, dim: object.state.light.dim / feetPerUnit.value,
        cone: object.state.light.cone ? facingOf(object) : null,
      }
      : null,
  })));

  function facingOf(object: SceneObjectDTO) {
    let total = Number(object.rotation_y ?? 0);
    let parentId = object.parent_object_id;
    for (let guard = 0; parentId && guard < 10; guard += 1) {
      const parent = objects.value.find(entry => entry.id === parentId);
      if (!parent) break;
      total += Number(parent.rotation_y ?? 0);
      parentId = parent.parent_object_id;
    }
    return ((total % 360) + 360) % 360;
  }

  function labelIcons(object: SceneObjectDTO): GameIconName[] {
    return [
      ...(object.state?.light?.lit ? ['flame' as const] : []),
      ...(object.conditions ?? []).slice(0, 5).map(code => conditionInfo(code).icon),
      ...(object.loot ? ['chest' as const] : []),
    ];
  }

  const activeObject = computed<SceneObjectDTO | undefined>(
    () => objects.value.find(object => object.id === activeObjectId.value),
  );

  const placeableGroups = computed(() => {
    const placed = new Set(objects.value.map(object => object.character_id));
    const available = characters.value.filter(c => c.can_control && !placed.has(c.id) && !c.container_id);

    return OBJECT_KINDS
      .map(kind => ({ kind, label: KIND_GROUP_LABELS[kind], items: available.filter(c => c.kind === kind) }))
      .filter(group => group.items.length);
  });

  watch(activeObjectId, id => {
    const object = objects.value.find(o => o.id === id);

    if (!object) {
      table()?.setActiveObject(null, false);
      return;
    }

    editY.value = object.y;
    editRotation.value = object.rotation_y;
    editScale.value = object.scale;
    editSnap.value = object.snap_to_grid;
    editParentId.value = object.parent_object_id ?? '';
    editAnimationName.value = object.animation_name ?? '';
    editHidden.value = object.hidden;
    activeObjectAnimations.value = object.model_asset_id ? table()?.getAnimationNames(object.model_asset_id) ?? [] : [];

    gizmoMode.value = 'move';
    table()?.setActiveObject(object.id, object.canMove);
  });

  watch(
    () => {
      const object = objects.value.find(o => o.id === activeObjectId.value);
      return object ? `${object.id}:${object.canMove}` : '';
    },
    key => {
      const object = key ? objects.value.find(o => o.id === activeObjectId.value) : undefined;
      if (object) table()?.setActiveObject(object.id, object.canMove);
    },
  );

  watch(gizmoMode, mode => table()?.setGizmoMode(mode));

  return { currentTurnCharacterId, sideOf, allyOfViewer, objectViews, activeObject, placeableGroups };
}
