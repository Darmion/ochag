import { HighlightLayer, Color3, StandardMaterial, Mesh, MeshBuilder, Scene } from '@babylonjs/core';
import { footprintCells } from '../grid';
import type { ObjectRecord } from '../sceneTypes';

export type MultiHighlightDeps = {
  scene: Scene;
  objectEntries: Map<string, ObjectRecord>;
  multi: () => { objects: Set<string>; walls: Set<string>; templates: Set<string>; };
  refreshWallOutlines: () => void;
  highlightTemplates: (selected: Set<string>) => void;
};

export function createMultiHighlight({
  scene, objectEntries, multi, refreshWallOutlines, highlightTemplates,
}: MultiHighlightDeps) {
  const multiHighlight = new HighlightLayer('multi-highlight', scene);
  multiHighlight.blurHorizontalSize = 1.6;
  multiHighlight.blurVerticalSize = 1.6;
  const multiColor = Color3.FromHexString('#6fe3d0');
  const multiRingMaterial = new StandardMaterial('multi-ring', scene);
  multiRingMaterial.disableLighting = true;
  multiRingMaterial.emissiveColor = multiColor;
  const multiRings = new Map<string, Mesh>();

  function refreshMulti() {
    multiHighlight.removeAllMeshes();
    for (const [id, ring] of multiRings) {
      if (!multi().objects.has(id) || !objectEntries.has(id)) {
        ring.dispose();
        multiRings.delete(id);
      }
    }
    for (const id of multi().objects) {
      const record = objectEntries.get(id);
      if (!record) continue;
      for (const mesh of record.content.meshes()) {
        if (mesh instanceof Mesh) multiHighlight.addMesh(mesh, multiColor);
      }
      if (!multiRings.has(id)) {
        const size = footprintCells(record.data.size);
        const ring = MeshBuilder.CreateTorus(`multi-ring-${id}`, { diameter: size * 0.98, thickness: 0.07, tessellation: 40 }, scene);
        ring.material = multiRingMaterial;
        ring.isPickable = false;
        multiRings.set(id, ring);
      }
    }
    highlightTemplates(multi().templates);
    refreshWallOutlines();
  }

  scene.onBeforeRenderObservable.add(() => {
    for (const [id, ring] of multiRings) {
      const holder = objectEntries.get(id)?.holder;
      if (!holder) continue;
      const at = holder.getAbsolutePosition();
      ring.position.set(at.x, 0.04, at.z);
      ring.setEnabled(holder.isEnabled());
    }
  });

  return { refreshMulti };
}
