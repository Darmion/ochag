import { TransformNode, Engine, Scene } from '@babylonjs/core';
import { glideMs } from '../grid';
import type { PoseTarget, PoseSource, Glide } from '../sceneTypes';

export type ObjectPosesDeps = {
  engine: Engine;
  scene: Scene;
  selectedObjectId: () => string | null;
  draggingObjectId: () => string | null;
  rootOf: (objectId: string) => TransformNode | null;
  syncHandleFromRoot: (root: TransformNode) => void;
  setRootTransform: (root: TransformNode, x: number, y: number, z: number, rotationY: number, scale: number) => void;
};

export function createObjectPoses({
  engine, scene, selectedObjectId, draggingObjectId, rootOf, syncHandleFromRoot,
  setRootTransform,
}: ObjectPosesDeps) {
  let contestedObjectId: string | null = null;
  const livePosedObjects = new Set<string>();
  const poseTargets = new Map<string, PoseTarget>();
  const POSE_SMOOTHING_MS = 45;

  function applyObjectPose(
    objectId: string,
    pose: { x: number; y: number; z: number; rotationY: number; scale: number },
    source: PoseSource,
    snap = false,
  ) {
    livePosedObjects.add(objectId);

    if (source.draggedByMe && source.contested) contestedObjectId = objectId;
    else if (contestedObjectId === objectId) contestedObjectId = null;

    if (source.draggedByMe && !source.contested) return;

    const root = rootOf(objectId);
    if (!root) return;

    if (!snap) {
      poseTargets.set(objectId, { x: pose.x, y: pose.y, z: pose.z, rotationY: pose.rotationY, scale: pose.scale });
      return;
    }
    poseTargets.delete(objectId);
    setRootTransform(root, pose.x, pose.y, pose.z, pose.rotationY, pose.scale);
    if (objectId === selectedObjectId() && draggingObjectId() !== objectId) syncHandleFromRoot(root);
  }
  const glides = new Map<string, Glide>();

  function routeFrom(fromX: number, fromZ: number, x: number, z: number, walk: Array<[number, number]> | null | undefined) {
    const first = walk?.[0], last = walk?.[walk.length - 1];
    if (!walk || walk.length < 3 || !first || !last) return null;
    if (Math.hypot(first[0] - fromX, first[1] - fromZ) > 0.6 || Math.hypot(last[0] - x, last[1] - z) > 1e-3) return null;
    const points = walk.map(([px, pz]) => ({ x: px, z: pz }));
    points[0] = { x: fromX, z: fromZ };
    let total = 0;
    const lengths = points.map((point, index) => (index ? (total += Math.hypot(point.x - points[index - 1]!.x, point.z - points[index - 1]!.z)) : 0));
    return total > 0 ? { length: total, route: points.map((point, index) => ({ ...point, at: lengths[index]! / total })) } : null;
  }

  function moveRoot(objectId: string, root: TransformNode, x: number, y: number, z: number, rotationY: number, scale: number, glide: boolean, walk?: Array<[number, number]> | null) {
    const current = glides.get(objectId);
    const fromX = root.position.x;
    const fromY = root.position.y;
    const fromZ = root.position.z;
    if (current && current.toX === x && current.toY === y && current.toZ === z) {
      setRootTransform(root, fromX, fromY, fromZ, rotationY, scale);
      return;
    }
    const routed = routeFrom(fromX, fromZ, x, z, walk);
    const cells = routed ? routed.length : Math.hypot(x - fromX, z - fromZ);
    if (!glide || cells < 0.3 || cells > (routed ? 60 : 30)) {
      glides.delete(objectId);
      setRootTransform(root, x, y, z, rotationY, scale);
      return;
    }
    setRootTransform(root, fromX, fromY, fromZ, rotationY, scale);
    glides.set(objectId, { fromX, fromY, fromZ, toX: x, toY: y, toZ: z, start: performance.now(), duration: glideMs(cells), ...(routed ? { route: routed.route } : {}) });
  }

  function alongRoute(route: NonNullable<Glide['route']>, k: number) {
    let index = 1;
    while (index < route.length - 1 && route[index]!.at < k) index += 1;
    const a = route[index - 1]!, b = route[index]!;
    const span = b.at - a.at;
    const t = span > 0 ? Math.min(1, Math.max(0, (k - a.at) / span)) : 1;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }

  scene.onBeforeRenderObservable.add(() => {
    if (!glides.size) return;
    const now = performance.now();
    for (const [objectId, glide] of glides) {
      const root = rootOf(objectId);
      if (!root || draggingObjectId() === objectId || livePosedObjects.has(objectId)) {
        glides.delete(objectId);
        continue;
      }
      const t = Math.min(1, (now - glide.start) / glide.duration);
      const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const flat = glide.route ? alongRoute(glide.route, k) : { x: glide.fromX + (glide.toX - glide.fromX) * k, z: glide.fromZ + (glide.toZ - glide.fromZ) * k };
      root.position.set(flat.x, glide.fromY + (glide.toY - glide.fromY) * k, flat.z);
      if (objectId === selectedObjectId()) syncHandleFromRoot(root);
      if (t >= 1) glides.delete(objectId);
    }
  });

  function clearObjectPose(objectId: string) {
    const target = poseTargets.get(objectId);
    const root = target ? rootOf(objectId) : null;
    if (target && root) setRootTransform(root, target.x, target.y, target.z, target.rotationY, target.scale);
    poseTargets.delete(objectId);
    livePosedObjects.delete(objectId);
    if (contestedObjectId === objectId) contestedObjectId = null;
  }

  function contestedObject() {
    return contestedObjectId;
  }

  function isLivePosed(objectId: string) {
    return livePosedObjects.has(objectId);
  }

  function dropLivePose(objectId: string) {
    livePosedObjects.delete(objectId);
  }

  function currentRotationY(root: TransformNode): number {
    const radians = root.rotationQuaternion ? root.rotationQuaternion.toEulerAngles().y : root.rotation.y;
    return (radians * 180) / Math.PI;
  }

  scene.onBeforeRenderObservable.add(() => {
    if (!poseTargets.size) return;
    const k = 1 - Math.exp(-Math.min(100, engine.getDeltaTime()) / POSE_SMOOTHING_MS);
    for (const [objectId, target] of poseTargets) {
      const root = rootOf(objectId);
      if (!root) {
        poseTargets.delete(objectId);
        continue;
      }
      const { position } = root;
      const rotation = currentRotationY(root);
      const turn = ((target.rotationY - rotation + 540) % 360) - 180;
      const close = Math.abs(target.x - position.x) + Math.abs(target.y - position.y) + Math.abs(target.z - position.z) < 0.002
        && Math.abs(turn) < 0.2 && Math.abs(target.scale - root.scaling.x) < 0.001;
      if (close) {
        setRootTransform(root, target.x, target.y, target.z, target.rotationY, target.scale);
        poseTargets.delete(objectId);
      } else {
        setRootTransform(
          root,
          position.x + (target.x - position.x) * k,
          position.y + (target.y - position.y) * k,
          position.z + (target.z - position.z) * k,
          (((rotation + turn * k) % 360) + 360) % 360,
          root.scaling.x + (target.scale - root.scaling.x) * k,
        );
      }
      if (objectId === selectedObjectId() && draggingObjectId() !== objectId) syncHandleFromRoot(root);
    }
  });

  return { applyObjectPose, moveRoot, clearObjectPose, contestedObject, isLivePosed, dropLivePose };
}
