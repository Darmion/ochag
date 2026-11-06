export type Point = { x: number; z: number };
export type WallSegment = { x1: number; z1: number; x2: number; z2: number };
export type Dimensions = { widthCells: number; heightCells: number };

function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

// Ignores a hit at the ray origin; includes wall endpoints so walls meeting at a corner still block.
export function blockedBy(origin: Point, target: Point, wall: WallSegment): boolean {
  return wallHit(origin, target, wall) !== null;
}

export function wallHit(origin: Point, target: Point, wall: WallSegment): number | null {
  const rx = target.x - origin.x;
  const rz = target.z - origin.z;
  const sx = wall.x2 - wall.x1;
  const sz = wall.z2 - wall.z1;
  const denom = cross(rx, rz, sx, sz);

  if (denom === 0) return null;

  const qpx = wall.x1 - origin.x;
  const qpz = wall.z1 - origin.z;
  const t = cross(qpx, qpz, sx, sz) / denom;
  const u = cross(qpx, qpz, rx, rz) / denom;
  const epsilon = 1e-9;

  return t > epsilon && t < 1 - epsilon && u > -epsilon && u < 1 + epsilon ? t : null;
}

// Cell centres: half-integers on even boards, integers on odd ones (as in footprint.ts and grid.ts; duplicated to stay dependency-free).
function cellCenter(index: number, cells: number): number {
  return index - cells / 2 + 0.5;
}

// Lattice points use the opposite parity to cell centres.
export function isLatticePoint(value: number, cells: number): boolean {
  return Number.isInteger(value + cells / 2);
}

export function visibleCells(
  origin: Point,
  radiusFeet: number | null,
  feetPerUnit: number,
  dimensions: Dimensions,
  walls: WallSegment[],
): Point[] {
  const { widthCells, heightCells } = dimensions;
  const radiusUnits = radiusFeet === null ? null : radiusFeet / feetPerUnit;

  let colStart = 0;
  let colEnd = widthCells - 1;
  let rowStart = 0;
  let rowEnd = heightCells - 1;

  if (radiusUnits !== null) {
    const halfWidth = widthCells / 2;
    const halfHeight = heightCells / 2;
    colStart = Math.max(0, Math.floor(origin.x + halfWidth - 0.5 - radiusUnits));
    colEnd = Math.min(widthCells - 1, Math.ceil(origin.x + halfWidth - 0.5 + radiusUnits));
    rowStart = Math.max(0, Math.floor(origin.z + halfHeight - 0.5 - radiusUnits));
    rowEnd = Math.min(heightCells - 1, Math.ceil(origin.z + halfHeight - 0.5 + radiusUnits));
  }

  const result: Point[] = [];

  for (let row = rowStart; row <= rowEnd; row++) {
    const z = cellCenter(row, heightCells);

    for (let col = colStart; col <= colEnd; col++) {
      const x = cellCenter(col, widthCells);

      if (radiusUnits !== null && Math.hypot(x - origin.x, z - origin.z) > radiusUnits) {
        continue;
      }

      const target = { x, z };

      if (!walls.some(wall => blockedBy(origin, target, wall))) {
        result.push(target);
      }
    }
  }

  return result;
}
