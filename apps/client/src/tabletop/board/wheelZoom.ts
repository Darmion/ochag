import { Matrix, Vector3, type ArcRotateCamera, type Engine, type Scene } from '@babylonjs/core';

export type WheelZoomDeps = {
  canvas: HTMLCanvasElement;
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  halfWidth: number;
  halfHeight: number;
  reducedMotion: boolean;
};

// The wheel zooms by a share of the distance toward the point of the table under the cursor: a big map goes from the
// whole board to one figure in a few notches, and that point stays under the cursor. Babylon's own wheel input moved by
// fixed steps toward the screen centre, and its zoom-to-mouse lifts the orbit centre off the table.
const NOTCH = 1.2;
const SHIFT_NOTCHES = 2.5;

export function createWheelZoom({ canvas, engine, scene, camera, halfWidth, halfHeight, reducedMotion }: WheelZoomDeps) {
  camera.inputs.removeByType('ArcRotateCameraMouseWheelInput');

  let goal: number | null = null;
  let pivot = Vector3.Zero();
  let lastRadius = camera.radius;
  const clampX = (x: number) => Math.max(-halfWidth - 4, Math.min(halfWidth + 4, x));
  const clampZ = (z: number) => Math.max(-halfHeight - 4, Math.min(halfHeight + 4, z));

  function groundUnder(x: number, y: number): Vector3 | null {
    const ray = scene.createPickingRay(x, y, Matrix.Identity(), camera, false);
    if (ray.direction.y > -1e-6) return null;
    const point = ray.origin.add(ray.direction.scale(-ray.origin.y / ray.direction.y));
    return new Vector3(clampX(point.x), 0, clampZ(point.z));
  }

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    // Shift turns the wheel sideways in Chromium, so the delta may arrive as deltaX.
    const raw = event.deltaY || event.deltaX;
    if (!raw) return;
    const pixels = raw * (event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1);
    const notches = Math.max(-4, Math.min(4, pixels / 100)) * (event.shiftKey ? SHIFT_NOTCHES : 1);
    if (goal === null) lastRadius = camera.radius;
    const lower = camera.lowerRadiusLimit ?? 1;
    const upper = camera.upperRadiusLimit ?? 1000;
    goal = Math.max(lower, Math.min(upper, (goal ?? camera.radius) * NOTCH ** notches));
    const box = canvas.getBoundingClientRect();
    pivot = groundUnder(event.clientX - box.left, event.clientY - box.top) ?? new Vector3(camera.target.x, 0, camera.target.z);
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });

  scene.onBeforeRenderObservable.add(() => {
    if (goal === null) return;
    // Something else moved the camera meanwhile (a flight to a figure, the keyboard zoom): that one wins.
    if (Math.abs(camera.radius - lastRadius) > 1e-6) {
      goal = null;
      return;
    }
    const from = camera.radius;
    const seconds = Math.min(0.1, engine.getDeltaTime() / 1000);
    const step = reducedMotion ? goal : from + (goal - from) * (1 - Math.exp(-seconds * 16));
    const done = Math.abs(step - goal) <= goal * 1e-3;
    const radius = done ? goal : step;
    // Scaling the camera's distances about the pivot keeps the pivot at the same spot on the screen.
    const ratio = radius / from;
    const target = new Vector3(
      clampX(pivot.x + (camera.target.x - pivot.x) * ratio),
      camera.target.y,
      clampZ(pivot.z + (camera.target.z - pivot.z) * ratio),
    );
    camera.setTarget(target, false, false, true);
    camera.radius = radius;
    lastRadius = camera.radius;
    if (done) goal = null;
  });

  function disposeWheelZoom() {
    canvas.removeEventListener('wheel', onWheel);
    goal = null;
  }

  return { disposeWheelZoom };
}
