// Scattering copies of map objects (trees, rocks) over an area, and the random turn and size that make a set look natural.

export type ScatterDensity = 'sparse' | 'medium' | 'dense';
export type SizeSpread = 0 | 0.1 | 0.25 | 0.4;
export type Spread = { rotate: boolean; size: SizeSpread };
export type CellRef = { col: number; row: number };

export const SCATTER_DENSITIES: readonly ScatterDensity[] = ['sparse', 'medium', 'dense'];
export const SIZE_SPREADS: readonly SizeSpread[] = [0, 0.1, 0.25, 0.4];
export const MAX_SCATTER = 60;

// Share of the free cells that get an object.
const SHARE: Record<ScatterDensity, number> = { sparse: 1 / 9, medium: 1 / 4, dense: 1 / 2 };

export type Random = () => number;

export function spreadPose(base: { rotationY: number; scale: number }, spread: Spread, random: Random = Math.random) {
  const rotationY = spread.rotate ? Math.round(random() * 360) % 360 : base.rotationY;
  const factor = spread.size ? 1 + (random() * 2 - 1) * spread.size : 1;
  const scale = Math.max(0.1, Math.min(50, Math.round(base.scale * factor * 100) / 100));
  return { rotationY, scale };
}

export function scatterCells(
  from: CellRef, to: CellRef, widthCells: number, heightCells: number, occupied: ReadonlySet<string>, density: ScatterDensity,
  random: Random = Math.random,
): CellRef[] {
  const free: CellRef[] = [];
  const clampCol = (col: number) => Math.max(0, Math.min(widthCells - 1, col));
  const clampRow = (row: number) => Math.max(0, Math.min(heightCells - 1, row));
  for (let col = clampCol(Math.min(from.col, to.col)); col <= clampCol(Math.max(from.col, to.col)); col++) {
    for (let row = clampRow(Math.min(from.row, to.row)); row <= clampRow(Math.max(from.row, to.row)); row++) {
      if (!occupied.has(`${col}:${row}`)) free.push({ col, row });
    }
  }
  if (!free.length) return [];
  const count = Math.max(1, Math.min(MAX_SCATTER, free.length, Math.round(free.length * SHARE[density])));
  for (let at = free.length - 1; at > 0; at--) {
    const pick = Math.floor(random() * (at + 1));
    [free[at], free[pick]] = [free[pick]!, free[at]!];
  }
  return free.slice(0, count);
}

export function cellCenter(cell: CellRef, widthCells: number, heightCells: number) {
  return { x: cell.col + 0.5 - widthCells / 2, z: cell.row + 0.5 - heightCells / 2 };
}
