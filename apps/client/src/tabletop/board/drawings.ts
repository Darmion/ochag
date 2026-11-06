import { StandardMaterial, Color3, Vector3, MeshBuilder, Mesh, Scene } from '@babylonjs/core';
import type { LabelApi } from './labels';
import type { DrawingRecord, Drawing } from '../sceneTypes';

export type DrawingsDeps = Pick<LabelApi, 'createLabel' | 'removeLabel' | 'setLabelText'> & {
  scene: Scene;
};

export function createDrawings({ scene, removeLabel, createLabel, setLabelText }: DrawingsDeps) {
  const drawingRecords = new Map<string, DrawingRecord>();
  const drawingMaterials = new Map<string, StandardMaterial>();

  function drawingMaterial(color: string) {
    let mat = drawingMaterials.get(color);
    if (!mat) {
      mat = new StandardMaterial(`drawing-${color}`, scene);
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.emissiveColor = Color3.FromHexString(color);
      mat.disableLighting = true;
      drawingMaterials.set(color, mat);
    }
    return mat;
  }

  function disposeDrawing(id: string) {
    const record = drawingRecords.get(id);
    if (!record) return;
    record.mesh?.dispose();
    removeLabel(record.label);
    drawingRecords.delete(id);
  }

  function setDrawings(drawings: Drawing[]) {
    const wanted = new Set(drawings.map(d => d.id));
    for (const id of [...drawingRecords.keys()]) if (!wanted.has(id)) disposeDrawing(id);

    for (const drawing of drawings) {
      const key = `${drawing.kind}:${drawing.color}:${drawing.width}:${drawing.layer}:${drawing.text ?? ''}:${JSON.stringify(drawing.points)}`;
      if (drawingRecords.get(drawing.id)?.key === key) continue;
      disposeDrawing(drawing.id);

      const record: DrawingRecord = { mesh: null, label: null, key };

      if (drawing.kind === 'path' && drawing.points.length >= 2) {
        const path = drawing.points.map(([x, z]) => new Vector3(x!, 0.02, z!));
        const tube = MeshBuilder.CreateTube(`drawing-${drawing.id}`, {
          path, radius: drawing.width / 2, tessellation: 6, cap: Mesh.CAP_ALL,
        }, scene);
        tube.material = drawingMaterial(drawing.color);
        tube.isPickable = false;
        tube.visibility = drawing.layer === 'gm' ? 0.7 : 1;
        record.mesh = tube;
      } else if (drawing.kind === 'text' && drawing.points[0]) {
        const [x, z] = drawing.points[0];
        const anchor = new Vector3(x!, 0.05, z!);
        record.label = createLabel(`drawing-label${drawing.layer === 'gm' ? ' is-gm-layer' : ''}`, () => anchor);
        if (record.label) record.label.el.translate = false;
        record.label?.el.style.setProperty('--signal-color', drawing.color);
        setLabelText(record.label, drawing.text ?? '');
      }

      drawingRecords.set(drawing.id, record);
    }
  }

  return { setDrawings };
}
