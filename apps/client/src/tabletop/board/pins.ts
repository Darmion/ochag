import { Mesh, MeshBuilder, Vector3, Scene, StandardMaterial } from '@babylonjs/core';
import type { LabelApi, OverlayLabel } from './labels';
import type { MapPin } from '../sceneTypes';

export type PinsDeps = Pick<LabelApi, 'createLabel' | 'removeLabel' | 'setLabelText'> & {
  scene: Scene;
  material: (name: string, color: string) => StandardMaterial;
  brass: StandardMaterial;
};

export function createPins({ scene, material, brass, removeLabel, createLabel, setLabelText }: PinsDeps) {
  const pinHeadMaterial = material('pin-head', '#8e2a2f');
  const pinRecords = new Map<string, { meshes: Mesh[]; label: OverlayLabel | null; key: string }>();

  function setPins(pins: MapPin[]) {
    const wanted = new Set(pins.map(pin => pin.id));

    for (const [id, record] of [...pinRecords]) {
      if (wanted.has(id)) continue;
      record.meshes.forEach(mesh => mesh.dispose());
      removeLabel(record.label);
      pinRecords.delete(id);
    }

    for (const pin of pins) {
      const key = `${pin.x}:${pin.z}:${pin.title}`;
      const existing = pinRecords.get(pin.id);
      if (existing?.key === key) continue;

      if (existing) {
        existing.meshes.forEach(mesh => mesh.dispose());
        removeLabel(existing.label);
      }

      const pole = MeshBuilder.CreateCylinder('pin-pole', { diameter: 0.05, height: 0.7, tessellation: 8 }, scene);
      pole.material = brass;
      pole.position.set(pin.x, 0.35, pin.z);
      const head = MeshBuilder.CreateSphere('pin-head', { diameter: 0.26, segments: 12 }, scene);
      head.material = pinHeadMaterial;
      head.position.set(pin.x, 0.74, pin.z);

      for (const mesh of [pole, head]) {
        mesh.metadata = { pinId: pin.id };
        mesh.isPickable = true;
      }

      const anchor = new Vector3(pin.x, 0.95, pin.z);
      const label = createLabel('pin-label', () => anchor);
      if (label) label.el.translate = false;
      setLabelText(label, pin.title, { before: ['scroll'] });
      pinRecords.set(pin.id, { meshes: [pole, head], label, key });
    }
  }

  return { setPins };
}
