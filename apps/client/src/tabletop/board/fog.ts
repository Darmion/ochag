import { MeshBuilder, DynamicTexture, Texture, StandardMaterial, Color3, Scene } from '@babylonjs/core';
import type { SeenLight, FogState, FogCell } from '../sceneTypes';

export type FogDeps = {
  widthCells: number;
  heightCells: number;
  scene: Scene;
};

export function createFog({ widthCells, heightCells, scene }: FogDeps) {
  const fogGround = MeshBuilder.CreateGround(
    'fog', { width: widthCells, height: heightCells }, scene,
  );
  fogGround.position.y = 0.025;
  fogGround.isPickable = false;
  const fogTexture = new DynamicTexture(
    'fog-texture', { width: widthCells, height: heightCells }, scene, false,
  );
  fogTexture.hasAlpha = true;
  fogTexture.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE);
  const fogMaterial = new StandardMaterial('fog-material', scene);
  fogMaterial.diffuseTexture = fogTexture;
  // Transparency from the canvas alpha; otherwise an alpha texture is used as a cut-out (alpha test).
  fogMaterial.useAlphaFromDiffuseTexture = true;
  fogMaterial.emissiveColor = new Color3(1, 1, 1);
  fogMaterial.disableLighting = true;
  fogMaterial.backFaceCulling = false;
  fogGround.material = fogMaterial;
  fogGround.setEnabled(false);

  function paintFogCell(ctx: CanvasRenderingContext2D, x: number, z: number, clear: boolean) {
    const col = Math.round(x + widthCells / 2 - 0.5);
    const row = Math.round(z + heightCells / 2 - 0.5);
    ctx.clearRect(col, row, 1, 1);
    if (!clear) ctx.fillRect(col, row, 1, 1);
  }

  const SHADE: Record<SeenLight, string | null> = {
    bright: null,
    dim: 'rgba(10,8,22,0.3)',
    dark: 'rgba(70,78,92,0.55)',
  };
  let fogState: FogState = null;
  let fogPreview: FogCell[] | null = null;
  let lightMap: string | null = null;

  function paintSeen(ctx: CanvasRenderingContext2D, cell: FogCell) {
    paintFogCell(ctx, cell.x, cell.z, true);
    const shade = SHADE[cell.light ?? 'bright'];
    if (!shade) return;
    ctx.fillStyle = shade;
    paintFogCell(ctx, cell.x, cell.z, false);
  }

  function paintVision() {
    const ctx = fogTexture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, widthCells, heightCells);

    if (fogState) {
      ctx.fillStyle = 'rgba(6,3,2,1)';
      ctx.fillRect(0, 0, widthCells, heightCells);
      ctx.fillStyle = 'rgba(6,3,2,0.6)';
      for (const cell of fogState.exploredCells) paintFogCell(ctx, cell.x, cell.z, false);
      for (const cell of fogState.visibleCells) paintSeen(ctx, cell);
    } else if (fogPreview) {
      ctx.fillStyle = 'rgba(6,3,2,0.72)';
      ctx.fillRect(0, 0, widthCells, heightCells);
      for (const cell of fogPreview) paintSeen(ctx, cell);
    } else if (lightMap && lightMap.length === widthCells * heightCells) {
      for (let index = 0; index < lightMap.length; index += 1) {
        const level = lightMap[index];
        if (level === '2') continue;
        ctx.fillStyle = level === '1' ? 'rgba(12,14,34,0.3)' : 'rgba(8,10,26,0.62)';
        ctx.fillRect(index % widthCells, Math.floor(index / widthCells), 1, 1);
      }
    } else {
      fogGround.setEnabled(false);
      return;
    }

    fogTexture.update(false);
    fogGround.setEnabled(true);
  }

  function setFog(fog: FogState) {
    fogState = fog;
    paintVision();
  }

  function setFogPreview(cells: FogCell[] | null) {
    fogPreview = cells;
    paintVision();
  }

  function setLightMap(map: string | null) {
    lightMap = map;
    paintVision();
  }

  return { setFog, setFogPreview, setLightMap };
}
