import { Mesh, MeshBuilder, PointerEventTypes, Scene, ArcRotateCamera, StandardMaterial } from '@babylonjs/core';
import type { Position } from '../grid';
import type { GridCellRef, ToolHooks } from '../sceneTypes';

export type TerrainBrushDeps = {
  canvas: HTMLCanvasElement;
  widthCells: number;
  heightCells: number;
  tools: ToolHooks;
  scene: Scene;
  camera: ArcRotateCamera;
  cameraGesture: (event: unknown) => boolean;
  holdCamera: (event: unknown) => void;
  tintMaterial: (name: string, color: string, alpha: number) => StandardMaterial;
  pickGroundPoint: (snap: boolean) => Position | null;
};

export function createTerrainBrush({
  canvas, widthCells, heightCells, tools, scene, camera, cameraGesture, holdCamera, tintMaterial,
  pickGroundPoint,
}: TerrainBrushDeps) {
  let terrainBrushActive = false;
  let terrainDrag: { start: GridCellRef; end: GridCellRef } | null = null;
  const terrainPreviewMaterial = tintMaterial('terrain-preview', '#e0a050', 0.42);
  let terrainPreview: Mesh | null = null;

  function cellAt(point: Position): GridCellRef {
    return {
      col: Math.max(0, Math.min(widthCells - 1, Math.floor(point.x + widthCells / 2))),
      row: Math.max(0, Math.min(heightCells - 1, Math.floor(point.z + heightCells / 2))),
    };
  }

  function showTerrainPreview() {
    terrainPreview?.dispose();
    terrainPreview = null;
    if (!terrainDrag) return;
    const { start, end } = terrainDrag;
    const tiles: Mesh[] = [];
    for (let col = Math.min(start.col, end.col); col <= Math.max(start.col, end.col); col += 1) {
      for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
        const tile = MeshBuilder.CreateGround('terrain-preview-tile', { width: 0.94, height: 0.94 }, scene);
        tile.position.set(col - widthCells / 2 + 0.5, 0.02, row - heightCells / 2 + 0.5);
        tiles.push(tile);
      }
    }
    terrainPreview = Mesh.MergeMeshes(tiles, true, true) ?? null;
    if (terrainPreview) {
      terrainPreview.material = terrainPreviewMaterial;
      terrainPreview.isPickable = false;
    }
  }

  function isTerrainBrush() {
    return terrainBrushActive;
  }

  function terrainDragActive() {
    return terrainDrag !== null;
  }

  function cancelTerrainDrag() {
    if (!terrainDrag) return;
    terrainDrag = null;
    camera.attachControl(canvas, true);
    showTerrainPreview();
  }

  function setTerrainBrush(enabled: boolean) {
    terrainBrushActive = enabled;
    if (!enabled) cancelTerrainDrag();
  }

  scene.onPointerObservable.add(info => {
    if (!terrainBrushActive) return;
    if (info.type === PointerEventTypes.POINTERDOWN) {
      if (info.event.button !== 0 || cameraGesture(info.event)) return;
      const point = pickGroundPoint(false);
      if (!point) return;
      const cell = cellAt(point);
      terrainDrag = { start: cell, end: cell };
      holdCamera(info.event);
      showTerrainPreview();
      return;
    }
    if (info.type === PointerEventTypes.POINTERMOVE && terrainDrag) {
      const point = pickGroundPoint(false);
      if (!point) return;
      const cell = cellAt(point);
      if (cell.col === terrainDrag.end.col && cell.row === terrainDrag.end.row) return;
      terrainDrag.end = cell;
      showTerrainPreview();
      return;
    }
    if (info.type === PointerEventTypes.POINTERUP && terrainDrag) {
      const drag = terrainDrag;
      terrainDrag = null;
      camera.attachControl(canvas, true);
      showTerrainPreview();
      tools.onTerrainRect?.(drag.start, drag.end);
    }
  });

  return { isTerrainBrush, terrainDragActive, cancelTerrainDrag, setTerrainBrush };
}
