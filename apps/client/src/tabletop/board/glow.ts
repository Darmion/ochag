import { DynamicTexture, MeshBuilder, StandardMaterial, Color3, Scene } from '@babylonjs/core';
import type { WallSegment, ObjectRecord } from '../sceneTypes';

export type GlowDeps = {
  scene: Scene;
  objectEntries: Map<string, ObjectRecord>;
  currentWalls: () => WallSegment[];
  wallsVersion: () => number;
};

export function createGlow({ scene, objectEntries, currentWalls, wallsVersion }: GlowDeps) {
  function raySegmentBlocked(ox: number, oz: number, tx: number, tz: number, wall: WallSegment): boolean {
    const rx = tx - ox;
    const rz = tz - oz;
    const sx = wall.x2 - wall.x1;
    const sz = wall.z2 - wall.z1;
    const denom = rx * sz - rz * sx;
    if (denom === 0) return false;
    const qpx = wall.x1 - ox;
    const qpz = wall.z1 - oz;
    const t = (qpx * sz - qpz * sx) / denom;
    const u = (qpx * rz - qpz * rx) / denom;
    const epsilon = 1e-9;
    return t > epsilon && t < 1 - epsilon && u > -epsilon && u < 1 + epsilon;
  }

  const GLOW_COLOR = { r: 255, g: 207, b: 112 };
  const GLOW_TEXELS_PER_UNIT = 8;
  const GLOW_MAX_TEXTURE = 192;

  const GLOW_CONE_HALF_ANGLE = Math.atan(0.5);
  function inGlowCone(dx: number, dz: number, direction: number) {
    if (Math.hypot(dx, dz) < 0.5) return true;
    const angle = (direction * Math.PI) / 180;
    const fx = Math.sin(angle), fz = Math.cos(angle);
    const along = dx * fx + dz * fz;
    return along > 0 && Math.abs(Math.atan2(dx * fz - dz * fx, along)) <= GLOW_CONE_HALF_ANGLE;
  }

  function paintGlowTexture(texture: DynamicTexture, texSize: number, radius: number, bright: number, originX: number, originZ: number, walls: WallSegment[], cone: number | null = null) {
    const nearby = walls.filter(wall =>
      Math.min(wall.x1, wall.x2) <= originX + radius && Math.max(wall.x1, wall.x2) >= originX - radius &&
      Math.min(wall.z1, wall.z2) <= originZ + radius && Math.max(wall.z1, wall.z2) >= originZ - radius);

    const ctx = texture.getContext() as CanvasRenderingContext2D;
    const image = ctx.createImageData(texSize, texSize);
    for (let py = 0; py < texSize; py += 1) {
      // v = 0 is the far −Z edge in the UV of Babylon's ground.
      const worldZ = originZ + radius - ((py + 0.5) / texSize) * radius * 2;
      for (let px = 0; px < texSize; px += 1) {
        const worldX = originX - radius + ((px + 0.5) / texSize) * radius * 2;
        const dist = Math.hypot(worldX - originX, worldZ - originZ);
        const index = (py * texSize + px) * 4;
        let alpha = 0;
        if (dist <= radius && (cone === null || inGlowCone(worldX - originX, worldZ - originZ, cone))) {
          alpha = dist <= bright ? 0.32 : 0.15;
          const edge = radius - dist;
          if (edge < 0.15) alpha *= Math.max(0, edge / 0.15);
          if (alpha > 0 && nearby.some(wall => raySegmentBlocked(originX, originZ, worldX, worldZ, wall))) alpha = 0;
        }
        image.data[index] = GLOW_COLOR.r;
        image.data[index + 1] = GLOW_COLOR.g;
        image.data[index + 2] = GLOW_COLOR.b;
        image.data[index + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
    texture.update(false);
  }

  function refreshGlow(record: ObjectRecord) {
    const light = record.data.light;
    const radius = light ? light.bright + light.dim : 0;
    const geometryKey = light && radius > 0 ? `${light.bright}:${light.dim}:${light.cone ?? ''}` : '';

    if (!geometryKey) {
      if (record.glow) { record.glow.mesh.material?.dispose(); record.glow.mesh.dispose(); record.glow.texture.dispose(); record.glow = null; }
      return;
    }

    const originX = record.data.world_x;
    const originZ = record.data.world_z;
    const contentKey = `${geometryKey}:${originX.toFixed(2)}:${originZ.toFixed(2)}:${wallsVersion()}`;
    if (record.glow?.contentKey === contentKey) return;

    if (record.glow?.geometryKey !== geometryKey) {
      record.glow?.mesh.material?.dispose();
      record.glow?.mesh.dispose();
      record.glow?.texture.dispose();

      const size = radius * 2;
      const texSize = Math.min(GLOW_MAX_TEXTURE, Math.max(16, Math.round(size * GLOW_TEXELS_PER_UNIT)));
      const mesh = MeshBuilder.CreateGround(`light-glow-${record.data.id}`, { width: size, height: size }, scene);
      mesh.isPickable = false;
      mesh.position.y = 0.012;
      const texture = new DynamicTexture(`light-glow-texture-${record.data.id}`, { width: texSize, height: texSize }, scene, false);
      texture.hasAlpha = true;
      const material = new StandardMaterial(`light-glow-material-${record.data.id}`, scene);
      material.disableLighting = true;
      material.emissiveColor = new Color3(1, 1, 1);
      material.diffuseTexture = texture;
      material.useAlphaFromDiffuseTexture = true;
      material.backFaceCulling = false;
      mesh.material = material;
      record.glow = { geometryKey, contentKey: '', mesh, texture };
    }

    const glow = record.glow;
    const texSize = glow.texture.getSize().width;
    const sightWalls = currentWalls().filter(wall => !wall.broken && (wall.kind ?? 'wall') !== 'window' && !(wall.kind === 'door' && wall.open));
    paintGlowTexture(glow.texture, texSize, radius, light!.bright, originX, originZ, sightWalls, light!.cone ?? null);
    glow.contentKey = contentKey;
  }

  scene.onBeforeRenderObservable.add(() => {
    for (const record of objectEntries.values()) {
      if (!record.glow) continue;
      const { position } = record.holder;
      record.glow.mesh.position.x = position.x;
      record.glow.mesh.position.z = position.z;
      record.glow.mesh.setEnabled(record.holder.isEnabled());
    }
  });

  return { refreshGlow };
}
