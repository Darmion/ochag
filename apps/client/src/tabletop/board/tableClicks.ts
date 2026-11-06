import { PointerEventTypes, type GroundMesh, type Scene } from '@babylonjs/core';
import { snapToLatticePoint, snapToBoard, type Position } from '../grid';
import type { TabletopOptions, TableTool, ToolHooks, WallSegment } from '../sceneTypes';

export type TableClicksDeps = {
  options: TabletopOptions;
  widthCells: number;
  heightCells: number;
  tools: ToolHooks;
  scene: Scene;
  ground: GroundMesh;
  isSelectionEnabled: () => boolean;
  wallUnderPointer: () => string | null;
  isWallPickMode: () => boolean;
  wallPointUnderPointer: () => Position | null;
  wallList: () => WallSegment[];
  isWallDrawMode: () => boolean;
  aimActive: () => boolean;
  aimTap: () => void;
  tool: () => TableTool;
  pickGroundPoint: (snap: boolean) => Position | null;
  firePing: (point: Position) => void;
  consumeMarqueeEnd: () => boolean;
  isTerrainBrush: () => boolean;
};

export function createTableClicks({
  options, widthCells, heightCells, tools, scene, ground, isSelectionEnabled, wallUnderPointer,
  isWallPickMode, wallPointUnderPointer, wallList, isWallDrawMode, aimActive, aimTap, tool,
  pickGroundPoint, firePing, consumeMarqueeEnd, isTerrainBrush,
}: TableClicksDeps) {
  scene.onPointerObservable.add(info => {
    if (info.type !== PointerEventTypes.POINTERTAP || info.event.button !== 2 || !options.onContextClick) return;
    const pick = scene.pick(scene.pointerX, scene.pointerY, mesh =>
      mesh === ground || (isSelectionEnabled() && Boolean(mesh.metadata?.objectId)),
    );
    const screen = { x: (info.event as PointerEvent).clientX, y: (info.event as PointerEvent).clientY };
    const objectId = (pick?.pickedMesh?.metadata?.objectId as string | undefined) ?? null;
    const point = pick?.hit && pick.pickedPoint ? { x: pick.pickedPoint.x, z: pick.pickedPoint.z } : null;
    const wallHit = objectId ? null : scene.pick(scene.pointerX, scene.pointerY, mesh => Boolean(mesh.metadata?.wallId));
    const wallId = wallHit?.hit ? ((wallHit.pickedMesh?.metadata?.wallId as string | undefined) ?? null) : null;
    const wallPoint = wallHit?.hit && wallHit.pickedPoint ? { x: wallHit.pickedPoint.x, z: wallHit.pickedPoint.z } : null;
    options.onContextClick({ objectId, point: objectId ? null : wallPoint ?? point, screen, wallId });
  });

  scene.onPointerObservable.add(info => {
    if (info.type !== PointerEventTypes.POINTERTAP || info.event.button !== 0) return;

    if (tool() === 'measure' || tool() === 'draw' || tool() === 'template') return;
    if (isTerrainBrush()) return;
    if (consumeMarqueeEnd()) return;
    if (aimActive()) {
      aimTap();
      return;
    }
    if (info.event.shiftKey && tool() === 'select' && !isWallDrawMode() && tools.onMultiPick) {
      const objectHit = scene.pick(scene.pointerX, scene.pointerY, mesh => Boolean(mesh.metadata?.objectId));
      const objectId = objectHit?.hit ? (objectHit.pickedMesh?.metadata?.objectId as string | undefined) ?? null : null;
      tools.onMultiPick({ objectId, wallId: objectId ? null : wallUnderPointer(), point: pickGroundPoint(false) });
      return;
    }
    if (isWallPickMode() && tool() === 'select') {
      const event = info.event as PointerEvent;
      tools.onWallPick?.(wallUnderPointer(), { x: event.clientX, y: event.clientY }, wallPointUnderPointer());
      return;
    }

    if (tool() === 'select' && !isWallDrawMode() && tools.onDoorClick) {
      const hit = scene.pick(scene.pointerX, scene.pointerY, mesh => Boolean(mesh.metadata?.wallId || mesh.metadata?.objectId));
      const doorId = hit?.hit ? (hit.pickedMesh?.metadata?.wallId as string | undefined) : undefined;
      const door = doorId ? wallList().find(wall => wall.id === doorId) : undefined;
      if (door && door.kind === 'door' && !door.broken) {
        tools.onDoorClick(door.id);
        return;
      }
    }

    if (tool() === 'select' || tool() === 'pin') {
      const pinPick = scene.pick(scene.pointerX, scene.pointerY, mesh => Boolean(mesh.metadata?.pinId));
      const pinId = pinPick?.hit ? (pinPick.pickedMesh?.metadata?.pinId as string | undefined) : undefined;

      if (pinId) {
        tools.onPinClick?.(pinId);
        return;
      }
    }

    if (tool() === 'pin') {
      const point = pickGroundPoint(false);
      if (point) tools.onPinPoint?.(point);
      return;
    }

    if (tool() === 'place') {
      const point = pickGroundPoint(true);
      if (point) tools.onPlacePoint?.(point);
      return;
    }

    if (tool() === 'text' || tool() === 'erase') {
      const point = pickGroundPoint(false);
      if (point) (tool() === 'text' ? tools.onTextPoint : tools.onErasePoint)?.(point);
      return;
    }

    if (tool() === 'ping' || info.event.ctrlKey) {
      const point = pickGroundPoint(false);
      if (point) firePing(point);
      return;
    }

    const pick = scene.pick(scene.pointerX, scene.pointerY, mesh =>
      mesh === ground || (isSelectionEnabled() && Boolean(mesh.metadata?.objectId)),
    );

    if (!pick?.hit) return;

    const objectId = pick.pickedMesh?.metadata?.objectId as string | undefined;
    if (objectId) {
      options.onSelectObject?.(objectId);
      return;
    }

    if (pick.pickedMesh === ground && pick.pickedPoint) {
      // Walls snap to lattice points, objects to cell centres; must match the hover handler in scene.ts, or the ghost preview and the committed wall disagree.
      options.onGroundClick(
        isWallDrawMode()
          ? {
              x: snapToLatticePoint(pick.pickedPoint.x, widthCells),
              z: snapToLatticePoint(pick.pickedPoint.z, heightCells),
            }
          : {
              x: snapToBoard(pick.pickedPoint.x, widthCells),
              z: snapToBoard(pick.pickedPoint.z, heightCells),
            },
      );
    }
  });
}
