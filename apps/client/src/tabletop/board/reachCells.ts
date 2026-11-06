import { StandardMaterial, Color3, Mesh, Vector3, MeshBuilder, DynamicTexture, Texture, Scene } from '@babylonjs/core';

export type ReachCellsDeps = {
  widthCells: number;
  heightCells: number;
  scene: Scene;
};

export function createReachCells({ widthCells, heightCells, scene }: ReachCellsDeps) {
  const reachMaterial = new StandardMaterial('reach-cells', scene);
  reachMaterial.disableLighting = true;
  reachMaterial.emissiveColor = Color3.FromHexString('#4fb4ff');
  reachMaterial.alpha = 0.14;
  let reachMesh: Mesh | null = null;
  let reachOutline: Mesh | null = null;
  let reachKey = '';
  let moveFilterOn = false;
  const showReach = () => {
    reachMesh?.setEnabled(!moveFilterOn);
    reachOutline?.setEnabled(!moveFilterOn);
  };

  function setReachCells(cells: number[][]) {
    const key = cells.map(([col, row]) => `${col}:${row}`).sort().join(',');
    if (key === reachKey) return;
    reachKey = key;
    reachMesh?.dispose();
    reachMesh = null;
    reachOutline?.dispose();
    reachOutline = null;
    if (!cells.length) return;

    const inside = new Set(cells.map(([col, row]) => `${col}:${row}`));
    const edges: Vector3[][] = [];
    const at = (x: number, z: number) => new Vector3(x - widthCells / 2, 0.03, z - heightCells / 2);
    for (const [col, row] of cells) {
      const c = col!, r = row!;
      if (!inside.has(`${c}:${r - 1}`)) edges.push([at(c, r), at(c + 1, r)]);
      if (!inside.has(`${c}:${r + 1}`)) edges.push([at(c, r + 1), at(c + 1, r + 1)]);
      if (!inside.has(`${c - 1}:${r}`)) edges.push([at(c, r), at(c, r + 1)]);
      if (!inside.has(`${c + 1}:${r}`)) edges.push([at(c + 1, r), at(c + 1, r + 1)]);
    }
    const outline = MeshBuilder.CreateLineSystem('reach-outline', { lines: edges }, scene);
    outline.color = Color3.FromHexString('#8fd0ff');
    outline.alpha = 0.75;
    outline.isPickable = false;
    reachOutline = outline;

    const tiles = cells.map(([col, row]) => {
      const tile = MeshBuilder.CreateGround('reach-tile', { width: 1, height: 1 }, scene);
      tile.position.set(col! - widthCells / 2 + 0.5, 0.029, row! - heightCells / 2 + 0.5);
      return tile;
    });
    reachMesh = Mesh.MergeMeshes(tiles, true, true) ?? null;
    if (reachMesh) {
      reachMesh.material = reachMaterial;
      reachMesh.isPickable = false;
    }
    showReach();
  }

  const moveFilterGround = MeshBuilder.CreateGround('move-filter', { width: widthCells, height: heightCells }, scene);
  moveFilterGround.position.y = 0.027;
  moveFilterGround.isPickable = false;
  const moveFilterTexture = new DynamicTexture('move-filter-texture', { width: widthCells, height: heightCells }, scene, false);
  moveFilterTexture.hasAlpha = true;
  moveFilterTexture.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE);
  const moveFilterMaterial = new StandardMaterial('move-filter-material', scene);
  moveFilterMaterial.diffuseTexture = moveFilterTexture;
  moveFilterMaterial.useAlphaFromDiffuseTexture = true;
  moveFilterMaterial.emissiveColor = new Color3(1, 1, 1);
  moveFilterMaterial.disableLighting = true;
  moveFilterMaterial.backFaceCulling = false;
  moveFilterGround.material = moveFilterMaterial;
  moveFilterGround.setEnabled(false);

  function setMoveFilter(cells: number[][] | null) {
    moveFilterOn = Boolean(cells);
    showReach();
    if (!cells) {
      moveFilterGround.setEnabled(false);
      return;
    }
    const ctx = moveFilterTexture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, widthCells, heightCells);
    ctx.fillStyle = 'rgba(214,48,36,0.34)';
    ctx.fillRect(0, 0, widthCells, heightCells);
    ctx.fillStyle = 'rgba(60,205,96,0.42)';
    for (const [col, row] of cells) {
      ctx.clearRect(col!, row!, 1, 1);
      ctx.fillRect(col!, row!, 1, 1);
    }
    moveFilterTexture.update(false);
    moveFilterGround.setEnabled(true);
  }

  return { setReachCells, setMoveFilter };
}
