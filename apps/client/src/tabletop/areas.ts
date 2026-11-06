export type AreaShape = 'circle' | 'cone' | 'square' | 'line';

export type Area = {
  shape: AreaShape;
  x: number;
  z: number;
  direction: number;
  size: number;
  width?: number;
};

const CONE_HALF_ANGLE = Math.atan(0.5);
const EPSILON = 1e-9;

export function inArea(area: Area, px: number, pz: number): boolean {
  const dx = px - area.x;
  const dz = pz - area.z;

  if (area.shape === 'circle') return Math.hypot(dx, dz) <= area.size + EPSILON;

  const angle = (area.direction * Math.PI) / 180;
  const ux = Math.cos(angle);
  const uz = Math.sin(angle);
  const along = dx * ux + dz * uz;
  const across = -dx * uz + dz * ux;

  if (area.shape === 'cone') {
    if (along <= EPSILON || Math.hypot(dx, dz) > area.size + EPSILON) return false;
    return Math.abs(Math.atan2(across, along)) <= CONE_HALF_ANGLE + EPSILON;
  }

  const halfWidth = area.shape === 'square' ? area.size / 2 : (area.width ?? 1) / 2;
  return along >= -EPSILON && along <= area.size + EPSILON
    && across > -halfWidth + EPSILON && across <= halfWidth + EPSILON;
}

export function inAreaAt(area: Area, px: number, pz: number, up: number): boolean {
  if (!(up > EPSILON)) return inArea(area, px, pz);
  const dx = px - area.x;
  const dz = pz - area.z;

  if (area.shape === 'circle') return Math.hypot(dx, dz, up) <= area.size + EPSILON;

  if (area.shape === 'cone') {
    const angle = (area.direction * Math.PI) / 180;
    const along = dx * Math.cos(angle) + dz * Math.sin(angle);
    const across = -dx * Math.sin(angle) + dz * Math.cos(angle);
    if (along <= EPSILON || Math.hypot(dx, dz, up) > area.size + EPSILON) return false;
    return Math.atan2(Math.hypot(across, up), along) <= CONE_HALF_ANGLE + EPSILON;
  }

  if (!inArea(area, px, pz)) return false;
  const top = area.shape === 'square' ? area.size : (area.width ?? 1);
  return up < top - EPSILON;
}

export function areaCells(area: Area, dims: { widthCells: number; heightCells: number }) {
  const cells: Array<{ col: number; row: number }> = [];
  for (let row = 0; row < dims.heightCells; row += 1) {
    const z = row - dims.heightCells / 2 + 0.5;
    for (let col = 0; col < dims.widthCells; col += 1) {
      const x = col - dims.widthCells / 2 + 0.5;
      if (inArea(area, x, z)) cells.push({ col, row });
    }
  }
  return cells;
}
