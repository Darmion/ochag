import { StandardMaterial, Color3, Mesh, MeshBuilder, Scene, TransformNode } from '@babylonjs/core';
import { footprintCells } from '../grid';
import type { ObjectRecord } from '../sceneTypes';

export type RangeFrameDeps = {
  scene: Scene;
  objectEntries: Map<string, ObjectRecord>;
  rootOf: (objectId: string) => TransformNode | null;
};

export function createRangeFrame({ scene, objectEntries, rootOf }: RangeFrameDeps) {
  const rangeMaterial = new StandardMaterial('range-frame', scene);
  rangeMaterial.disableLighting = true;
  rangeMaterial.emissiveColor = Color3.FromHexString('#ffcf6e');
  rangeMaterial.alpha = 0.8;
  let rangeFrame: Mesh | null = null;
  let rangeObjectId = '';
  let rangeKey = '';

  function setRangeFrame(objectId: string | null, radius: number | null) {
    const n = objectId ? footprintCells(objectEntries.get(objectId)?.data.size) : 0;
    const half = radius && radius > 0 ? radius + n / 2 : 0;
    const key = objectId && half ? `${half}` : '';
    rangeObjectId = key ? objectId! : '';
    if (key === rangeKey) return;
    rangeKey = key;
    rangeFrame?.dispose();
    rangeFrame = null;
    if (!key) return;

    const side = half * 2;
    const bars = [
      { w: side, d: 0.05, x: 0, z: half }, { w: side, d: 0.05, x: 0, z: -half },
      { w: 0.05, d: side, x: half, z: 0 }, { w: 0.05, d: side, x: -half, z: 0 },
    ].map(bar => {
      const mesh = MeshBuilder.CreateBox('range-bar', { width: bar.w, depth: bar.d, height: 0.02 }, scene);
      mesh.position.set(bar.x, 0, bar.z);
      return mesh;
    });
    rangeFrame = Mesh.MergeMeshes(bars, true, true) ?? null;
    if (rangeFrame) {
      rangeFrame.material = rangeMaterial;
      rangeFrame.isPickable = false;
    }
  }

  scene.onBeforeRenderObservable.add(() => {
    if (!rangeFrame) return;
    const holder = rangeObjectId ? rootOf(rangeObjectId) : null;
    rangeFrame.setEnabled(Boolean(holder));
    if (holder) rangeFrame.position.set(holder.position.x, 0.03, holder.position.z);
  });

  return { setRangeFrame };
}
