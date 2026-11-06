import { Mesh, StandardMaterial, Color3, HighlightLayer, Vector4, MeshBuilder, Scene } from '@babylonjs/core';
import type { Position } from '../grid';
import type { WallSegment } from '../sceneTypes';

export type WallsDeps = {
  scene: Scene;
  WALL_HEIGHT: number;
  WALL_DEPTH: number;
  wallMaterial: (wall: WallSegment) => StandardMaterial;
  multi: () => { objects: Set<string>; walls: Set<string>; templates: Set<string>; };
  pickGroundPoint: (snap: boolean) => Position | null;
};

export function createWalls({ scene, WALL_HEIGHT, WALL_DEPTH, wallMaterial, multi, pickGroundPoint }: WallsDeps) {
  const wallNodes = new Map<string, Mesh>();
  let currentWalls: WallSegment[] = [];
  let wallsVersion = 0;

  const glassMaterial = new StandardMaterial('wall-glass', scene);
  glassMaterial.diffuseColor = Color3.FromHexString('#9fd3ff');
  glassMaterial.emissiveColor = Color3.FromHexString('#1c3242');
  glassMaterial.alpha = 0.35;
  glassMaterial.specularColor = new Color3(0.6, 0.6, 0.6);
  const doorMaterial = new StandardMaterial('wall-door', scene);
  doorMaterial.diffuseColor = Color3.FromHexString('#7a4a26');
  doorMaterial.specularColor = new Color3(0.08, 0.06, 0.04);
  const rubbleMaterial = new StandardMaterial('wall-rubble', scene);
  rubbleMaterial.diffuseColor = Color3.FromHexString('#4a423a');
  rubbleMaterial.specularColor = new Color3(0.03, 0.03, 0.03);
  const wallShadowMaterial = new StandardMaterial('wall-shadow', scene);
  wallShadowMaterial.disableLighting = true;
  wallShadowMaterial.emissiveColor = Color3.Black();
  wallShadowMaterial.alpha = 0.26;
  let wallExtras: Mesh[] = [];
  let wallsKey = '';
  let selectedWalls = new Set<string>();
  let hoveredWall: string | null = null;

  const wallGlow = new HighlightLayer('wall-highlight', scene);
  wallGlow.innerGlow = false;
  function refreshWallOutlines() {
    wallGlow.removeAllMeshes();
    for (const [id, mesh] of wallNodes) {
      if (selectedWalls.has(id)) wallGlow.addMesh(mesh, Color3.FromHexString('#f0c96a'));
      else if (multi().walls.has(id)) wallGlow.addMesh(mesh, Color3.FromHexString('#6fe3d0'));
      else if (hoveredWall === id) wallGlow.addMesh(mesh, Color3.FromHexString('#9fd3ff'));
    }
  }

  function wallList() {
    return currentWalls;
  }

  function wallsRevision() {
    return wallsVersion;
  }

  function setWalls(walls: WallSegment[]) {
    currentWalls = walls;
    wallsVersion += 1;
    const key = JSON.stringify(walls.map(w => [w.id, w.x1, w.z1, w.x2, w.z2, w.style ?? 'stone', w.texture_asset_id ?? null, w.kind ?? 'wall', Boolean(w.open), Boolean(w.broken)]));
    if (key === wallsKey) return;
    wallsKey = key;

    wallGlow.removeAllMeshes();
    for (const mesh of wallNodes.values()) mesh.dispose();
    wallNodes.clear();
    for (const mesh of wallExtras) mesh.dispose();
    wallExtras = [];

    const posts = new Map<string, { x: number; z: number; material: StandardMaterial }>();
    for (const wall of walls) {
      const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
      if (length <= 0) continue;
      const mat = wallMaterial(wall);
      const kind = wall.kind ?? 'wall';
      const angle = Math.atan2(-(wall.z2 - wall.z1), wall.x2 - wall.x1);
      const midX = (wall.x1 + wall.x2) / 2, midZ = (wall.z1 + wall.z2) / 2;
      const slab = (name: string, from: number, to: number, material: StandardMaterial, depth = WALL_DEPTH) => {
        const height = WALL_HEIGHT * (to - from);
        const faceUV = [
          new Vector4(0, 0, length, to - from), new Vector4(0, 0, length, to - from),
          new Vector4(0, 0, depth, to - from), new Vector4(0, 0, depth, to - from),
          new Vector4(0, 0, length, depth), new Vector4(0, 0, length, depth),
        ];
        const piece = MeshBuilder.CreateBox(name, { width: length, height, depth, faceUV, wrap: true }, scene);
        piece.material = material;
        piece.isPickable = true;
        piece.metadata = { wallId: wall.id };
        piece.position.set(midX, WALL_HEIGHT * (from + to) / 2, midZ);
        piece.rotation.y = angle;
        return piece;
      };
      let mesh: Mesh;
      if (wall.broken) {
        mesh = slab(`wall-${wall.id}`, 0, 0.14, rubbleMaterial, WALL_DEPTH * 1.8);
      } else if (kind === 'window') {
        mesh = slab(`wall-${wall.id}`, 0, 0.42, mat);
        wallExtras.push(slab(`wall-glass-${wall.id}`, 0.42, 0.88, glassMaterial, WALL_DEPTH * 0.3));
        wallExtras.push(slab(`wall-lintel-${wall.id}`, 0.88, 1, mat));
      } else if (kind === 'door') {
        mesh = slab(`wall-lintel-${wall.id}`, 0.9, 1, mat);
        const panel = slab(`wall-door-${wall.id}`, 0, 0.9, doorMaterial, WALL_DEPTH * 0.45);
        if (wall.open) {
          panel.rotation.y = angle + Math.PI / 2;
          const along = { x: (wall.x2 - wall.x1) / length, z: (wall.z2 - wall.z1) / length };
          panel.position.set(wall.x1 + along.z * length / 2 * -1 + along.x * 0.06, panel.position.y, wall.z1 + along.x * length / 2 + along.z * 0.06);
        }
        wallExtras.push(panel);
      } else {
        mesh = slab(`wall-${wall.id}`, 0, 1, mat);
      }
      wallNodes.set(wall.id, mesh);

      if (!wall.broken) {
        const shadow = MeshBuilder.CreateGround(`wall-shadow-${wall.id}`, { width: length + 0.2, height: 0.56 }, scene);
        shadow.material = wallShadowMaterial;
        shadow.isPickable = false;
        shadow.position.set(midX, 0.006, midZ);
        shadow.rotation.y = angle;
        wallExtras.push(shadow);
      }

      if (wall.broken) continue;
      for (const [x, z] of [[wall.x1, wall.z1], [wall.x2, wall.z2]] as const) {
        const postKey = `${x}:${z}`;
        if (!posts.has(postKey)) posts.set(postKey, { x, z, material: mat });
      }
    }
    for (const post of posts.values()) {
      const faceUV = Array.from({ length: 6 }, () => new Vector4(0, 0, 0.28, 1.06));
      const mesh = MeshBuilder.CreateBox('wall-post', { width: 0.28, height: WALL_HEIGHT + 0.06, depth: 0.28, faceUV }, scene);
      mesh.material = post.material;
      mesh.isPickable = false;
      mesh.position.set(post.x, (WALL_HEIGHT + 0.06) / 2, post.z);
      wallExtras.push(mesh);
    }
    refreshWallOutlines();
  }

  function setWallHighlight(ids: string[]) {
    selectedWalls = new Set(ids);
    refreshWallOutlines();
  }

  function nearestWallId(point: Position, within = 0.35) {
    let best: { id: string; distance: number } | null = null;
    for (const wall of currentWalls) {
      const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1;
      const t = Math.max(0, Math.min(1, ((point.x - wall.x1) * dx + (point.z - wall.z1) * dz) / (dx * dx + dz * dz || 1)));
      const distance = Math.hypot(point.x - (wall.x1 + t * dx), point.z - (wall.z1 + t * dz));
      if (distance <= within && (!best || distance < best.distance)) best = { id: wall.id, distance };
    }
    return best?.id ?? null;
  }

  function wallPointUnderPointer(): Position | null {
    const hit = scene.pick(scene.pointerX, scene.pointerY, mesh => Boolean(mesh.metadata?.wallId));
    if (hit?.hit && hit.pickedPoint) return { x: hit.pickedPoint.x, z: hit.pickedPoint.z };
    return pickGroundPoint(false);
  }

  function wallUnderPointer(): string | null {
    const hit = scene.pick(scene.pointerX, scene.pointerY, mesh => Boolean(mesh.metadata?.wallId));
    const id = hit?.hit ? (hit.pickedMesh?.metadata?.wallId as string | undefined) : undefined;
    if (id) return id;
    const point = pickGroundPoint(false);
    return point ? nearestWallId(point) : null;
  }

  function hoveredWallId() {
    return hoveredWall;
  }

  function setHoveredWall(id: string | null) {
    if (id === hoveredWall) return;
    hoveredWall = id;
    refreshWallOutlines();
  }

  let wallPickActive = false;
  function isWallPickMode() {
    return wallPickActive;
  }

  function setWallPickMode(enabled: boolean) {
    wallPickActive = enabled;
    if (!enabled && hoveredWall) {
      hoveredWall = null;
      refreshWallOutlines();
    }
  }

  function disposeWalls() {
    wallGlow.dispose();
  }

  return { disposeWalls, refreshWallOutlines, wallList, wallsRevision, setWalls, setWallHighlight, wallPointUnderPointer, wallUnderPointer, hoveredWallId, setHoveredWall, isWallPickMode, setWallPickMode };
}
