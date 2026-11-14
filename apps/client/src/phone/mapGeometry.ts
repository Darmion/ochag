import { footprintCells, snapFootprint } from '../tabletop/grid.ts';

export const CELL_PX = 32;
export const MARGIN = 18;

export type Board = { widthCells: number; heightCells: number };
export type MapFigure = { id: string; world_x: number; world_z: number; size: string | null };

export function toPx(board: Board, x: number, z: number) {
  return { px: (x + board.widthCells / 2) * CELL_PX + MARGIN, pz: (z + board.heightCells / 2) * CELL_PX + MARGIN };
}

export function toWorld(board: Board, px: number, pz: number) {
  return { x: (px - MARGIN) / CELL_PX - board.widthCells / 2, z: (pz - MARGIN) / CELL_PX - board.heightCells / 2 };
}

// The canvas is drawn at its own size and shown scaled to the screen.
export function canvasPoint(rect: { left: number; top: number; width: number; height: number }, size: { width: number; height: number }, clientX: number, clientY: number) {
  return { px: (clientX - rect.left) * (size.width / rect.width), pz: (clientY - rect.top) * (size.height / rect.height) };
}

export function insideBoard(board: Board, x: number, z: number) {
  return Math.abs(x) <= board.widthCells / 2 && Math.abs(z) <= board.heightCells / 2;
}

export function snapFigure(board: Board, x: number, z: number, size: string | null) {
  const n = footprintCells(size);
  return { x: snapFootprint(x, board.widthCells, n), z: snapFootprint(z, board.heightCells, n) };
}

// The figure drawn last is on top, so the search goes from the end; a finger gets a little extra room.
export function figureAt<T extends MapFigure>(figures: readonly T[], x: number, z: number, slack = 0.15): T | null {
  for (let index = figures.length - 1; index >= 0; index -= 1) {
    const figure = figures[index]!;
    const radius = footprintCells(figure.size) / 2 + slack;
    if (Math.hypot(figure.world_x - x, figure.world_z - z) <= radius) return figure;
  }
  return null;
}

// A press becomes a drag only after the finger travels this far, so a shaky tap stays a tap.
export const DRAG_START_PX = 10;
