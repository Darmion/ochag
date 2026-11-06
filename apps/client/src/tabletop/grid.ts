export type Position = { x: number; z: number };
export type BoardDimensions = { widthCells: number; heightCells: number };

export function roundCoordinate(value: number) {
  return Math.round(value * 1000) / 1000;
}

// Cell centres: half-integers on even boards, integers on odd ones — must match apps/server/src/tabletop/scene/board.ts, which accepts or rejects a move.
export function snapToBoard(value: number, cells: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Invalid position');
  const half = cells / 2;
  const col = Math.max(0, Math.min(cells - 1, Math.round(value + half - 0.5)));
  return col - half + 0.5;
}

const FOOTPRINT: Record<string, number> = { large: 2, huge: 3, gargantuan: 4 };

export function footprintCells(size: string | null | undefined): number {
  return (size && FOOTPRINT[size]) || 1;
}

export function snapFootprint(value: number, cells: number, n: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Invalid position');
  const start = Math.max(0, Math.min(Math.max(0, cells - n), Math.round(value + cells / 2 - n / 2)));
  return start + n / 2 - cells / 2;
}

export function figureScale(size: string | null | undefined): number {
  if (size === 'tiny') return 0.5;
  if (size === 'small') return 0.85;
  return footprintCells(size);
}

export function distanceFeet(a: Position, b: Position, feetPerUnit: number): number {
  return Math.hypot(a.x - b.x, a.z - b.z) * feetPerUnit;
}

// Lattice points use the opposite parity to cell centres (as in los.ts and board.ts).
export function snapToLatticePoint(value: number, cells: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Invalid position');
  const half = cells / 2;
  return Math.max(-half, Math.min(half, Math.round(value + half) - half));
}

export type DiagonalRule = 'phb' | '5-10-5';

export const DIAGONAL_RULE_KEY = 'diagonal_5_10_5';

export function gridDistanceCells(from: Position, to: Position, rule: DiagonalRule): number {
  const dx = Math.abs(Math.round(to.x - from.x));
  const dz = Math.abs(Math.round(to.z - from.z));
  const diagonal = Math.min(dx, dz);
  const straight = Math.max(dx, dz) - diagonal;

  if (rule === '5-10-5') return straight + diagonal + Math.floor(diagonal / 2);
  return straight + diagonal;
}

export function glideMs(cells: number): number {
  return Math.round(Math.min(2400, Math.max(250, cells * 260)));
}
