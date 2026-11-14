import { StandardMaterial, DynamicTexture, Color3, Mesh, MeshBuilder, Scene, Texture } from '@babylonjs/core';

export type TerrainDeps = {
  widthCells: number;
  heightCells: number;
  scene: Scene;
  reducedMotion: boolean;
};

function waterMaterial(name: string, scene: Scene, base: string, crest: string) {
  const texture = new DynamicTexture(`${name}-waves`, { width: 64, height: 64 }, scene, true);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = crest;
  ctx.lineWidth = 2;
  // One sine period per tile width and rows every 16 px: the pattern tiles without seams.
  for (let row = 8; row < 64; row += 16) {
    ctx.beginPath();
    for (let x = 0; x <= 64; x += 4) {
      const y = row + Math.sin((x / 64) * Math.PI * 2 + row) * 3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  texture.hasAlpha = true;
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.update();
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.emissiveTexture = texture;
  material.emissiveColor = Color3.White();
  return { material, texture };
}

export function createTerrain({ widthCells, heightCells, scene, reducedMotion }: TerrainDeps) {
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

  function tilesAt(name: string, cells: number[][], size: number, height: number) {
    const tiles = cells.map(([col, row]) => {
      const tile = MeshBuilder.CreateGround(name, { width: size, height: size }, scene);
      tile.position.set(col! - widthCells / 2 + 0.5, height, row! - heightCells / 2 + 0.5);
      return tile;
    });
    const merged = Mesh.MergeMeshes(tiles, true, true) ?? null;
    if (merged) {
      merged.isPickable = false;
      merged.alphaIndex = 0;
    }
    return merged;
  }

  function setDifficultCells(cells: number[][]) {
    const key = cells.map(([col, row]) => `${col}:${row}`).sort().join(',');
    if (key === terrainKey) return;
    terrainKey = key;
    terrainMesh?.dispose();
    terrainMesh = null;
    if (!cells.length) return;
    terrainMesh = tilesAt('difficult-tile', cells, 0.96, 0.008);
    if (terrainMesh) terrainMesh.material = terrainMaterial;
  }

  const shallow = waterMaterial('shallow-water', scene, 'rgba(92, 170, 190, 0.42)', 'rgba(210, 240, 245, 0.55)');
  const deep = waterMaterial('deep-water', scene, 'rgba(22, 64, 120, 0.78)', 'rgba(120, 175, 225, 0.5)');
  const waterMeshes: Mesh[] = [];
  let waterKey = '';

  function setWaterCells(cells: number[][]) {
    const key = cells.map(([col, row, depth]) => `${col}:${row}:${depth}`).sort().join(',');
    if (key === waterKey) return;
    waterKey = key;
    for (const mesh of waterMeshes.splice(0)) mesh.dispose();
    for (const [depth, look] of [[1, shallow], [2, deep]] as const) {
      const mesh = tilesAt(depth === 2 ? 'deep-water-tile' : 'shallow-water-tile', cells.filter(cell => cell[2] === depth), 1, 0.006);
      if (!mesh) continue;
      mesh.material = look.material;
      waterMeshes.push(mesh);
    }
  }

  if (!reducedMotion) {
    let time = 0;
    scene.onBeforeRenderObservable.add(() => {
      if (!waterMeshes.length) return;
      time += scene.getEngine().getDeltaTime() / 1000;
      shallow.texture.uOffset = (time * 0.05) % 1;
      shallow.texture.vOffset = Math.sin(time * 0.6) * 0.03;
      deep.texture.uOffset = (time * 0.025) % 1;
      deep.texture.vOffset = (time * 0.04) % 1;
    });
  }

  const reliefMeshes: Mesh[] = [];
  const reliefMaterials: StandardMaterial[] = [];
  const labelTextures: DynamicTexture[] = [];
  let reliefKey = '';

  function flatMaterial(name: string, color: Color3, alpha: number) {
    const material = new StandardMaterial(name, scene);
    material.disableLighting = true;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = color;
    material.alpha = alpha;
    reliefMaterials.push(material);
    return material;
  }

  // Heights stay flat on the board so that reach, areas, water and fog keep lying on it: a tint per height, a low lip
  // on every change of height and one label per patch of equal height.
  function setElevationCells(cells: number[][]) {
    const key = cells.map(([col, row, feet]) => `${col}:${row}:${feet}`).sort().join(',');
    if (key === reliefKey) return;
    reliefKey = key;
    for (const mesh of reliefMeshes.splice(0)) mesh.dispose();
    for (const material of reliefMaterials.splice(0)) material.dispose();
    for (const texture of labelTextures.splice(0)) texture.dispose();
    if (!cells.length) return;

    const heights = new Map(cells.map(([col, row, feet]) => [`${col}:${row}`, feet!]));
    const at = (col: number, row: number) => heights.get(`${col}:${row}`) ?? 0;
    for (const feet of new Set(cells.map(cell => cell[2]!))) {
      const tiles = tilesAt('relief-tile', cells.filter(cell => cell[2] === feet), 1, 0.004);
      if (!tiles) continue;
      tiles.material = feet > 0
        ? flatMaterial(`relief-${feet}`, new Color3(0.78, 0.62, 0.36), Math.min(0.55, 0.16 + feet / 70))
        : flatMaterial(`relief-${feet}`, new Color3(0.06, 0.04, 0.1), Math.min(0.75, 0.32 + -feet / 50));
      reliefMeshes.push(tiles);
    }

    const lips: Mesh[] = [];
    const lip = (x: number, z: number, alongX: boolean, diff: number) => {
      const tall = Math.min(0.42, 0.08 + Math.abs(diff) / 50);
      const box = MeshBuilder.CreateBox('relief-lip', { width: alongX ? 1 : 0.07, depth: alongX ? 0.07 : 1, height: tall }, scene);
      box.position.set(x, tall / 2, z);
      lips.push(box);
    };
    const cols = new Set<number>(), rows = new Set<number>();
    for (const [col, row] of cells) {
      for (const c of [col! - 1, col!, col! + 1]) cols.add(c);
      for (const r of [row! - 1, row!, row! + 1]) rows.add(r);
    }
    for (const col of cols) {
      for (const row of rows) {
        if (col < 0 || row < 0 || col >= widthCells || row >= heightCells) continue;
        const here = at(col, row);
        if (col + 1 < widthCells && at(col + 1, row) !== here) lip(col + 1 - widthCells / 2, row - heightCells / 2 + 0.5, false, at(col + 1, row) - here);
        if (row + 1 < heightCells && at(col, row + 1) !== here) lip(col - widthCells / 2 + 0.5, row + 1 - heightCells / 2, true, at(col, row + 1) - here);
      }
    }
    const merged = Mesh.MergeMeshes(lips, true, true);
    if (merged) {
      merged.isPickable = false;
      merged.alphaIndex = 0;
      merged.material = flatMaterial('relief-lips', new Color3(0.28, 0.2, 0.12), 0.9);
      reliefMeshes.push(merged);
    }

    const seen = new Set<string>();
    for (const [startCol, startRow, feet] of [...cells].sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]!)) {
      if (seen.has(`${startCol}:${startRow}`)) continue;
      const stack = [[startCol!, startRow!]];
      while (stack.length) {
        const [col, row] = stack.pop()!;
        const id = `${col}:${row}`;
        if (seen.has(id) || at(col!, row!) !== feet) continue;
        seen.add(id);
        stack.push([col! + 1, row!], [col! - 1, row!], [col!, row! + 1], [col!, row! - 1]);
      }
      const texture = new DynamicTexture('relief-label', { width: 128, height: 64 }, scene, true);
      const ctx = texture.getContext() as CanvasRenderingContext2D;
      ctx.clearRect(0, 0, 128, 64);
      ctx.fillStyle = 'rgba(20, 14, 8, 0.72)';
      ctx.fillRect(8, 8, 112, 48);
      ctx.fillStyle = feet! > 0 ? '#f3d9a4' : '#c9c2e6';
      ctx.font = 'bold 34px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(feet! > 0 ? `+${feet}` : `−${-feet!}`, 64, 34);
      texture.hasAlpha = true;
      texture.update();
      labelTextures.push(texture);
      const label = MeshBuilder.CreateGround('relief-label', { width: 0.8, height: 0.4 }, scene);
      label.position.set(startCol! - widthCells / 2 + 0.5, 0.012, startRow! - heightCells / 2 + 0.3);
      label.isPickable = false;
      label.alphaIndex = 0;
      const material = flatMaterial('relief-label', Color3.White(), 1);
      material.diffuseTexture = texture;
      material.emissiveTexture = texture;
      material.useAlphaFromDiffuseTexture = true;
      label.material = material;
      reliefMeshes.push(label);
    }
  }

  return { setDifficultCells, setWaterCells, setElevationCells };
}
