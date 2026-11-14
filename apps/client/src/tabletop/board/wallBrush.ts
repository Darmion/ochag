import { PointerEventTypes, Scene, ArcRotateCamera } from '@babylonjs/core';
import type { Position } from '../grid';
import type { ToolHooks } from '../sceneTypes';
import { MAX_BRUSH_SEGMENTS, createBrushPath, type BrushDetail, type BrushPath } from '../../../../../packages/domain/map/wall-brush';
import { createLiveLine, createLiveSegments } from './liveLines';

const STROKE_POINTS = 4000;

export type WallBrushDeps = {
  canvas: HTMLCanvasElement;
  widthCells: number;
  heightCells: number;
  tools: ToolHooks;
  scene: Scene;
  camera: ArcRotateCamera;
  cameraGesture: (event: unknown) => boolean;
  holdCamera: (event: unknown) => void;
  pickGroundPoint: (snap: boolean) => Position | null;
};

export function createWallBrush({
  canvas, widthCells, heightCells, tools, scene, camera, cameraGesture, holdCamera, pickGroundPoint,
}: WallBrushDeps) {
  let active = false;
  let detail: BrushDetail = 'normal';
  let stroke: Position[] | null = null;
  let path: BrushPath | null = null;
  const trail = createLiveLine(scene, 'wall-brush-trail', STROKE_POINTS, 0.04);
  trail.color('#f5c469', 0.55);
  const walls = createLiveSegments(scene, 'wall-brush-walls', MAX_BRUSH_SEGMENTS, 0.08);
  const tip = createLiveSegments(scene, 'wall-brush-tip', 1, 0.08);
  tip.color('#ffffff', 0.5);
  let wasClosed: boolean | null = null;

  function clearPreview() {
    trail.hide();
    walls.hide();
    tip.hide();
  }

  function showPreview() {
    if (!stroke || !path || stroke.length < 2) {
      clearPreview();
      return;
    }
    trail.set(stroke);
    const closed = path.closes();
    if (closed !== wasClosed) {
      walls.color(closed ? '#9be38f' : '#ffffff');
      wasClosed = closed;
    }
    const { fixed, open } = path.walls();
    walls.set(fixed);
    tip.set(open ? [open] : []);
  }

  function wallStrokeActive() {
    return stroke !== null;
  }

  function cancelWallStroke() {
    if (!stroke) return;
    stroke = null;
    path = null;
    camera.attachControl(canvas, true);
    clearPreview();
  }

  function isWallBrush() {
    return active;
  }

  function setWallBrush(enabled: boolean, nextDetail: BrushDetail = detail) {
    active = enabled;
    detail = nextDetail;
    if (!enabled) cancelWallStroke();
  }

  scene.onPointerObservable.add(info => {
    if (!active) return;
    if (info.type === PointerEventTypes.POINTERDOWN) {
      if (info.event.button !== 0 || cameraGesture(info.event)) return;
      const point = pickGroundPoint(false);
      if (!point) return;
      stroke = [point];
      path = createBrushPath(widthCells, heightCells, detail);
      path.add(point);
      holdCamera(info.event);
      return;
    }
    if (info.type === PointerEventTypes.POINTERMOVE && stroke) {
      const point = pickGroundPoint(false);
      const last = stroke[stroke.length - 1]!;
      if (!point || Math.hypot(point.x - last.x, point.z - last.z) < 0.1 || stroke.length >= STROKE_POINTS) return;
      stroke.push(point);
      path?.add(point);
      showPreview();
      return;
    }
    if (info.type === PointerEventTypes.POINTERUP && stroke) {
      const done = path;
      cancelWallStroke();
      if (!done) return;
      const { segments, closed } = done.finish();
      tools.onWallBrush?.(segments, closed);
    }
  });

  return { isWallBrush, setWallBrush, wallStrokeActive, cancelWallStroke };
}
