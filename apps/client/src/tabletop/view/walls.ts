import { wallCoords } from '../wallCoords';
import { confirmAction } from '../../ui/confirmDialog';
import { computed, type Ref } from 'vue';
import type { WallStyle, WallKind, WallSegment } from '../scene';
import { type Position, snapToLatticePoint } from '../grid';
import { type WallChange, wallSteps } from '../../components/game/WallPopover.vue';
import type { WallCoords, TabletopProps, SceneDetail, WallTool, WallGroupEntry } from './types';
import type { TableHistory, HistoryEntry } from '../history';

export type WallsDeps = {
  props: TabletopProps;
  sceneDetail: Ref<SceneDetail | null>;
  walls: Ref<WallSegment[]>;
  wallTool: Ref<WallTool | null>;
  openingKind: Ref<'door' | 'window' | 'wall'>;
  wallStyle: Ref<WallStyle>;
  wallKind: Ref<WallKind>;
  wallTextureId: Ref<string | null>;
  wallPopover: Ref<{ at: { x: number; y: number }; wallId: string; tile: number; edit: boolean } | null>;
  wallFirstPoint: Ref<Position | null>;
  basePath: () => string;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  history: TableHistory;
  wallsAddedEntry: (created: WallSegment[], label: string) => HistoryEntry;
  wallAddedEntry: (wallId: string, coords: WallCoords, label: string) => HistoryEntry;
  wallsRemovedEntry: (data: WallGroupEntry[], label: string) => HistoryEntry;
  wallRemovedEntry: (wallId: string, coords: WallCoords, label: string) => HistoryEntry;
};

export function useWalls({ props, sceneDetail, walls, wallTool, openingKind, wallStyle, wallKind, wallTextureId, wallPopover, wallFirstPoint, basePath, refresh, run, history, wallsAddedEntry, wallAddedEntry, wallsRemovedEntry, wallRemovedEntry }: WallsDeps) {
  function placeWallPoint(point: Position) {
    if (!sceneDetail.value) return;

    const snapped: Position = {
      x: snapToLatticePoint(point.x, sceneDetail.value.width_cells),
      z: snapToLatticePoint(point.z, sceneDetail.value.height_cells),
    };

    if (!wallFirstPoint.value) {
      wallFirstPoint.value = snapped;
      return;
    }

    const first = wallFirstPoint.value;
    if (first.x === snapped.x && first.z === snapped.z) {
      wallFirstPoint.value = null;
      return;
    }

    if (wallTool.value === 'room') {
      wallFirstPoint.value = null;
      if (first.x === snapped.x || first.z === snapped.z) return;
      const corners = [first, { x: snapped.x, z: first.z }, snapped, { x: first.x, z: snapped.z }];
      const sides = corners.map((corner, index) => {
        const next = corners[(index + 1) % 4]!;
        return { x1: corner.x, z1: corner.z, x2: next.x, z2: next.z };
      });
      return run(async () => {
        const result = await props.request(`${basePath()}/walls/batch`, 'POST', { walls: sides, ...newWallLook() });
        history.record(wallsAddedEntry(result.walls, 'комната'));
        await refresh();
      });
    }

    wallFirstPoint.value = snapped;
    return run(async () => {
      const coords: WallCoords = { x1: first.x, z1: first.z, x2: snapped.x, z2: snapped.z, ...newWallLook() };
      const created = await props.request(`${basePath()}/walls`, 'POST', coords);
      history.record(wallAddedEntry(created.id, coords, 'стена'));

      await refresh();
    });
  }

  function newWallLook(): { style: WallStyle; textureAssetId?: string; kind?: WallKind } {
    const kind = wallKind.value === 'wall' ? {} : { kind: wallKind.value };
    if (wallStyle.value === 'image' && wallTextureId.value) return { style: 'image', textureAssetId: wallTextureId.value, ...kind };
    return { style: wallStyle.value === 'image' ? 'stone' : wallStyle.value, ...kind };
  }

  function paintTerrain(from: { col: number; row: number }, to: { col: number; row: number }) {
    const detail = sceneDetail.value;
    if (!detail) return;
    const cells = new Map((detail.difficult_cells ?? []).map(([c, r]) => [`${c}:${r}`, [c!, r!]]));
    const erase = cells.has(`${from.col}:${from.row}`);
    for (let col = Math.min(from.col, to.col); col <= Math.max(from.col, to.col); col += 1) {
      for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row += 1) {
        if (erase) cells.delete(`${col}:${row}`);
        else cells.set(`${col}:${row}`, [col, row]);
      }
    }
    return run(async () => {
      await props.request(`${basePath()}/terrain`, 'PUT', { cells: [...cells.values()] });
      await refresh();
    });
  }

  function clearTerrain() {
    return run(async () => {
      await props.request(`${basePath()}/terrain`, 'PUT', { cells: [] });
      await refresh();
    });
  }

  async function uploadWallPicture(file: File): Promise<string> {
    const uploaded = await props.request(`/campaigns/${props.campaignId}/assets?kind=object_image`, 'POST', undefined, file);
    return uploaded.id as string;
  }

  function onWallPictureForNew(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    return run(async () => {
      wallTextureId.value = await uploadWallPicture(file);
      wallStyle.value = 'image';
    });
  }

  function restyleWalls(ids: string[] | null, style: WallStyle, textureAssetId?: string | null) {
    return run(async () => {
      await props.request(`${basePath()}/walls`, 'PATCH', {
        ...(ids ? { ids } : {}), style, ...(style === 'image' ? { textureAssetId: textureAssetId ?? wallTextureId.value } : {}),
      });
      await refresh();
    });
  }

  const wallPopoverWall = computed(() => (wallPopover.value ? walls.value.find(wall => wall.id === wallPopover.value!.wallId) ?? null : null));

  function wallPopoverPicture(file: File) {
    const wall = wallPopoverWall.value;
    if (!wall) return;
    return run(async () => {
      const id = await uploadWallPicture(file);
      wallTextureId.value = id;
      await props.request(`${basePath()}/walls`, 'PATCH', { ids: [wall.id], style: 'image', textureAssetId: id });
      await refresh();
    });
  }

  function wallPopoverEverywhere() {
    const wall = wallPopoverWall.value;
    if (!wall) return;
    return restyleWalls(null, wall.style ?? 'stone', wall.texture_asset_id ?? null);
  }

  function wallPopoverRemove() {
    const wall = wallPopoverWall.value;
    wallPopover.value = null;
    if (wall) return deleteWall(wall.id);
  }

  function wallPopoverEdit(change: WallChange, scope: 'tile' | 'wall') {
    const popover = wallPopover.value;
    const wall = wallPopoverWall.value;
    if (!popover || !wall) return;
    if (change.remove && (scope === 'wall' || wallSteps(wall) <= 1)) return wallPopoverRemove();
    if (change.style === 'image' && !wall.texture_asset_id && wallTextureId.value) Object.assign(change, { textureAssetId: wallTextureId.value });
    const tiled = scope === 'tile' && wallSteps(wall) > 1;
    return run(async () => {
      const result = await props.request(`${basePath()}/walls/${wall.id}`, 'PATCH', { ...change, ...(tiled ? { tile: popover.tile } : {}) });
      if (change.remove) wallPopover.value = null;
      else if (tiled && wallPopover.value) {
        const piece = result.walls[popover.tile > 0 ? 1 : 0];
        if (piece) wallPopover.value = { ...wallPopover.value, wallId: piece.id, tile: 0 };
      }
      await refresh();
    });
  }

  function setWallOpening(wall: WallSegment, tile: number) {
    const kind = openingKind.value;
    if ((wall.kind ?? 'wall') === kind && wallSteps(wall) <= 1) return;
    return run(async () => {
      await props.request(`${basePath()}/walls/${wall.id}`, 'PATCH', { kind, ...(wallSteps(wall) > 1 ? { tile } : {}) });
      await refresh();
    });
  }

  function toggleDoor(wallId: string) {
    const door = walls.value.find(wall => wall.id === wallId);
    if (!door || door.kind !== 'door' || door.broken) return;
    return run(async () => {
      await props.request(`${basePath()}/walls/${door.id}`, 'PATCH', { open: !door.open });
      await refresh();
    });
  }

  async function removeAllWalls() {
    if (!walls.value.length || !(await confirmAction(`Убрать все стены сцены (${walls.value.length})? Отменить можно кнопкой «Отменить».`, { title: 'Убрать', confirmLabel: 'Убрать', danger: true }))) return;
    const removed = walls.value.map(wall => ({ id: wall.id, coords: wallCoords(wall) }));
    return run(async () => {
      await props.request(`${basePath()}/walls/remove`, 'POST', { all: true });
      history.record(wallsRemovedEntry(removed, 'все стены'));
      await refresh();
    });
  }

  function deleteWall(wallId: string) {
    const wall = walls.value.find(w => w.id === wallId);

    return run(async () => {
      await props.request(`${basePath()}/walls/${wallId}`, 'DELETE');
      if (wall) history.record(wallRemovedEntry(wallId, wallCoords(wall), 'удаление стены'));
      await refresh();
    });
  }

  return { placeWallPoint, newWallLook, paintTerrain, clearTerrain, onWallPictureForNew, restyleWalls, wallPopoverWall, wallPopoverPicture, wallPopoverEverywhere, wallPopoverEdit, setWallOpening, toggleDoor, removeAllWalls };
}
