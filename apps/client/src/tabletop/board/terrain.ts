import { StandardMaterial, DynamicTexture, Color3, Mesh, MeshBuilder, Scene } from '@babylonjs/core';

export type TerrainDeps = {
  widthCells: number;
  heightCells: number;
  scene: Scene;
};

export function createTerrain({ widthCells, heightCells, scene }: TerrainDeps) {
  const terrainMaterial = new StandardMaterial('difficult-terrain', scene);
  terrainMaterial.disableLighting = true;
  const terrainHatch = new DynamicTexture('difficult-terrain-hatch', { width: 64, height: 64 }, scene, true);
  {
    const ctx = terrainHatch.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(90, 60, 30, 0.35)';
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(236, 184, 92, 0.75)';
    ctx.lineWidth = 4;
    for (let k = -64; k <= 64; k += 16) {
      ctx.beginPath();
      ctx.moveTo(k, 64);
      ctx.lineTo(k + 64, 0);
      ctx.stroke();
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(236, 184, 92, 0.9)';
    ctx.strokeRect(1.5, 1.5, 61, 61);
    terrainHatch.hasAlpha = true;
    terrainHatch.update();
  }
  terrainMaterial.diffuseColor = Color3.Black();
  terrainMaterial.specularColor = Color3.Black();
  terrainMaterial.diffuseTexture = terrainHatch;
  terrainMaterial.useAlphaFromDiffuseTexture = true;
  terrainMaterial.emissiveTexture = terrainHatch;
  terrainMaterial.emissiveColor = Color3.White();
  let terrainMesh: Mesh | null = null;
  let terrainKey = '';

  function setDifficultCells(cells: number[][]) {
    const key = cells.map(([col, row]) => `${col}:${row}`).sort().join(',');
    if (key === terrainKey) return;
    terrainKey = key;
    terrainMesh?.dispose();
    terrainMesh = null;
    if (!cells.length) return;

    const tiles = cells.map(([col, row]) => {
      const tile = MeshBuilder.CreateGround('difficult-tile', { width: 0.96, height: 0.96 }, scene);
      tile.position.set(col! - widthCells / 2 + 0.5, 0.008, row! - heightCells / 2 + 0.5);
      return tile;
    });
    terrainMesh = Mesh.MergeMeshes(tiles, true, true) ?? null;
    if (terrainMesh) {
      terrainMesh.material = terrainMaterial;
      terrainMesh.isPickable = false;
    }
  }

  return { setDifficultCells };
}
