import { Vector3, PointerEventTypes, Scene, ArcRotateCamera, TransformNode } from '@babylonjs/core';
import { type Position, snapFootprint, footprintCells } from '../grid';
import { PULL_INTERVAL_MS } from '../signals';
import type { TabletopOptions, ObjectRecord, TableTool, LiveHooks, ToolHooks } from '../sceneTypes';
import type { RulersApi } from './rulers';

export type ObjectDragDeps = {
  canvas: HTMLCanvasElement;
  options: Pick<TabletopOptions, 'onObjectTransform'>;
  widthCells: number;
  heightCells: number;
  live: Pick<LiveHooks, 'canDragObject' | 'onObjectGrab' | 'onObjectPull' | 'onObjectRelease'>;
  tools: Pick<ToolHooks, 'dragLabel' | 'dragPath'>;
  scene: Scene;
  camera: ArcRotateCamera;
  cameraGesture: (event: unknown) => boolean;
  holdCamera: (event: unknown) => void;
  objectEntries: Map<string, ObjectRecord>;
  setDragging: (objectId: string | null) => void;
  isSelectionEnabled: () => boolean;
  selectedId: () => string | null;
  syncHandleFromRoot: (root: TransformNode) => void;
  contestedObject: () => string | null;
  isWallPickMode: () => boolean;
  isWallDrawMode: () => boolean;
  tool: () => TableTool;
  clampX: (value: number) => number;
  clampZ: (value: number) => number;
  pickGroundPoint: (snap: boolean) => Position | null;
  createPathLine: RulersApi['createPathLine'];
  createRuler: RulersApi['createRuler'];
  measureText: (from: Position, to: Position) => string;
  isTerrainBrush: () => boolean;
  cancelGesture: () => boolean;
};

export function createObjectDrag({
  canvas, options, widthCells, heightCells, live, tools, scene, camera, cameraGesture,
  holdCamera, objectEntries, setDragging, isSelectionEnabled, selectedId, syncHandleFromRoot,
  contestedObject, isWallPickMode, isWallDrawMode, tool, clampX, clampZ, pickGroundPoint,
  createPathLine, createRuler, measureText, isTerrainBrush, cancelGesture,
}: ObjectDragDeps) {
  let objectDrag: {
    objectId: string;
    startX: number;
    startY: number;
    moved: boolean;
    last: Position | null;
    lastPullAt: number;
    from: Position;
    y: number;
    grab: Position;
  } | null = null;

  const dragAnchor = new Vector3();
  const dragPathLine = createPathLine('#f1e4c5');
  const dragRuler: ReturnType<typeof createRuler> = createRuler('#f1e4c5', 'is-drag', () => {
    const record = objectDrag?.moved ? objectEntries.get(objectDrag.objectId) : undefined;
    if (!record || !dragRuler.shown) return null;
    const { position, scaling } = record.holder;
    return dragAnchor.set(position.x, position.y + record.content.labelHeight * scaling.y + 0.04, position.z);
  });

  function endObjectDrag() {
    const drag = objectDrag;
    objectDrag = null;
    if (!drag) return;

    camera.attachControl(canvas, true);
    dragRuler.hide();
    dragPathLine.hide();

    if (drag.moved) {
      setDragging(null);
      live.onObjectRelease?.(drag.objectId);
      const record = objectEntries.get(drag.objectId);

      if (drag.last && record) {
        options.onObjectTransform?.(drag.objectId, {
          x: drag.last.x,
          y: drag.y,
          z: drag.last.z,
          rotationY: record.data.rotation_y,
          scale: record.data.scale,
        });
      }
    }
  }

  scene.onPointerObservable.add(info => {
    if (info.type === PointerEventTypes.POINTERDOWN) {
      if (info.event.button !== 0 || isWallDrawMode() || isWallPickMode() || isTerrainBrush() || tool() !== 'select' || info.event.ctrlKey || info.event.shiftKey || !isSelectionEnabled() || cameraGesture(info.event)) return;

      const pick = scene.pick(scene.pointerX, scene.pointerY, mesh => Boolean(mesh.metadata?.objectId));
      const objectId = pick?.hit ? (pick.pickedMesh?.metadata?.objectId as string | undefined) : undefined;
      const record = objectId ? objectEntries.get(objectId) : undefined;
      if (!objectId || !record || !live.canDragObject?.(objectId)) return;

      const grabbedAt = pickGroundPoint(false);
      objectDrag = {
        objectId,
        startX: scene.pointerX,
        startY: scene.pointerY,
        moved: false,
        last: null,
        lastPullAt: 0,
        from: {
          x: snapFootprint(record.data.world_x, widthCells, footprintCells(record.data.size)),
          z: snapFootprint(record.data.world_z, heightCells, footprintCells(record.data.size)),
        },
        y: record.holder.position.y,
        grab: grabbedAt
          ? { x: grabbedAt.x - record.holder.position.x, z: grabbedAt.z - record.holder.position.z }
          : { x: 0, z: 0 },
      };
      holdCamera(info.event);
      return;
    }

    if (info.type === PointerEventTypes.POINTERMOVE && objectDrag) {
      const drag = objectDrag;

      if (!drag.moved) {
        if (Math.hypot(scene.pointerX - drag.startX, scene.pointerY - drag.startY) < 5) return;
        drag.moved = true;
        setDragging(drag.objectId);
        live.onObjectGrab?.(drag.objectId);
      }

      const ground = pickGroundPoint(false);
      const record = objectEntries.get(drag.objectId);
      if (!ground || !record) return;
      const point = { x: clampX(ground.x - drag.grab.x), z: clampZ(ground.z - drag.grab.z) };

      drag.last = point;

      if (contestedObject() !== drag.objectId) {
        record.holder.position.set(point.x, drag.y, point.z);
        if (drag.objectId === selectedId()) syncHandleFromRoot(record.holder);
      }

      const footprint = footprintCells(record.data.size);
      const cell = { x: snapFootprint(point.x, widthCells, footprint), z: snapFootprint(point.z, heightCells, footprint) };
      const path = tools.dragPath?.(drag.objectId, drag.from, cell) ?? null;
      dragRuler.set(drag.from, cell, tools.dragLabel?.(drag.objectId, drag.from, cell) ?? measureText(drag.from, cell), !path);
      if (path) dragPathLine.set(path);
      else dragPathLine.hide();

      const now = performance.now();
      if (now - drag.lastPullAt >= PULL_INTERVAL_MS) {
        drag.lastPullAt = now;
        live.onObjectPull?.(drag.objectId, {
          x: point.x, y: drag.y, z: point.z, rotationY: record.data.rotation_y, scale: record.data.scale,
        });
      }
      return;
    }

    if (info.type === PointerEventTypes.POINTERUP && objectDrag) {
      const up = info.event as PointerEvent;
      const over = document.elementFromPoint(up.clientX, up.clientY);
      if (objectDrag.moved && over && over !== canvas) cancelGesture();
      else endObjectDrag();
    }
  });

  function cancelObjectDrag(): boolean {
    const drag = objectDrag;
    if (!drag) return false;
    objectDrag = null;
    camera.attachControl(canvas, true);
    dragRuler.hide();
    dragPathLine.hide();
    const record = objectEntries.get(drag.objectId);
    if (record) {
      record.holder.position.set(record.data.world_x, drag.y, record.data.world_z);
      if (drag.objectId === selectedId()) syncHandleFromRoot(record.holder);
    }
    if (drag.moved) {
      setDragging(null);
      live.onObjectRelease?.(drag.objectId);
      // Released the same way as a normal drop, so the server lets go of it for everyone.
      if (record) {
        options.onObjectTransform?.(drag.objectId, {
          x: record.data.world_x, y: drag.y, z: record.data.world_z, rotationY: record.data.rotation_y, scale: record.data.scale,
        });
      }
    }
    return true;
  }

  return { endObjectDrag, cancelObjectDrag };
}
