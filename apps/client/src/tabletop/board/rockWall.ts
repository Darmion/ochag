import { Mesh, MeshBuilder, Scene, StandardMaterial, VertexBuffer, VertexData } from '@babylonjs/core';
import type { WallSegment } from '../sceneTypes';

function idHash(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return hash;
}

function lcg(seed: number) {
  let value = seed || 1;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

// Flat icospheres keep one vertex copy per face, so the jitter is keyed by position to move every copy alike.
function lumpyRock(name: string, scene: Scene, salt: number) {
  const rock = MeshBuilder.CreateIcoSphere(name, { radius: 1, subdivisions: 2, flat: true }, scene);
  const positions = rock.getVerticesData(VertexBuffer.PositionKind)!;
  const indices = rock.getIndices()!;
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]!, y = positions[index + 1]!, z = positions[index + 2]!;
    const noise = Math.sin(Math.round(x * 1000) * 0.0129898 + Math.round(y * 1000) * 0.078233 + Math.round(z * 1000) * 0.037719 + salt) * 43758.5453;
    const scale = 0.8 + (noise - Math.floor(noise)) * 0.38;
    positions[index] = x * scale;
    positions[index + 1] = y * scale;
    positions[index + 2] = z * scale;
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  rock.setVerticesData(VertexBuffer.PositionKind, positions);
  rock.setVerticesData(VertexBuffer.NormalKind, normals);
  return rock;
}

export function buildRockWall(scene: Scene, wall: WallSegment, material: StandardMaterial, height: number, depth: number): Mesh | null {
  const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1;
  const length = Math.hypot(dx, dz);
  if (length <= 0) return null;
  const random = lcg(idHash(wall.id));
  const along = { x: dx / length, z: dz / length };
  const across = { x: -along.z, z: along.x };
  const angle = Math.atan2(-dz, dx);
  const parts: Mesh[] = [];
  const core = MeshBuilder.CreateBox(`rock-core-${wall.id}`, { width: length, height: height * 0.56, depth: depth * 0.7 }, scene);
  core.position.set((wall.x1 + wall.x2) / 2, height * 0.28, (wall.z1 + wall.z2) / 2);
  core.rotation.y = angle;
  parts.push(core);
  const count = Math.max(2, Math.round(length / 0.55));
  for (let index = 0; index <= count; index += 1) {
    const end = index === 0 || index === count;
    const t = index / count + (end ? 0 : (random() - 0.5) * 0.5 / count);
    const rx = end ? 0.2 + random() * 0.06 : (length / count) * (0.55 + random() * 0.3);
    const ry = height * (end ? 0.5 + random() * 0.1 : 0.42 + random() * 0.2);
    const rz = depth * (0.7 + random() * 0.45);
    const rock = lumpyRock(`rock-${wall.id}-${index}`, scene, random() * 1000);
    rock.scaling.set(rx, ry, rz);
    const side = (random() - 0.5) * depth * 0.5;
    rock.position.set(wall.x1 + dx * t + across.x * side, ry * 0.92, wall.z1 + dz * t + across.z * side);
    rock.rotation.set((random() - 0.5) * 0.25, angle + (random() - 0.5) * 0.3, (random() - 0.5) * 0.25);
    parts.push(rock);
  }
  const merged = Mesh.MergeMeshes(parts, true, true);
  if (!merged) return null;
  merged.name = `wall-${wall.id}`;
  projectRockUVs(merged, along, across, height);
  bendNormalsUp(merged, 0.45);
  merged.material = material;
  merged.isPickable = true;
  merged.metadata = { wallId: wall.id };
  return merged;
}

// Faces turned to the ground would only get the dark ground light; tilting normals up keeps the rock readable.
function bendNormalsUp(mesh: Mesh, amount: number) {
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
  for (let index = 0; index < normals.length; index += 3) {
    const x = normals[index]!, y = normals[index + 1]! + amount, z = normals[index + 2]!;
    const size = Math.hypot(x, y, z) || 1;
    normals[index] = x / size;
    normals[index + 1] = y / size;
    normals[index + 2] = z / size;
  }
  mesh.setVerticesData(VertexBuffer.NormalKind, normals);
}

// Every vertex belongs to one flat face, so a box projection aligned to the wall keeps strata level across all chunks.
function projectRockUVs(mesh: Mesh, along: { x: number; z: number }, across: { x: number; z: number }, height: number) {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const x = positions[vertex * 3]!, y = positions[vertex * 3 + 1]!, z = positions[vertex * 3 + 2]!;
    const nx = normals[vertex * 3]!, ny = normals[vertex * 3 + 1]!, nz = normals[vertex * 3 + 2]!;
    const s = x * along.x + z * along.z, r = x * across.x + z * across.z;
    const facing = Math.abs(nx * across.x + nz * across.z), sideways = Math.abs(nx * along.x + nz * along.z);
    let u: number, v: number;
    if (Math.abs(ny) > Math.max(facing, sideways)) { u = s; v = r; }
    else if (facing >= sideways) { u = s; v = y / height; }
    else { u = r; v = y / height; }
    uvs[vertex * 2] = u;
    uvs[vertex * 2 + 1] = v;
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uvs);
}
