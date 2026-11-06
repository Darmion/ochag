import { StandardMaterial, Color3, Mesh, MeshBuilder, Scene } from '@babylonjs/core';
import type { Position } from '../grid';

export type PlacementPreviewsDeps = {
  scene: Scene;
};

export function createPlacementPreviews({ scene }: PlacementPreviewsDeps) {
  const placePreviewMaterial = new StandardMaterial('place-preview-material', scene);
  placePreviewMaterial.diffuseColor = Color3.Black();
  placePreviewMaterial.specularColor = Color3.Black();
  placePreviewMaterial.emissiveColor = Color3.FromHexString('#f0c96a');
  placePreviewMaterial.alpha = 0.45;
  placePreviewMaterial.disableLighting = true;

  let placePreviewMembers: Array<{ dx: number; dz: number }> | null = null;
  let placePreviewNodes: Mesh[] = [];
  function placePreviewActive() {
    return Boolean(placePreviewMembers);
  }

  function clearPlacePreviewNodes() {
    for (const mesh of placePreviewNodes) mesh.dispose();
    placePreviewNodes = [];
  }

  function setPlacePreview(members: Array<{ dx: number; dz: number }> | null) {
    clearPlacePreviewNodes();
    placePreviewMembers = members && members.length ? members : null;
    if (!placePreviewMembers) return;

    for (let index = 0; index < placePreviewMembers.length; index += 1) {
      const marker = MeshBuilder.CreateCylinder(`place-preview-${index}`, { diameter: 0.7, height: 0.05, tessellation: 20 }, scene);
      marker.material = placePreviewMaterial;
      marker.isPickable = false;
      marker.position.y = 0.05;
      marker.setEnabled(false);
      placePreviewNodes.push(marker);
    }
  }

  let groupPreview: { center: Position; points: Position[] } | null = null;
  let groupPreviewNodes: Mesh[] = [];
  function groupPreviewActive() {
    return Boolean(groupPreview);
  }
  function setGroupPreview(preview: { center: Position; points: Position[] } | null) {
    for (const mesh of groupPreviewNodes) mesh.dispose();
    groupPreviewNodes = [];
    groupPreview = preview && preview.points.length ? preview : null;
    if (!groupPreview) return;
    groupPreviewNodes = groupPreview.points.map((_, index) => {
      const marker = MeshBuilder.CreateCylinder(`group-preview-${index}`, { diameter: 0.7, height: 0.05, tessellation: 20 }, scene);
      marker.material = placePreviewMaterial;
      marker.isPickable = false;
      marker.position.y = 0.05;
      marker.setEnabled(false);
      return marker;
    });
  }
  function updateGroupPreview(hoverPoint: Position | null) {
    if (!groupPreview) return;
    const dx = hoverPoint ? Math.round(hoverPoint.x - groupPreview.center.x) : 0;
    const dz = hoverPoint ? Math.round(hoverPoint.z - groupPreview.center.z) : 0;
    groupPreview.points.forEach((point, index) => {
      const marker = groupPreviewNodes[index]!;
      marker.setEnabled(Boolean(hoverPoint));
      marker.position.set(point.x + dx, 0.05, point.z + dz);
    });
  }

  function updatePlacePreview(hoverPoint: Position | null) {
    if (!placePreviewMembers) return;
    for (let index = 0; index < placePreviewNodes.length; index += 1) {
      const marker = placePreviewNodes[index]!;
      const member = placePreviewMembers[index]!;
      marker.setEnabled(Boolean(hoverPoint));
      if (hoverPoint) marker.position.set(hoverPoint.x + member.dx, 0.05, hoverPoint.z + member.dz);
    }
  }

  return { placePreviewMaterial, placePreviewActive, setPlacePreview, groupPreviewActive, setGroupPreview, updateGroupPreview, updatePlacePreview };
}
