import { computed, watch, ref, type Ref, type ComputedRef } from 'vue';
import type { AimSpec, AimMark, WallSegment, Tabletop, ObjectSide } from '../scene';
import { footprintCells } from '../grid';
import GameActionBar from '../../components/game/actionBar/GameActionBar.vue';
import type { SceneObjectDTO } from './types';

export type AimDeps = {
  actionBar: Ref<InstanceType<typeof GameActionBar> | null>;
  objects: Ref<SceneObjectDTO[]>;
  walls: Ref<WallSegment[]>;
  feetPerUnit: ComputedRef<number>;
  table: () => Tabletop | undefined;
  actorObject: ComputedRef<SceneObjectDTO | null>;
  attackTargets: ComputedRef<{ characterId: string; name: string; side: ObjectSide; distanceFeet: number | null; }[]>;
  distanceFeet: (a: SceneObjectDTO, b: SceneObjectDTO) => number;
};

export function useAim({ actionBar, objects, walls, feetPerUnit, table, actorObject, attackTargets, distanceFeet }: AimDeps) {
  const aimSpec = computed<AimSpec | null>(() => {
    const state = actionBar.value?.aimState;
    const actor = actorObject.value;
    if (!state || !actor) return null;
    const marks: Record<string, AimMark> = {};
    if (!state.area) {
      const known = new Set(attackTargets.value.map(target => target.characterId));
      for (const object of objects.value) {
        const self = object.character_id === actor.character_id;
        if (self ? !state.self : !known.has(object.character_id)) continue;
        if (state.only && !state.only.includes(object.character_id)) continue;
        if (state.living && object.kind !== 'object' && (object.conditions ?? []).includes('dead')) continue;
        const far = !self && state.rangeFeet !== null && distanceFeet(actor, object) > state.rangeFeet;
        marks[object.id] = state.chosen.includes(object.character_id) ? 'chosen' : far ? 'far' : 'ok';
      }
    }
    const unit = feetPerUnit.value;
    const area = state.area;
    return {
      originId: actor.id, marks: state.place ? {} : marks, walls: state.walls,
      place: state.place ? { cells: footprintCells(state.place.size), count: state.place.count } : null,
      area: area ? {
        shape: area.shape, size: area.sizeFeet / unit, width: (area.widthFeet ?? 5) / unit, fromSelf: area.fromSelf, color: area.color,
        range: state.rangeFeet !== null ? state.rangeFeet / unit : null,
      } : null,
    };
  });
  watch(aimSpec, spec => table()?.setAim(spec));

  const aimTipAt = ref<{ x: number; y: number } | null>(null);
  const aimHovered = ref<{ objectId: string | null; wallId: string | null }>({ objectId: null, wallId: null });
  const aimAreaNames = ref<{ names: string[]; inRange: boolean } | null>(null);
  watch(() => aimSpec.value === null, off => {
    if (!off) return;
    aimHovered.value = { objectId: null, wallId: null };
    aimAreaNames.value = null;
  });
  const aimTip = computed(() => {
    const spec = aimSpec.value;
    if (!spec || !aimTipAt.value) return '';
    if (spec.area) {
      const area = aimAreaNames.value;
      if (!area) return '';
      if (!area.inRange) return 'Слишком далеко — подведите ближе';
      return area.names.length ? `Задето: ${area.names.length} — ${area.names.slice(0, 4).join(', ')}${area.names.length > 4 ? '…' : ''}` : 'Никого не задевает';
    }
    const { objectId, wallId } = aimHovered.value;
    if (objectId) {
      const object = objects.value.find(entry => entry.id === objectId);
      if (!object) return '';
      const mark = spec.marks[objectId];
      if (!mark) return `${object.name} — не цель`;
      const actor = actorObject.value;
      if (mark === 'far') return `${object.name} — далеко${actor ? ` (${Math.round(distanceFeet(actor, object))} фут.)` : ''}`;
      return mark === 'chosen' ? `${object.name} — выбрана (щелчок — убрать)` : object.name;
    }
    if (wallId) {
      const wall = walls.value.find(entry => entry.id === wallId);
      if (!wall) return '';
      const kind = wall.kind === 'door' ? 'Дверь' : wall.kind === 'window' ? 'Окно' : 'Стена';
      return `${kind}${wall.condition ? ` · ${wall.condition}` : ''} — ударить`;
    }
    return '';
  });
  function onAimPointer(event: PointerEvent) {
    aimTipAt.value = aimSpec.value ? { x: event.offsetX, y: event.offsetY } : null;
  }

  return { aimTipAt, aimHovered, aimAreaNames, aimTip, onAimPointer };
}
