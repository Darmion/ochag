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
