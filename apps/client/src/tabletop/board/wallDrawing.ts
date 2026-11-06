import { StandardMaterial, Color3, MeshBuilder, Mesh, Scene } from '@babylonjs/core';
import type { Position } from '../grid';

export type WallDrawingDeps = {
  scene: Scene;
  brass: StandardMaterial;
  WALL_HEIGHT: number;
  WALL_DEPTH: number;
};

export function createWallDrawing({ scene, brass, WALL_HEIGHT, WALL_DEPTH }: WallDrawingDeps) {
  const wallPreviewMaterial = new StandardMaterial('wall-preview-material', scene);
  wallPreviewMaterial.diffuseColor = Color3.FromHexString('#4a4a52');
  wallPreviewMaterial.alpha = 0.4;
  const wallPreviews = Array.from({ length: 4 }, (_, index) => {
    const box = MeshBuilder.CreateBox(`wall-preview-${index}`, { width: 1, height: WALL_HEIGHT, depth: WALL_DEPTH }, scene);
    box.material = wallPreviewMaterial;
    box.isPickable = false;
    box.setEnabled(false);
    return box;
  });
  const wallPreview = wallPreviews[0]!;
  let wallShape: 'chain' | 'room' = 'chain';
  function setWallShape(shape: 'chain' | 'room') {
    wallShape = shape;
  }

  const wallHoverMarker = MeshBuilder.CreateCylinder(
    'wall-hover-marker', { diameter: 0.32, height: 0.06, tessellation: 20 }, scene,
  );
  wallHoverMarker.material = brass;
  wallHoverMarker.isPickable = false;
  wallHoverMarker.position.y = 0.05;
  wallHoverMarker.setEnabled(false);

  let wallDrawModeActive = false;
  let wallFirstPoint: Position | null = null;
  function isWallDrawMode() {
    return wallDrawModeActive;
  }

  function placePreviewBox(box: Mesh, from: Position, to: Position) {
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    box.setEnabled(length > 0);
    if (length <= 0) return;
    box.scaling.x = length;
    box.position.set((from.x + to.x) / 2, WALL_HEIGHT / 2, (from.z + to.z) / 2);
    box.rotation.y = Math.atan2(-(to.z - from.z), to.x - from.x);
  }

  function updateWallPreviewMesh(from: Position, to: Position) {
    if (wallShape === 'room') {
      const corners = [from, { x: to.x, z: from.z }, to, { x: from.x, z: to.z }];
      const flat = from.x === to.x || from.z === to.z;
      wallPreviews.forEach((box, index) => {
        if (flat) box.setEnabled(false);
        else placePreviewBox(box, corners[index]!, corners[(index + 1) % 4]!);
      });
      return;
    }
    for (const box of wallPreviews.slice(1)) box.setEnabled(false);
    placePreviewBox(wallPreview, from, to);
  }

  function updateWallVisuals(hoverPoint: Position | null) {
    wallHoverMarker.setEnabled(wallDrawModeActive && Boolean(hoverPoint));
    if (hoverPoint) wallHoverMarker.position.set(hoverPoint.x, 0.05, hoverPoint.z);

    if (wallDrawModeActive && wallFirstPoint && hoverPoint) {
      updateWallPreviewMesh(wallFirstPoint, hoverPoint);
    } else {
      for (const box of wallPreviews) box.setEnabled(false);
    }
  }

  function setWallDrawMode(enabled: boolean) {
    wallDrawModeActive = enabled;
    if (!enabled) updateWallVisuals(null);
  }

  function setWallFirstPoint(point: Position | null) {
    wallFirstPoint = point;
    if (!point) for (const box of wallPreviews) box.setEnabled(false);
  }

  return { setWallShape, isWallDrawMode, updateWallVisuals, setWallDrawMode, setWallFirstPoint };
}
