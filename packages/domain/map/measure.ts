export type DiagonalRule = 'phb' | '5-10-5';

export type CellPoint = { x: number; z: number };

export const DIAGONAL_RULE_KEY = 'diagonal_5_10_5';

export function gridDistanceCells(from: CellPoint, to: CellPoint, rule: DiagonalRule): number {
  const dx = Math.abs(Math.round(to.x - from.x));
  const dz = Math.abs(Math.round(to.z - from.z));
  const diagonal = Math.min(dx, dz);
  const straight = Math.max(dx, dz) - diagonal;

  if (rule === '5-10-5') return straight + diagonal + Math.floor(diagonal / 2);
  return straight + diagonal;
}

export function gridDistanceFeet(
  from: CellPoint,
  to: CellPoint,
  feetPerUnit: number,
  rule: DiagonalRule,
): number {
  return gridDistanceCells(from, to, rule) * feetPerUnit;
}

// diagonalsBefore carries the 5-10-5 parity across the whole turn, so step-by-step moves cost the same as one long move.
export type GridCell = { col: number; row: number };

export function pathCostCells(
  from: GridCell,
  to: GridCell,
  rule: DiagonalRule,
  isDifficult: (cell: GridCell) => boolean = () => false,
  diagonalsBefore = 0,
): number {
  let { col, row } = from;
  let cost = 0;
  let diagonals = diagonalsBefore;

  while (col !== to.col || row !== to.row) {
    const stepCol = Math.sign(to.col - col);
    const stepRow = Math.sign(to.row - row);
    col += stepCol;
    row += stepRow;

    let step = 1;
    if (stepCol !== 0 && stepRow !== 0) {
      diagonals += 1;
      if (rule === '5-10-5' && diagonals % 2 === 0) step = 2;
    }
    if (isDifficult({ col, row })) step *= 2;
    cost += step;
  }

  return cost;
}

export function pathDiagonals(from: GridCell, to: GridCell): number {
  return Math.min(Math.abs(to.col - from.col), Math.abs(to.row - from.row));
}
