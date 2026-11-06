import type { Ref, ComputedRef } from 'vue';
import { createTabletop, type WallSegment, type Tabletop, type MultiSelection, type TableTool, type ObjectTransform } from '../scene';
import { signalColor } from '../signals';
import type { Position } from '../grid';
import { windowZoom } from '../../settings/uiScale';
import { cameraScheme, altRotates } from '../../settings/cameraControls';
import type { GridLook } from '../../settings/gridSettings';
import type { BestiaryPlacement } from '../../components/rules/BestiaryModal.vue';
import type { AreaShape } from '../areas';
import { wallTileAt, wallSteps } from '../../components/game/WallPopover.vue';
import GameActionBar from '../../components/game/actionBar/GameActionBar.vue';
import type { SceneDetail, TabletopProps, SceneObjectDTO, WallTool, NoteSummary, LivePoint } from './types';
import type { LiveKind } from '../live';

export type BoardDeps = {
  props: TabletopProps;
  viewOnly: boolean;
  canvas: Ref<HTMLCanvasElement | null>;
  sceneDetail: Ref<SceneDetail | null>;
  placingBestiary: Ref<BestiaryPlacement | null>;
  actionBar: Ref<InstanceType<typeof GameActionBar> | null>;
  targetingActive: ComputedRef<boolean>;
  objects: Ref<SceneObjectDTO[]>;
  activeObjectId: Ref<string>;
  walls: Ref<WallSegment[]>;
  pendingPinPoint: Ref<Position | null>;
  templateShape: Ref<AreaShape>;
  templateSizeFeet: Ref<number>;
  pendingPinNoteId: Ref<string>;
  wallTool: Ref<WallTool | null>;
  wallPopover: Ref<{ at: { x: number; y: number }; wallId: string; tile: number; edit: boolean } | null>;
  notes: Ref<NoteSummary[]>;
  sceneError: Ref<string>;
  feetPerUnit: ComputedRef<number>;
  table: () => Tabletop | undefined;
  setTable: (next: Tabletop | undefined) => void;
  disposed: () => boolean;
  backgroundObjectUrl: Ref<string>;
  showHpBars: Ref<boolean>;
  showGizmo: Ref<boolean>;
  showWeather: Ref<boolean>;
  multiSelection: Ref<MultiSelection>;
  tool: Ref<TableTool>;
  overlay: Ref<HTMLDivElement | null>;
  loadModelFile: (assetId: string) => Promise<File>;
  loadImageUrl: (assetId: string) => Promise<string>;
  assetBlob: (assetId: string) => Promise<Blob>;
  drawColor: Ref<string>;
  measureLabel: (from: Position, to: Position) => string;
  sendMeasure: (from: Position, to: Position) => void;
  sendMeasureClear: () => void;
  onPinClick: (pinId: string) => Promise<void>;
  sendPing: (point: Position) => void;
  boardColors: ComputedRef<{ ground: string; wood: string; grid: string; }>;
  surroundingsColors: () => { table: string; void: string; };
  gridLook: ComputedRef<GridLook>;
  resetFraming: () => void;
  applyBuildModes: () => void;
  liveGrab: (kind: LiveKind, id: string) => void;
  livePull: (kind: LiveKind, id: string, point: LivePoint) => void;
  onObjectTransform: (objectId: string, transform: ObjectTransform) => void;
  paintTerrain: (from: { col: number; row: number; }, to: { col: number; row: number; }) => Promise<void> | undefined;
  setWallOpening: (wall: WallSegment, tile: number) => Promise<void> | undefined;
  toggleDoor: (wallId: string) => Promise<void> | undefined;
  saveDrawing: (points: Position[]) => Promise<void>;
  onTextPoint: (point: Position) => Promise<void> | undefined;
  eraseAt: (point: Position) => Promise<void> | undefined;
  placeTemplate: (placed: { x: number; z: number; direction: number; }) => Promise<void>;
  onMultiPick: (pick: { objectId: string | null; wallId: string | null; point: Position | null; }) => void;
  onMarquee: (found: MultiSelection) => void;
  groupMoveActive: ComputedRef<boolean>;
  groupCenter: ComputedRef<{ x: number; z: number; points: { x: number; z: number; }[]; } | null>;
  spawnBestiaryAt: (point: Position) => void;
  deployEncounterAt: (point: Position) => void;
  aimAreaNames: Ref<{ names: string[]; inRange: boolean; } | null>;
  aimHovered: Ref<{ objectId: string | null; wallId: string | null; }>;
  loadDragReach: (objectId: string) => Promise<number[][] | null>;
  showDragFilter: (objectId: string) => Promise<void>;
  hideDragFilter: () => void;
  dragLabel: (objectId: string, from: Position, to: Position) => string | null;
  dragPath: (objectId: string, from: Position, to: Position) => Position[] | null;
  onTableContext: (target: { objectId: string | null; point: Position | null; screen: { x: number; y: number; }; wallId?: string | null; }) => void;
  handleGroundClick: (point: Position) => void;
};

export function useBoard({ props, viewOnly, canvas, sceneDetail, placingBestiary, actionBar, targetingActive, objects, activeObjectId, walls, pendingPinPoint, templateShape, templateSizeFeet, pendingPinNoteId, wallTool, wallPopover, notes, sceneError, feetPerUnit, table, setTable, disposed, backgroundObjectUrl, showHpBars, showGizmo, showWeather, multiSelection, tool, overlay, loadModelFile, loadImageUrl, assetBlob, drawColor, measureLabel, sendMeasure, sendMeasureClear, onPinClick, sendPing, boardColors, surroundingsColors, gridLook, resetFraming, applyBuildModes, liveGrab, livePull, onObjectTransform, paintTerrain, setWallOpening, toggleDoor, saveDrawing, onTextPoint, eraseAt, placeTemplate, onMultiPick, onMarquee, groupMoveActive, groupCenter, spawnBestiaryAt, deployEncounterAt, aimAreaNames, aimHovered, loadDragReach, showDragFilter, hideDragFilter, dragLabel, dragPath, onTableContext, handleGroundClick }: BoardDeps) {
  let renderedWidth = -1;
  let renderedHeight = -1;
  let renderedBackgroundAssetId: string | null = null;
  // A failed background fetch (network, CORS) is not marked as painted, so the next refresh retries it.
  let backgroundLoadFailed = false;


  async function ensureTable(scene: SceneDetail) {
    const changed =
      scene.width_cells !== renderedWidth ||
      scene.height_cells !== renderedHeight;

    if (!changed || !canvas.value) return;

    try {
      table()?.dispose();
      // A loaded map image survives the rebuild: the blob URL is not tied to a Babylon engine or scene.
      const created = createTabletop(canvas.value, {
        dimensions: { widthCells: scene.width_cells, heightCells: scene.height_cells },
        windowZoom: windowZoom.value,
        cameraScheme: cameraScheme.value,
        altRotate: altRotates(),
        backgroundImageUrl: backgroundObjectUrl.value || undefined,
        onGroundClick: position => { if (!viewOnly) handleGroundClick(position); },
        loadModelFile,
        loadImageUrl,
        onSelectObject: objectId => {
          if (viewOnly) return;
          if (targetingActive.value) {
            const object = objects.value.find(o => o.id === objectId);
            if (object) actionBar.value?.setMapTarget(object.character_id);
            return;
          }
          if (activeObjectId.value === objectId) {
            const object = objects.value.find(o => o.id === objectId);
            table()?.setActiveObject(objectId, Boolean(object?.canMove));
          } else {
            activeObjectId.value = objectId;
          }
        },
        onObjectTransform: (objectId, transform) => onObjectTransform(objectId, transform),
        onContextClick: target => onTableContext(target),
        live: {
          canDragObject: objectId => !viewOnly && !targetingActive.value && Boolean(objects.value.find(object => object.id === objectId)?.canMove),
          onObjectGrab: objectId => {
            liveGrab('object', objectId);
            void loadDragReach(objectId);
            void showDragFilter(objectId);
          },
          onObjectPull: (objectId, transform) => livePull('object', objectId, transform),
          onObjectRelease: () => hideDragFilter(),
        },
        tools: {
          overlay: overlay.value ?? undefined,
          measureLabel,
          ownColor: signalColor(props.currentUserId),
          onMeasure: sendMeasure,
          onMeasureClear: sendMeasureClear,
          onPing: sendPing,
          onDrawPath: points => void saveDrawing(points),
          onTextPoint: point => onTextPoint(point),
          onErasePoint: point => void eraseAt(point),
          onPinClick,
          onPinPoint: point => {
            pendingPinPoint.value = point;
            pendingPinNoteId.value = notes.value[0]?.id ?? '';
          },
          onPlacePoint: point => void (placingBestiary.value ? spawnBestiaryAt(point) : deployEncounterAt(point)),
          onTemplatePlace: placed => void placeTemplate(placed),
          onTerrainRect: (from, to) => void paintTerrain(from, to),
          onWallPick: (wallId, screen, point) => {
            const wall = wallId ? walls.value.find(entry => entry.id === wallId) : undefined;
            if (wallTool.value === 'opening') {
              if (wall) void setWallOpening(wall, wallTileAt(wall, point ?? null));
              return;
            }
            wallPopover.value = wall ? { wallId: wall.id, at: screen, tile: wallTileAt(wall, point ?? null), edit: true } : null;
          },
          onDoorClick: wallId => { if (!viewOnly) void toggleDoor(wallId); },
          onAimWall: (wallId, point) => {
            const wall = walls.value.find(entry => entry.id === wallId);
            if (wall) actionBar.value?.strikeWall(wall.id, wallSteps(wall) > 1 ? wallTileAt(wall, point ?? null) : null);
          },
          onAimArea: placed => { actionBar.value?.setMapArea(placed); },
          onAimAreaHover: (ids, inRange) => {
            const names = ids.map(id => objects.value.find(object => object.id === id)?.name ?? '').filter(Boolean);
            aimAreaNames.value = { names, inRange };
            actionBar.value?.setAreaHover(names, inRange);
          },
          onAimHover: hover => { aimHovered.value = hover; },
          onAimPlace: point => { actionBar.value?.setMapPlace(point); },
          onMultiPick: pick => onMultiPick(pick),
          dragLabel: (objectId, from, to) => dragLabel(objectId, from, to),
          dragPath: (objectId, from, to) => dragPath(objectId, from, to),
          onMarquee: found => onMarquee(found),
        },
      });
      setTable(created);
      created.setTheme(boardColors.value);
      created.setSurroundings(surroundingsColors());
      resetFraming();
      created.setGrid(gridLook.value);
      created.setTool(tool.value);
      applyBuildModes();
      created.setMultiSelection(multiSelection.value);
      created.setGroupPreview(groupMoveActive.value && groupCenter.value ? { center: groupCenter.value, points: groupCenter.value.points } : null);
      created.setDrawStyle({ color: drawColor.value, width: 0.08 });
      created.setShowHitPoints(showHpBars.value);
      created.setShowGizmo(showGizmo.value);
      created.setLighting(sceneDetail.value?.effective_lighting ?? sceneDetail.value?.lighting ?? 'bright');
      created.setWeather(showWeather.value ? sceneDetail.value?.weather ?? 'clear' : 'clear');
      created.setTemplateStyle({
        shape: templateShape.value,
        size: Math.max(1, templateSizeFeet.value || 5) / feetPerUnit.value,
        width: 5 / feetPerUnit.value,
        color: drawColor.value,
      });
      sceneError.value = '';
    } catch {
      sceneError.value = 'Не удалось запустить 3D. Проверьте WebGL.';
    }

    renderedWidth = scene.width_cells;
    renderedHeight = scene.height_cells;
  }

  async function ensureBackground(scene: SceneDetail) {
    if (!table()) return;
    table()!.setBackgroundRotation(scene.background_rotation ?? 0);

    const upToDate = scene.background_asset_id === renderedBackgroundAssetId && !backgroundLoadFailed;
    if (upToDate) return;

    if (!scene.background_asset_id) {
      table()!.setBackground(undefined);
      if (backgroundObjectUrl.value) URL.revokeObjectURL(backgroundObjectUrl.value);
      backgroundObjectUrl.value = '';
      renderedBackgroundAssetId = null;
      backgroundLoadFailed = false;
      return;
    }

    try {
      const blob = await assetBlob(scene.background_asset_id);
      const url = URL.createObjectURL(blob);

      if (disposed()) {
        URL.revokeObjectURL(url);
        return;
      }

      table()!.setBackground(url);

      if (backgroundObjectUrl.value) URL.revokeObjectURL(backgroundObjectUrl.value);
      backgroundObjectUrl.value = url;
      renderedBackgroundAssetId = scene.background_asset_id;
      backgroundLoadFailed = false;
    } catch {
      backgroundLoadFailed = true;
    }
  }

  function dropBoard() {
    table()?.dispose();
    setTable(undefined);
    renderedWidth = -1;
    renderedHeight = -1;
    renderedBackgroundAssetId = null;
    backgroundLoadFailed = false;
    if (backgroundObjectUrl.value) {
      URL.revokeObjectURL(backgroundObjectUrl.value);
      backgroundObjectUrl.value = '';
    }
  }

  return { ensureTable, ensureBackground, dropBoard };
}
