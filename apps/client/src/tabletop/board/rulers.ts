import { StandardMaterial, Color3, Vector3, Mesh, MeshBuilder, Scene } from '@babylonjs/core';
import type { Position } from '../grid';
import type { LabelApi } from './labels';

export type RulersDeps = Pick<LabelApi, 'createLabel' | 'removeLabel' | 'setLabelText'> & {
  scene: Scene;
};

export function createRulers({ scene, createLabel, setLabelText, removeLabel }: RulersDeps) {
  function emissiveMaterial(name: string, color: string) {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = Color3.FromHexString(color);
    mat.disableLighting = true;
    return mat;
  }

  const signalShadow = emissiveMaterial('signal-shadow', '#1a120b');
  signalShadow.alpha = 0.7;

  function createRuler(color: string, labelClass: string, labelAnchor?: () => Vector3 | null) {
    const mat = emissiveMaterial('ruler', color);
    const meshes: Mesh[] = [];

    function part(mesh: Mesh, partMaterial: StandardMaterial) {
      mesh.material = partMaterial;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      meshes.push(mesh);
      return mesh;
    }

    const lineShadow = part(MeshBuilder.CreateBox('ruler-line-shadow', { width: 1, height: 0.03, depth: 0.2 }, scene), signalShadow);
    const line = part(MeshBuilder.CreateBox('ruler-line', { width: 1, height: 0.04, depth: 0.09 }, scene), mat);
    const ends = [0, 1].map(() => ({
      shadow: part(MeshBuilder.CreateCylinder('ruler-end-shadow', { diameter: 0.48, height: 0.02, tessellation: 24 }, scene), signalShadow),
      disc: part(MeshBuilder.CreateCylinder('ruler-end', { diameter: 0.34, height: 0.03, tessellation: 24 }, scene), mat),
    }));

    let to: Position | null = null;
    const anchor = new Vector3();
    const label = createLabel(
      `ruler-label ${labelClass}`,
      labelAnchor ?? (() => (to ? anchor.set(to.x, 0.1, to.z) : null)),
    );
    label?.el.style.setProperty('--signal-color', color);

    let ownedKey = '';
    function setOwnedText(text: string, owner: string) {
      if (!label) return;
      const key = `${text}\n${owner}`;
      if (key === ownedKey) return;
      ownedKey = key;
      const measure = document.createElement('span');
      measure.textContent = text;
      const name = document.createElement('span');
      name.translate = false;
      name.textContent = owner;
      label.el.replaceChildren(measure, ' · ', name);
      label.size = null;
    }

    return {
      get shown() {
        return to !== null;
      },
      set(from: Position, toPoint: Position, text: string, straight = true, owner?: string) {
        to = toPoint;

        [from, toPoint].forEach((point, index) => {
          ends[index]!.shadow.position.set(point.x, 0.06, point.z);
          ends[index]!.disc.position.set(point.x, 0.075, point.z);
          ends[index]!.shadow.setEnabled(true);
          ends[index]!.disc.setEnabled(true);
        });

        const dx = toPoint.x - from.x;
        const dz = toPoint.z - from.z;
        const length = Math.hypot(dx, dz);

        for (const [mesh, y] of [[lineShadow, 0.07], [line, 0.085]] as const) {
          mesh.setEnabled(length > 0 && straight);
          if (length <= 0) continue;
          mesh.scaling.x = length;
          mesh.position.set((from.x + toPoint.x) / 2, y, (from.z + toPoint.z) / 2);
          mesh.rotation.y = Math.atan2(-dz, dx);
        }

        if (owner !== undefined) setOwnedText(text, owner);
        else {
          ownedKey = '';
          setLabelText(label, text);
        }
      },
      hide() {
        to = null;
        for (const mesh of meshes) mesh.setEnabled(false);
      },
      dispose() {
        removeLabel(label);
        for (const mesh of meshes) mesh.dispose();
        mat.dispose();
      },
    };
  }

  function createPathLine(color: string) {
    const mat = emissiveMaterial('path-line', color);
    const segments: Array<{ line: Mesh; shadow: Mesh }> = [];
    const corners: Mesh[] = [];
    let used = 0;
    let usedCorners = 0;

    function segment(index: number) {
      while (segments.length <= index) {
        const shadow = MeshBuilder.CreateBox('path-line-shadow', { width: 1, height: 0.03, depth: 0.2 }, scene);
        const line = MeshBuilder.CreateBox('path-line', { width: 1, height: 0.04, depth: 0.09 }, scene);
        shadow.material = signalShadow;
        line.material = mat;
        for (const mesh of [shadow, line]) {
          mesh.isPickable = false;
          mesh.setEnabled(false);
        }
        segments.push({ line, shadow });
      }
      return segments[index]!;
    }

    function corner(index: number) {
      while (corners.length <= index) {
        const disc = MeshBuilder.CreateCylinder('path-corner', { diameter: 0.12, height: 0.04, tessellation: 12 }, scene);
        disc.material = mat;
        disc.isPickable = false;
        disc.setEnabled(false);
        corners.push(disc);
      }
      return corners[index]!;
    }

    return {
      set(points: Position[]) {
        let count = 0;
        let cornerCount = 0;
        for (let i = 1; i < points.length; i += 1) {
          const a = points[i - 1]!, b = points[i]!;
          const dx = b.x - a.x, dz = b.z - a.z;
          const length = Math.hypot(dx, dz);
          if (length <= 0) continue;
          const { line, shadow } = segment(count);
          for (const [mesh, y] of [[shadow, 0.07], [line, 0.085]] as const) {
            mesh.scaling.x = length;
            mesh.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
            mesh.rotation.y = Math.atan2(-dz, dx);
            mesh.setEnabled(true);
          }
          count += 1;
          if (i < points.length - 1) {
            const disc = corner(cornerCount);
            disc.position.set(b.x, 0.087, b.z);
            disc.setEnabled(true);
            cornerCount += 1;
          }
        }
        for (let i = count; i < used; i += 1) {
          segments[i]!.line.setEnabled(false);
          segments[i]!.shadow.setEnabled(false);
        }
        for (let i = cornerCount; i < usedCorners; i += 1) corners[i]!.setEnabled(false);
        used = count;
        usedCorners = cornerCount;
      },
      hide() {
        this.set([]);
      },
      dispose() {
        for (const { line, shadow } of segments) {
          line.dispose();
          shadow.dispose();
        }
        for (const disc of corners) disc.dispose();
        mat.dispose();
      },
    };
  }

  return { emissiveMaterial, createRuler, createPathLine };
}

export type RulersApi = ReturnType<typeof createRulers>;
