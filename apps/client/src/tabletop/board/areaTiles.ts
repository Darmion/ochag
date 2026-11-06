import { MeshBuilder, Mesh, StandardMaterial, Color3, Scene } from '@babylonjs/core';
import { type Area, areaCells } from '../areas';

export type AreaTilesDeps = {
  widthCells: number;
  heightCells: number;
  scene: Scene;
};

export function createAreaTiles({ widthCells, heightCells, scene }: AreaTilesDeps) {
  function areaTiles(area: Area, name: string) {
    const tiles = areaCells(area, { widthCells, heightCells }).map(({ col, row }) => {
      const tile = MeshBuilder.CreateGround(name, { width: 0.96, height: 0.96 }, scene);
      tile.position.set(col - widthCells / 2 + 0.5, 0.032, row - heightCells / 2 + 0.5);
      return tile;
    });
    if (!tiles.length) return null;
    const merged = Mesh.MergeMeshes(tiles, true, true);
    if (merged) merged.isPickable = false;
    return merged ?? null;
  }

  function tintMaterial(name: string, color: string, alpha: number) {
    const material = new StandardMaterial(name, scene);
    material.disableLighting = true;
    material.emissiveColor = Color3.FromHexString(color);
    material.alpha = alpha;
    return material;
  }

  return { areaTiles, tintMaterial };
}
