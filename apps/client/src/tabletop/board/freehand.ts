import { PointerEventTypes, Scene, ArcRotateCamera } from '@babylonjs/core';
import type { Position } from '../grid';
import type { ToolHooks, TableTool } from '../sceneTypes';
import { simplifyPath } from '../paths';
import { createLiveLine } from './liveLines';

const STROKE_POINTS = 4000;

export type FreehandDeps = {
  canvas: HTMLCanvasElement;
  tools: ToolHooks;
  scene: Scene;
  camera: ArcRotateCamera;
  cameraGesture: (event: unknown) => boolean;
  holdCamera: (event: unknown) => void;
  tool: () => TableTool;
  pickGroundPoint: (snap: boolean) => Position | null;
};

export function createFreehand({
  canvas, tools, scene, camera, cameraGesture, holdCamera, tool, pickGroundPoint,
}: FreehandDeps) {
  let drawStyle = { color: '#f5c469', width: 0.08 };
  let drawStroke: Position[] | null = null;
  const drawPreview = createLiveLine(scene, 'draw-preview', STROKE_POINTS, 0.03);

  function setDrawStyle(style: { color: string; width: number }) {
    drawStyle = style;
  }

  function strokeActive() {
    return drawStroke !== null;
  }

  function updateDrawPreview() {
    if (!drawStroke || drawStroke.length < 2) drawPreview.hide();
    else drawPreview.set(drawStroke);
  }

  function cancelStroke() {
    if (drawStroke) camera.attachControl(canvas, true);
    drawStroke = null;
    updateDrawPreview();
  }

  scene.onPointerObservable.add(info => {
    if (info.type === PointerEventTypes.POINTERDOWN) {
      if (tool() !== 'draw' || info.event.button !== 0 || cameraGesture(info.event)) return;
      const point = pickGroundPoint(false);
      if (!point) return;

      drawStroke = [point];
      drawPreview.color(drawStyle.color);
      holdCamera(info.event);
      return;
    }

    if (info.type === PointerEventTypes.POINTERMOVE && drawStroke) {
      const point = pickGroundPoint(false);
      const last = drawStroke[drawStroke.length - 1]!;
      if (!point || Math.hypot(point.x - last.x, point.z - last.z) < 0.08 || drawStroke.length >= STROKE_POINTS) return;

      drawStroke.push(point);
      updateDrawPreview();
      return;
    }

    if (info.type === PointerEventTypes.POINTERUP && drawStroke) {
      const stroke = drawStroke;
      cancelStroke();
      const simplified = simplifyPath(stroke).slice(0, 2000);
      if (simplified.length >= 2) tools.onDrawPath?.(simplified);
    }
  });

  return { setDrawStyle, strokeActive, cancelStroke };
}
