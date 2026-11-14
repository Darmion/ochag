import { Color3, LinesMesh, MeshBuilder, Scene, Vector3 } from '@babylonjs/core';
import type { Position } from '../grid';

// A preview that changes on every pointer move. A new LinesMesh brings a new shader material that is not ready for a frame
// or two, so rebuilding it per move makes the preview blink; these meshes are built once with room to spare and only move
// their points. Unused points collapse onto one spot and draw nothing.

export function createLiveLine(scene: Scene, name: string, capacity: number, y: number) {
  const buffer = Array.from({ length: capacity }, () => new Vector3(0, y, 0));
  const mesh: LinesMesh = MeshBuilder.CreateLines(name, { points: buffer, updatable: true }, scene);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;

  function set(points: readonly Position[]) {
    const last = points.length - 1;
    for (let at = 0; at < capacity; at++) {
      const point = last >= 0 ? points[Math.min(at, last)]! : { x: 0, z: 0 };
      buffer[at]!.set(point.x, y, point.z);
    }
    MeshBuilder.CreateLines(name, { points: buffer, instance: mesh });
  }

  return {
    set,
    hide: () => set([]),
    color(hex: string, alpha = 1) {
      mesh.color = Color3.FromHexString(hex);
      mesh.alpha = alpha;
    },
  };
}

export function createLiveSegments(scene: Scene, name: string, capacity: number, y: number) {
  const buffer = Array.from({ length: capacity }, () => [new Vector3(0, y, 0), new Vector3(0, y, 0)]);
  const mesh: LinesMesh = MeshBuilder.CreateLineSystem(name, { lines: buffer, updatable: true }, scene);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;

  function set(segments: ReadonlyArray<{ x1: number; z1: number; x2: number; z2: number }>) {
    for (let at = 0; at < capacity; at++) {
      const segment = segments[at];
      const [from, to] = buffer[at]!;
      if (segment) {
        from!.set(segment.x1, y, segment.z1);
        to!.set(segment.x2, y, segment.z2);
      } else {
        from!.set(0, y, 0);
        to!.set(0, y, 0);
      }
    }
    MeshBuilder.CreateLineSystem(name, { lines: buffer, instance: mesh });
  }

  return {
    set,
    hide: () => set([]),
    color(hex: string, alpha = 1) {
      mesh.color = Color3.FromHexString(hex);
      mesh.alpha = alpha;
    },
  };
}
