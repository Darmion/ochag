import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';
import type { WallSegment, Tabletop } from '../scene';
import { type Position, footprintCells, gridDistanceCells, type DiagonalRule } from '../grid';
import { formatFeet } from '../toasts';
import type { ReachInfo, SceneObjectDTO, TabletopProps, SceneDetail, InitiativeEntry } from './types';

export type ReachDeps = {
  props: TabletopProps;
  viewOnly: boolean;
  sceneId: Ref<string>;
  sceneDetail: Ref<SceneDetail | null>;
  objects: Ref<SceneObjectDTO[]>;
  activeObjectId: Ref<string>;
  walls: Ref<WallSegment[]>;
  visionPreview: Ref<boolean>;
  eyesOfSelected: Ref<boolean>;
  feetPerUnit: ComputedRef<number>;
  table: () => Tabletop | undefined;
  disposed: () => boolean;
  showMoveFilter: Ref<boolean>;
  diagonalRule: Ref<DiagonalRule>;
  measureLabel: (from: Position, to: Position) => string;
  currentTurnCharacterId: ComputedRef<string>;
  refresh: () => Promise<void>;
  currentEntry: ComputedRef<InitiativeEntry | null>;
  actorObject: ComputedRef<SceneObjectDTO | null>;
};

export function useReach({ props, viewOnly, sceneId, sceneDetail, objects, activeObjectId, walls, visionPreview, eyesOfSelected, feetPerUnit, table, disposed, showMoveFilter, diagonalRule, measureLabel, currentTurnCharacterId, refresh, currentEntry, actorObject }: ReachDeps) {
  const reach = ref<ReachInfo | null>(null);
  const reachObject = computed<SceneObjectDTO | null>(() => {
    const characterId = currentTurnCharacterId.value;
    const object = characterId ? objects.value.find(entry => entry.character_id === characterId) : undefined;
    return object && object.kind !== 'object' && object.canMove && !object.parent_object_id ? object : null;
  });
  const reachKey = computed(() => {
    const object = reachObject.value;
    const entry = currentEntry.value;
    if (!object || !entry || !sceneId.value) return '';
    return [
      sceneId.value, object.id, object.world_x, object.world_z, entry.moved_feet ?? 0, entry.dashes ?? 0,
      (object.conditions ?? []).join(','), JSON.stringify(sceneDetail.value?.difficult_cells ?? []), walls.value.length,
    ].join('|');
  });
  let reachTimer: ReturnType<typeof setTimeout> | null = null;

  async function loadReach(key: string) {
    const object = reachObject.value;
    if (!object) return;
    try {
      const result = await props.request(`/campaigns/${props.campaignId}/scenes/${sceneId.value}/objects/${object.id}/reach`) as ReachInfo;
      if (disposed() || key !== reachKey.value) return;
      reach.value = result;
    } catch {
      if (key === reachKey.value) reach.value = null;
    }
    table()?.setReachCells(reach.value?.cells ?? []);
  }

  watch(visionPreview, on => {
    if (on) eyesOfSelected.value = false;
    void refresh();
  });

  const dragReach = new Map<string, Promise<number[][] | null>>();
  const dragCosts = new Map<string, { isTurn: boolean; feet: Map<string, number>; trail: Map<string, [number, number]> }>();

  function dragLabel(objectId: string, from: Position, to: Position): string | null {
    const costs = dragCosts.get(objectId);
    const object = objects.value.find(entry => entry.id === objectId);
    const detail = sceneDetail.value;
    if (!costs || !object || !detail) return null;
    const n = footprintCells(object.size);
    const anchor = `${Math.round(to.x + detail.width_cells / 2 - n / 2)}:${Math.round(to.z + detail.height_cells / 2 - n / 2)}`;
    const straight = gridDistanceCells(from, to, diagonalRule.value) * feetPerUnit.value;
    if (!costs.isTurn) return `сейчас не его ход · по прямой ${formatFeet(straight)} фт`;
    const feet = costs.feet.get(anchor);
    if (feet === undefined) return from.x === to.x && from.z === to.z ? measureLabel(from, to) : `не дойти · по прямой ${formatFeet(straight)} фт`;
    return `${formatFeet(feet)} фт${feet > straight + 1e-6 ? ` · по прямой ${formatFeet(straight)}` : ''}`;
  }

  function dragPath(objectId: string, from: Position, to: Position): Position[] | null {
    const known = dragCosts.get(objectId);
    const object = objects.value.find(entry => entry.id === objectId);
    const detail = sceneDetail.value;
    if (!known?.isTurn || !known.trail.size || !object || !detail) return null;
    const n = footprintCells(object.size);
    const anchorOf = (point: Position) => [Math.round(point.x + detail.width_cells / 2 - n / 2), Math.round(point.z + detail.height_cells / 2 - n / 2)] as const;
    const centerOf = (col: number, row: number) => ({ x: col + n / 2 - detail.width_cells / 2, z: row + n / 2 - detail.height_cells / 2 });
    const [startCol, startRow] = anchorOf(from);
    let [col, row] = anchorOf(to);
    if (!known.feet.has(`${col}:${row}`)) return null;
    const points: Position[] = [centerOf(col, row)];
    for (let guard = 0; guard < 2000 && (col !== startCol || row !== startRow); guard += 1) {
      const previous = known.trail.get(`${col}:${row}`);
      if (!previous) return null;
      [col, row] = previous;
      points.unshift(centerOf(col, row));
    }
    const dx = to.x - from.x, dz = to.z - from.z;
    const length = Math.hypot(dx, dz) || 1;
    if (points.every(point => Math.abs((point.x - from.x) * dz - (point.z - from.z) * dx) / length < 0.34)) return null;
    return points.filter((point, index) => {
      if (index === 0 || index === points.length - 1) return true;
      const before = points[index - 1]!, after = points[index + 1]!;
      return Math.abs((point.x - before.x) * (after.z - point.z) - (point.z - before.z) * (after.x - point.x)) > 1e-9;
    });
  }

  let dragFilterFor: string | null = null;

  function dragReachKey(object: SceneObjectDTO) {
    const entry = currentEntry.value;
    const creatures = objects.value
      .filter(other => other.kind !== 'object' && !other.parent_object_id)
      .map(other => `${other.id}:${other.world_x}:${other.world_z}:${other.hidden ? 1 : 0}`).join(',');
    return [
      sceneId.value, object.id, object.world_x, object.world_z, entry?.id ?? '', entry?.moved_feet ?? 0, entry?.dashes ?? 0,
      (object.conditions ?? []).join(','), JSON.stringify(sceneDetail.value?.difficult_cells ?? []), walls.value.length, creatures,
    ].join('|');
  }

  function loadDragReach(objectId: string): Promise<number[][] | null> {
    const object = objects.value.find(entry => entry.id === objectId);
    if (!object || object.kind === 'object' || object.parent_object_id || !sceneId.value) return Promise.resolve(null);
    const key = dragReachKey(object);
    let pending = dragReach.get(key);
    if (!pending) {
      if (dragReach.size > 30) dragReach.clear();
      pending = (props.request(`/campaigns/${props.campaignId}/scenes/${sceneId.value}/objects/${object.id}/reach?mode=drag`) as Promise<ReachInfo>)
        .then(result => {
          if (result.limited) {
            dragCosts.set(objectId, {
              isTurn: result.isTurn,
              feet: new Map((result.costs ?? []).map(([col, row, feet]) => [`${col}:${row}`, feet!])),
              trail: new Map((result.trail ?? []).map(([col, row, fromCol, fromRow]) => [`${col}:${row}`, [fromCol!, fromRow!]])),
            });
          }
          else dragCosts.delete(objectId);
          return result.limited ? result.cells : null;
        })
        .catch(() => null);
      dragReach.set(key, pending);
    }
    return pending;
  }

  async function showDragFilter(objectId: string) {
    if (!showMoveFilter.value || viewOnly) return;
    dragFilterFor = objectId;
    const cells = await loadDragReach(objectId);
    if (dragFilterFor !== objectId || disposed()) return;
    table()?.setMoveFilter(cells);
  }

  function hideDragFilter() {
    dragFilterFor = null;
    table()?.setMoveFilter(null);
  }

  watch(activeObjectId, id => {
    if (id && showMoveFilter.value && !viewOnly && objects.value.find(object => object.id === id)?.canMove) void loadDragReach(id);
  });

  watch(reachKey, key => {
    if (reachTimer) clearTimeout(reachTimer);
    if (!key) {
      reach.value = null;
      table()?.setReachCells([]);
      return;
    }
    reachTimer = setTimeout(() => void loadReach(key), 150);
  }, { immediate: true });

  const movementLeft = computed(() => {
    const info = reach.value;
    return info?.limited && info.isTurn && info.feetLeft !== null && info.budget !== null &&
      reachObject.value?.character_id === actorObject.value?.character_id
      ? { feet: Math.round(info.feetLeft), budget: Math.round(info.budget) }
      : null;
  });

  return { reach, dragLabel, dragPath, loadDragReach, showDragFilter, hideDragFilter, movementLeft };
}
