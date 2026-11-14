import { Vector3, Engine, Scene, ArcRotateCamera } from '@babylonjs/core';

export type CameraPanDeps = {
  widthCells: number;
  heightCells: number;
  canvas: HTMLCanvasElement;
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  stopFlight: () => void;
};

// Keys pan faster the longer they are held (up to twice as fast after a second), and Shift triples it: a big map is
// crossed in seconds while a short tap still moves a cell or two.
const RAMP_SECONDS = 1;
const FAST = 3;

export function createCameraPan({ widthCells, heightCells, canvas, engine, scene, camera, stopFlight }: CameraPanDeps) {
  let pan = { right: 0, forward: 0, fast: false };
  let held = 0;

  function setCameraPan(right: number, forward: number, fast = false) {
    if (!right && !forward) held = 0;
    pan = { right, forward, fast };
    if (right || forward) stopFlight();
  }

  scene.onBeforeRenderObservable.add(() => {
    // A drag moves the board with the cursor at any distance: pixels per board unit at the camera's target.
    const pixelsPerUnit = canvas.clientHeight / (2 * camera.radius * Math.tan(camera.fov / 2));
    if (Number.isFinite(pixelsPerUnit) && pixelsPerUnit > 0) camera.panningSensibility = Math.max(2, Math.min(1000, pixelsPerUnit));

    if (!pan.right && !pan.forward) return;
    const seconds = Math.min(0.1, engine.getDeltaTime() / 1000);
    held += seconds;
    const forward = camera.target.subtract(camera.position);
    forward.y = 0;
    if (forward.lengthSquared() < 1e-6) return;
    forward.normalize();
    const right = new Vector3(forward.z, 0, -forward.x);
    const ramp = 1 + Math.min(1, held / RAMP_SECONDS);
    const speed = Math.max(4, camera.radius * 0.8) * ramp * (pan.fast ? FAST : 1) * seconds;
    const next = camera.target.add(forward.scale(pan.forward * speed)).add(right.scale(pan.right * speed));
    next.x = Math.max(-widthCells / 2 - 4, Math.min(widthCells / 2 + 4, next.x));
    next.z = Math.max(-heightCells / 2 - 4, Math.min(heightCells / 2 + 4, next.z));
    // A pan, not a rotation: assigning camera.target in Babylon keeps the camera in place and turns it toward the point.
    camera.setTarget(next, false, false, true);
  });

  return { setCameraPan };
}
