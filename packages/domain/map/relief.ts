import type { Cover } from '../combat/targeting.ts';

// Ground height of cells in feet: [[col, row, feet]]; a cell that is not listed is at 0. Pits are negative.
export type HeightCells = number[][];
export type Dims = { width_cells: number; height_cells: number };
export type ReliefCell = { col: number; row: number };

export const HEIGHT_STEPS = [-30, -20, -10, -5, 5, 10, 15, 20, 30] as const;
export const MAX_HEIGHT_FEET = 100;
// A step down of 5 feet is a plain step; from 10 feet on it is a climb down (or a fall when the creature is pushed).
export const SAFE_DROP_FEET = 5;
// Barrels, crates and similar blockers are about this tall: a viewer this much higher sees over them.
export const LOW_BLOCKER_FEET = 10;

const key = (col: number, row: number) => `${col}:${row}`;

export function heightMap(cells: HeightCells | null | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const [col, row, feet] of Array.isArray(cells) ? cells : []) if (feet) map.set(key(col!, row!), feet!);
  return map;
}

export function cellHeight(map: Map<string, number>, cell: ReliefCell) {
  return map.get(key(cell.col, cell.row)) ?? 0;
}

// A creature stands on the highest cell under it.
export function groundUnder(map: Map<string, number>, dims: Dims, x: number, z: number, size: number): number {
  if (!map.size) return 0;
  const col0 = Math.round(x + dims.width_cells / 2 - size / 2);
  const row0 = Math.round(z + dims.height_cells / 2 - size / 2);
  let ground = -Infinity;
  for (let row = row0; row < row0 + size; row += 1) {
    for (let col = col0; col < col0 + size; col += 1) ground = Math.max(ground, cellHeight(map, { col, row }));
  }
  return Number.isFinite(ground) ? ground : 0;
}

// The ground at a point: inside a cell — that cell; on a grid line or corner — the highest cell it touches.
export function groundAtPoint(map: Map<string, number>, dims: Dims, x: number, z: number): number {
  if (!map.size) return 0;
  const fx = x + dims.width_cells / 2, fz = z + dims.height_cells / 2;
  const cols = Number.isInteger(fx) ? [fx - 1, fx] : [Math.floor(fx)];
  const rows = Number.isInteger(fz) ? [fz - 1, fz] : [Math.floor(fz)];
  let ground = -Infinity;
  for (const col of cols) for (const row of rows) ground = Math.max(ground, cellHeight(map, { col, row }));
  return Number.isFinite(ground) ? ground : 0;
}

// Extra cells of movement for a step from one ground height to another: climbing up or down costs double without a climbing speed.
export function climbCells(fromFeet: number, toFeet: number, feetPerCell: number, climbs: boolean): number {
  const rise = toFeet - fromFeet;
  const span = rise > 0 ? rise : -rise > SAFE_DROP_FEET ? -rise : 0;
  return span > 0 ? (span / feetPerCell) * (climbs ? 1 : 2) : 0;
}

export function fallFeet(fromFeet: number, toFeet: number): number {
  const drop = fromFeet - toFeet;
  return drop > SAFE_DROP_FEET ? drop : 0;
}

// Dragging from a cell that already has this height levels the rectangle back to 0; otherwise the rectangle gets the height.
export function paintHeightRect(cells: HeightCells, from: ReliefCell, to: ReliefCell, feet: number): HeightCells {
  const map = heightMap(cells);
  const level = !feet || cellHeight(map, from) === feet;
  for (let col = Math.min(from.col, to.col); col <= Math.max(from.col, to.col); col += 1) {
    for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row += 1) {
      if (level) {
        if (!feet || map.get(key(col, row)) === feet) map.delete(key(col, row));
      } else map.set(key(col, row), feet);
    }
  }
  return [...map].map(([id, value]) => {
    const [col, row] = id.split(':').map(Number) as [number, number];
    return [col, row, value];
  });
}

export function overlooks(viewerFeet: number, blockerGroundFeet: number) {
  return viewerFeet - blockerGroundFeet >= LOW_BLOCKER_FEET;
}

export type ReliefBody = { x: number; z: number; size: number; ground: number; altitude?: number };

// Cover from the lip of a ledge: lines from the attacker's eyes to the target's feet, middle and head; the lip of every
// change in ground height crossed on the way may hide some of them. The attacker leans over the edge of its own cells.
export function ledgeCover(map: Map<string, number>, dims: Dims, feetPerCell: number, attacker: ReliefBody, target: ReliefBody): Cover {
  if (!map.size) return 'none';
  const eye = attacker.ground + (attacker.altitude ?? 0) + attacker.size * feetPerCell;
  const base = target.ground + (target.altitude ?? 0);
  const marks = [base, base + (target.size * feetPerCell) / 2, base + target.size * feetPerCell];
  const dx = target.x - attacker.x, dz = target.z - attacker.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-9) return 'none';
  const cellAt = (t: number) => ({
    col: Math.floor(attacker.x + dx * t + dims.width_cells / 2),
    row: Math.floor(attacker.z + dz * t + dims.height_cells / 2),
  });
  const steps = Math.ceil(length / 0.1);
  const hidden = [false, false, false];
  const col0 = Math.round(attacker.x + dims.width_cells / 2 - attacker.size / 2);
  const row0 = Math.round(attacker.z + dims.height_cells / 2 - attacker.size / 2);
  const own = (cell: ReliefCell) => cell.col >= col0 && cell.col < col0 + attacker.size && cell.row >= row0 && cell.row < row0 + attacker.size;
  let previous = cellAt(0);
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const cell = cellAt(t);
    if (cell.col === previous.col && cell.row === previous.row) continue;
    const lip = own(previous) ? -Infinity : Math.max(cellHeight(map, previous), cellHeight(map, cell));
    previous = cell;
    marks.forEach((mark, index) => {
      if (eye + (mark - eye) * t < lip - 1e-6) hidden[index] = true;
    });
  }
  const count = hidden.filter(Boolean).length;
  return count === 3 ? 'total' : count === 2 ? 'three-quarters' : count === 1 ? 'half' : 'none';
}
