import { PointerEventTypes, Scene, ArcRotateCamera } from '@babylonjs/core';
import type { Position } from '../grid';
import { MEASURE_LINGER_MS, REMOTE_MEASURE_TTL_MS, SIGNAL_COLORS } from '../signals';
import type { ToolHooks, TableTool } from '../sceneTypes';
import type { RulersApi } from './rulers';

export type MeasureDeps = {
  canvas: HTMLCanvasElement;
  tools: ToolHooks;
  scene: Scene;
  camera: ArcRotateCamera;
  cameraGesture: (event: unknown) => boolean;
  holdCamera: (event: unknown) => void;
  tool: () => TableTool;
  clampX: (value: number) => number;
  clampZ: (value: number) => number;
  pickGroundPoint: (snap: boolean) => Position | null;
  createRuler: RulersApi['createRuler'];
  measureText: (from: Position, to: Position) => string;
};

export function createMeasure({
  canvas, tools, scene, camera, cameraGesture, holdCamera, tool, clampX, clampZ, pickGroundPoint,
  createRuler, measureText,
}: MeasureDeps) {
  const ownRuler = createRuler(tools.ownColor ?? SIGNAL_COLORS[0]!, 'is-mine');
  let measureDrag: { from: Position; to: Position } | null = null;
  let ownRulerTimer: ReturnType<typeof setTimeout> | undefined;

  function clearOwnMeasure(notify: boolean) {
    clearTimeout(ownRulerTimer);

    if (measureDrag) {
      measureDrag = null;
      camera.attachControl(canvas, true);
    }

    const wasShown = ownRuler.shown;
    ownRuler.hide();
    if (notify && wasShown) tools.onMeasureClear?.();
  }

  type RemoteRuler = { ruler: ReturnType<typeof createRuler>; timer?: ReturnType<typeof setTimeout> };
  const remoteRulers = new Map<string, RemoteRuler>();

  function showRemoteMeasure(userId: string, displayName: string, color: string, from: Position, to: Position) {
    let entry = remoteRulers.get(userId);

    if (!entry) {
      entry = { ruler: createRuler(color, 'is-remote') };
      remoteRulers.set(userId, entry);
    }

    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => clearRemoteMeasure(userId), REMOTE_MEASURE_TTL_MS);

    const clampedFrom = { x: clampX(from.x), z: clampZ(from.z) };
    const clampedTo = { x: clampX(to.x), z: clampZ(to.z) };
    entry.ruler.set(clampedFrom, clampedTo, measureText(clampedFrom, clampedTo), true, displayName);
  }

  function clearRemoteMeasure(userId: string) {
    const entry = remoteRulers.get(userId);
    if (!entry) return;

    clearTimeout(entry.timer);
    entry.ruler.dispose();
    remoteRulers.delete(userId);
  }

  function clearRemoteMeasures() {
    for (const userId of [...remoteRulers.keys()]) clearRemoteMeasure(userId);
  }

  function measureActive() {
    return measureDrag !== null;
  }

  function abortMeasure() {
    if (!measureDrag) return;
    measureDrag = null;
    camera.attachControl(canvas, true);
  }

  function stopMeasureTimers() {
    clearTimeout(ownRulerTimer);
    for (const entry of remoteRulers.values()) clearTimeout(entry.timer);
  }

  scene.onPointerObservable.add(info => {
    if (info.type === PointerEventTypes.POINTERDOWN) {
      if (tool() !== 'measure' || info.event.button !== 0 || cameraGesture(info.event)) return;

      const point = pickGroundPoint(true);
      if (!point) return;

      clearTimeout(ownRulerTimer);
      measureDrag = { from: point, to: point };
      holdCamera(info.event);
      ownRuler.set(point, point, measureText(point, point));
      return;
    }

    if (info.type === PointerEventTypes.POINTERMOVE && measureDrag) {
      const point = pickGroundPoint(true);
      if (!point || (point.x === measureDrag.to.x && point.z === measureDrag.to.z)) return;

      measureDrag.to = point;
      ownRuler.set(measureDrag.from, point, measureText(measureDrag.from, point));
      tools.onMeasure?.(measureDrag.from, point);
      return;
    }

    if (info.type === PointerEventTypes.POINTERUP && measureDrag) {
      const { from, to } = measureDrag;
      measureDrag = null;
      camera.attachControl(canvas, true);

      if (from.x === to.x && from.z === to.z) {
        clearOwnMeasure(true);
        return;
      }

      ownRulerTimer = setTimeout(() => clearOwnMeasure(true), MEASURE_LINGER_MS);
    }
  });

  return { clearOwnMeasure, showRemoteMeasure, clearRemoteMeasure, clearRemoteMeasures, measureActive, abortMeasure, stopMeasureTimers };
}
