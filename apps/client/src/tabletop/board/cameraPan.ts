import { Vector3, Engine, Scene, ArcRotateCamera } from '@babylonjs/core';

export type CameraPanDeps = {
  widthCells: number;
  heightCells: number;
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  stopFlight: () => void;
};

export function createCameraPan({ widthCells, heightCells, engine, scene, camera, stopFlight }: CameraPanDeps) {
  let pan = { right: 0, forward: 0 };

  function setCameraPan(right: number, forward: number) {
    pan = { right, forward };
    if (right || forward) stopFlight();
  }

  scene.onBeforeRenderObservable.add(() => {
    if (!pan.right && !pan.forward) return;
    const seconds = Math.min(0.1, engine.getDeltaTime() / 1000);
    const forward = camera.target.subtract(camera.position);
    forward.y = 0;
    if (forward.lengthSquared() < 1e-6) return;
    forward.normalize();
    const right = new Vector3(forward.z, 0, -forward.x);
    const speed = Math.max(4, camera.radius * 0.8) * seconds;
    const next = camera.target.add(forward.scale(pan.forward * speed)).add(right.scale(pan.right * speed));
    next.x = Math.max(-widthCells / 2 - 4, Math.min(widthCells / 2 + 4, next.x));
    next.z = Math.max(-heightCells / 2 - 4, Math.min(heightCells / 2 + 4, next.z));
    // A pan, not a rotation: assigning camera.target in Babylon keeps the camera in place and turns it toward the point.
    camera.setTarget(next, false, false, true);
  });

  return { setCameraPan };
}
