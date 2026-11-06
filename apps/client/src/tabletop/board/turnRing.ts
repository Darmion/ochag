import { StandardMaterial, Color3, MeshBuilder, Scene, TransformNode } from '@babylonjs/core';
import { footprintCells } from '../grid';
import type { ObjectRecord } from '../sceneTypes';

export type TurnRingDeps = {
  scene: Scene;
  reducedMotion: boolean;
  objectEntries: Map<string, ObjectRecord>;
  rootOf: (objectId: string) => TransformNode | null;
  turnObjectId: () => string;
};

export function createTurnRing({ scene, reducedMotion, objectEntries, rootOf, turnObjectId }: TurnRingDeps) {
  const turnMaterial = new StandardMaterial('turn-ring', scene);
  turnMaterial.diffuseColor = Color3.Black();
  turnMaterial.emissiveColor = Color3.FromHexString('#f5c469');
  turnMaterial.disableLighting = true;
  const turnRing = MeshBuilder.CreateTorus('turn-ring', { diameter: 1.22, thickness: 0.06, tessellation: 48 }, scene);
  turnRing.material = turnMaterial;
  turnRing.isPickable = false;
  turnRing.setEnabled(false);

  scene.onBeforeRenderObservable.add(() => {
    const holder = turnObjectId() ? rootOf(turnObjectId()) : null;

    if (!holder) {
      turnRing.setEnabled(false);
      return;
    }

    turnRing.setEnabled(true);
    turnRing.position.set(holder.position.x, holder.position.y + 0.05, holder.position.z);
    const size = holder.scaling.x * footprintCells(objectEntries.get(turnObjectId())?.data.size);

    if (reducedMotion) {
      turnRing.scaling.set(size, 1, size);
    } else {
      const pulse = size * (1 + 0.06 * Math.sin(performance.now() / 320));
      turnRing.scaling.set(pulse, 1, pulse);
    }
  });
}
