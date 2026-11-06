import { Vector3, Scene, ArcRotateCamera } from '@babylonjs/core';
import { freeRect, fitCamera } from '../cameraFit';
import type { CameraPose, FrameInsets, ObjectRecord } from '../sceneTypes';

export type FramingDeps = {
  canvas: HTMLCanvasElement;
  halfWidth: number;
  halfHeight: number;
  reducedMotion: boolean;
  scene: Scene;
  radius: number;
  camera: ArcRotateCamera;
  objectEntries: Map<string, ObjectRecord>;
};

export function createFraming({
  canvas, halfWidth, halfHeight, reducedMotion, scene, radius, camera, objectEntries,
}: FramingDeps) {
  const HOME_ALPHA = -Math.PI / 2;
  const HOME_BETA = Math.PI / 3;
  let cameraFlight: { from: CameraPose; to: CameraPose; start: number; duration: number } | null = null;
  let cameraTouches = 0;
  const stopFlight = () => {
    cameraFlight = null;
    cameraTouches++;
  };
  canvas.addEventListener('pointerdown', stopFlight);
  canvas.addEventListener('wheel', stopFlight, { passive: true });

  function applyPose(pose: CameraPose) {
    camera.setTarget(pose.target, false, false, true);
    camera.alpha = pose.alpha;
    camera.beta = pose.beta;
    camera.radius = pose.radius;
  }

  scene.onBeforeRenderObservable.add(() => {
    if (!cameraFlight) return;
    const { from, to, start, duration } = cameraFlight;
    const t = Math.min(1, (performance.now() - start) / duration);
    const k = 1 - (1 - t) ** 3;
    applyPose({
      alpha: from.alpha + (to.alpha - from.alpha) * k,
      beta: from.beta + (to.beta - from.beta) * k,
      radius: from.radius + (to.radius - from.radius) * k,
      target: Vector3.Lerp(from.target, to.target, k),
    });
    if (t >= 1) cameraFlight = null;
  });

  function fitPose(points: Vector3[], alpha: number, betas: number[], insets: FrameInsets, minRadius: number): CameraPose | null {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!points.length || width < 50 || height < 50) return null;
    const rect = freeRect({ width, height }, insets);
    let best: (ReturnType<typeof fitCamera> & { beta: number }) | null = null;
    for (const beta of betas) {
      const fit = fitCamera({
        points, alpha, beta, fov: camera.fov, size: { width, height }, rect,
        minRadius: Math.max(camera.lowerRadiusLimit ?? 1, minRadius),
        maxRadius: camera.upperRadiusLimit ?? 200,
      });
      if (!best || (fit.fits && (!best.fits || fit.coverage > best.coverage * 1.15))) best = { ...fit, beta };
    }
    if (!best) return null;
    return { alpha, beta: best.beta, radius: best.radius, target: new Vector3(best.target.x, 0, best.target.z) };
  }

  function flyTo(pose: CameraPose, animate: boolean) {
    camera.inertialAlphaOffset = 0;
    camera.inertialBetaOffset = 0;
    camera.inertialRadiusOffset = 0;
    camera.inertialPanningX = 0;
    camera.inertialPanningY = 0;
    const from: CameraPose = { alpha: camera.alpha, beta: camera.beta, radius: camera.radius, target: camera.target.clone() };
    const turn = ((pose.alpha - from.alpha) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    const to = { ...pose, alpha: from.alpha + turn };
    if (!animate || reducedMotion) {
      cameraFlight = null;
      applyPose(to);
      return;
    }
    cameraFlight = { from, to, start: performance.now(), duration: 450 };
  }

  function boardPoints() {
    const x = halfWidth + 0.65;
    const z = halfHeight + 0.65;
    return [-1, 1].flatMap(sx => [-1, 1].flatMap(sz => [-0.2, 1].map(y => new Vector3(sx * x, y, sz * z))));
  }

  function objectPoints(ids: string[]) {
    const points: Vector3[] = [];
    for (const id of ids) {
      const record = objectEntries.get(id);
      if (!record || !record.holder.isEnabled()) continue;
      const { position, scaling } = record.holder;
      const half = Math.max(0.5, scaling.x * 0.5) + 0.5;
      const top = position.y + record.content.labelHeight * scaling.y + 0.5;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        points.push(new Vector3(position.x + sx * half, position.y, position.z + sz * half));
        points.push(new Vector3(position.x + sx * half, top, position.z + sz * half));
      }
    }
    return points;
  }

  function frameView(what: 'board' | 'top' | string[], insets: FrameInsets, animate = true) {
    const points = Array.isArray(what) ? objectPoints(what) : boardPoints();
    const alpha = Array.isArray(what) ? camera.alpha : HOME_ALPHA;
    const betas = Array.isArray(what) ? [camera.beta] : what === 'top' ? [camera.lowerBetaLimit ?? 0.2] : [HOME_BETA, 0.9, 0.75];
    const pose = fitPose(points, alpha, betas, insets, Array.isArray(what) ? 10 : 0);
    if (!pose) return false;
    flyTo(pose, animate);
    return true;
  }

  function resetCamera() {
    cameraFlight = null;
    camera.setTarget(Vector3.Zero());
    camera.alpha = HOME_ALPHA;
    camera.beta = HOME_BETA;
    camera.radius = radius;
  }

  function userCameraStamp() {
    return cameraTouches;
  }

  function disposeFraming() {
    cameraFlight = null;
    canvas.removeEventListener('pointerdown', stopFlight);
    canvas.removeEventListener('wheel', stopFlight);
  }

  return { stopFlight, frameView, resetCamera, userCameraStamp, disposeFraming };
}
