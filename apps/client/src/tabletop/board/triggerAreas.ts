import { Mesh, StandardMaterial } from '@babylonjs/core';
import type { Area } from '../areas';

export type TriggerAreasDeps = {
  tintMaterial: (name: string, color: string, alpha: number) => StandardMaterial;
  areaTiles: (area: Area, name: string) => Mesh | null;
};

export function createTriggerAreas({ tintMaterial, areaTiles }: TriggerAreasDeps) {
  const triggerMaterial = tintMaterial('trigger-area', '#c4504f', 0.18);
  let triggerMesh: Mesh | null = null;
  let triggerKey = '';

  function setTriggerAreas(list: Area[]) {
    const key = JSON.stringify(list);
    if (key === triggerKey) return;
    triggerKey = key;
    triggerMesh?.dispose();
    triggerMesh = null;
    const meshes = list.map((area, index) => areaTiles(area, `trigger-${index}`)).filter((mesh): mesh is Mesh => Boolean(mesh));
    if (!meshes.length) return;
    triggerMesh = Mesh.MergeMeshes(meshes, true, true) ?? null;
    if (triggerMesh) {
      triggerMesh.material = triggerMaterial;
      triggerMesh.isPickable = false;
    }
  }

  const triggerHighlightMaterial = tintMaterial('trigger-highlight', '#ff6b5c', 0.45);
  let triggerHighlight: Mesh | null = null;
  function setTriggerHighlight(area: Area | null) {
    triggerHighlight?.dispose();
    triggerHighlight = null;
    if (!area) return;
    triggerHighlight = areaTiles(area, 'trigger-highlight') ?? null;
    if (triggerHighlight) {
      triggerHighlight.material = triggerHighlightMaterial;
      triggerHighlight.isPickable = false;
      triggerHighlight.position.y += 0.005;
    }
  }

  return { setTriggerAreas, setTriggerHighlight };
}
