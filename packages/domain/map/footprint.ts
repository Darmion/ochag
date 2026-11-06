export const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
export type Size = (typeof SIZES)[number];

const FOOTPRINT: Record<Size, number> = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };

export function footprintCells(size: string | null | undefined): number {
  return FOOTPRINT[size as Size] ?? 1;
}

function startCell(value: number, cells: number, n: number) {
  const maxStart = Math.max(0, cells - n);
  return Math.max(0, Math.min(maxStart, Math.round(value + cells / 2 - n / 2)));
}

export function snapFootprint(value: number, cells: number, n: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Invalid position');
  return startCell(value, cells, n) + n / 2 - cells / 2;
}

export function isFootprintCenter(value: number, cells: number, n: number): boolean {
  const start = value + cells / 2 - n / 2;
  const whole = Math.round(start);
  return Math.abs(start - whole) < 1e-9 && whole >= 0 && whole <= Math.max(0, cells - n);
}

export function occupiedCells(
  dims: { width_cells: number; height_cells: number },
  x: number,
  z: number,
  n: number,
): Array<{ col: number; row: number }> {
  const col0 = Math.round(x + dims.width_cells / 2 - n / 2);
  const row0 = Math.round(z + dims.height_cells / 2 - n / 2);
  const cells: Array<{ col: number; row: number }> = [];

  for (let row = row0; row < row0 + n; row += 1) {
    for (let col = col0; col < col0 + n; col += 1) {
      if (col >= 0 && row >= 0 && col < dims.width_cells && row < dims.height_cells) cells.push({ col, row });
    }
  }

  return cells;
}

export function figureScale(size: string | null | undefined): number {
  if (size === 'tiny') return 0.5;
  if (size === 'small') return 0.85;
  return footprintCells(size);
}
