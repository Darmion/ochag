import { Mesh, StandardMaterial } from '@babylonjs/core';
import { footprintCells } from '../grid';
import { inArea, type Area } from '../areas';
import type { AreaTemplate, PlacedObject, ObjectRecord } from '../sceneTypes';

export type AreaTemplatesDeps = {
  objectEntries: Map<string, ObjectRecord>;
  refreshLabel: (objectId: string) => void;
  multi: () => { objects: Set<string>; walls: Set<string>; templates: Set<string>; };
  tintMaterial: (name: string, color: string, alpha: number) => StandardMaterial;
  areaTiles: (area: Area, name: string) => Mesh | null;
  refreshMulti: () => void;
};

export function createAreaTemplates({
  objectEntries, refreshLabel, multi, tintMaterial, areaTiles, refreshMulti,
}: AreaTemplatesDeps) {
  const templateMeshes = new Map<string, { key: string; mesh: Mesh | null; material: StandardMaterial }>();
  let templateAreas: AreaTemplate[] = [];

  function setTemplates(list: AreaTemplate[]) {
    templateAreas = list;
    const wanted = new Set(list.map(template => template.id));
    for (const [id, entry] of templateMeshes) {
      if (wanted.has(id)) continue;
      entry.mesh?.dispose();
      entry.material.dispose();
      templateMeshes.delete(id);
    }
    for (const template of list) {
      const key = JSON.stringify([template.shape, template.x, template.z, template.direction, template.size, template.width, template.color]);
      const existing = templateMeshes.get(template.id);
      if (existing?.key === key) continue;
      existing?.mesh?.dispose();
      existing?.material.dispose();
      const material = tintMaterial(`template-${template.id}`, template.color, 0.34);
      const mesh = areaTiles(template, `template-${template.id}`);
      if (mesh) mesh.material = material;
      templateMeshes.set(template.id, { key, mesh, material });
    }
    for (const id of objectEntries.keys()) refreshLabel(id);
    if (multi().templates.size) refreshMulti();
  }

  function inAnyTemplate(record: { data: PlacedObject }) {
    if (!templateAreas.length) return false;
    const n = footprintCells(record.data.size);
    const half = n / 2;
    for (let dz = 0; dz < n; dz += 1) {
      for (let dx = 0; dx < n; dx += 1) {
        const x = record.data.world_x - half + 0.5 + dx;
        const z = record.data.world_z - half + 0.5 + dz;
        if (templateAreas.some(area => inArea(area, x, z))) return true;
      }
    }
    return false;
  }

  function templateList() {
    return templateAreas;
  }

  function highlightTemplates(selected: Set<string>) {
    for (const [id, entry] of templateMeshes) entry.material.alpha = selected.has(id) ? 0.62 : 0.34;
  }

  return { setTemplates, inAnyTemplate, templateList, highlightTemplates };
}
