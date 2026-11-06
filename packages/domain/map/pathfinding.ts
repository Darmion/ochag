import { pathBlocked, cellCutByWall } from './blockers.ts';
import type { WallSegment } from './los.ts';
import type { DiagonalRule } from './measure.ts';

export type PathCell = { col: number; row: number };
export type PathGrid = {
  widthCells: number;
  heightCells: number;
  size: number;
  rule: DiagonalRule;
  diagonalsBefore?: number;
  edges: WallSegment[];
  walls: WallSegment[];
  isDifficult?: (cell: PathCell) => boolean;
  blockedCells?: Set<string>;
  hostileCells?: Set<string>;
};
export type PathResult = { cost: number; diagonals: number; cells: PathCell[] };

const STEPS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function junctionsOf(edges: WallSegment[]) {
  const count = new Map<string, number>();
  for (const edge of edges) {
    for (const [x, z] of [[edge.x1, edge.z1], [edge.x2, edge.z2]] as const) {
      const id = `${Math.round(x * 1000)}:${Math.round(z * 1000)}`;
      count.set(id, (count.get(id) ?? 0) + 1);
    }
  }
  return new Set([...count].filter(([, n]) => n >= 2).map(([id]) => id));
}

function stepBlocked(from: { x: number; z: number }, to: { x: number; z: number }, edges: WallSegment[], junctions: Set<string>) {
  const rx = to.x - from.x, rz = to.z - from.z;
  const eps = 1e-9;
  for (const edge of edges) {
    const sx = edge.x2 - edge.x1, sz = edge.z2 - edge.z1;
    const denom = rx * sz - rz * sx;
    if (denom === 0) continue;
    const qx = edge.x1 - from.x, qz = edge.z1 - from.z;
    const t = (qx * sz - qz * sx) / denom;
    const u = (qx * rz - qz * rx) / denom;
    if (!(t > eps && t < 1 - eps)) continue;
    if (u > eps && u < 1 - eps) return true;
    if (Math.abs(u) <= eps || Math.abs(u - 1) <= eps) {
      const x = from.x + t * rx, z = from.z + t * rz;
      if (junctions.has(`${Math.round(x * 1000)}:${Math.round(z * 1000)}`)) return true;
    }
  }
  return false;
}
const key = (col: number, row: number) => `${col}:${row}`;

export function positionOf(grid: PathGrid, x: number, z: number): PathCell {
  return { col: Math.round(x + grid.widthCells / 2 - grid.size / 2), row: Math.round(z + grid.heightCells / 2 - grid.size / 2) };
}
export function centerOf(grid: PathGrid, cell: PathCell) {
  return { x: cell.col + grid.size / 2 - grid.widthCells / 2, z: cell.row + grid.size / 2 - grid.heightCells / 2 };
}

function footprint(grid: PathGrid, cell: PathCell): PathCell[] {
  const cells: PathCell[] = [];
  for (let row = cell.row; row < cell.row + grid.size; row += 1) {
    for (let col = cell.col; col < cell.col + grid.size; col += 1) cells.push({ col, row });
  }
  return cells;
}

const cellCenter = (grid: PathGrid, cell: PathCell) => ({ x: cell.col - grid.widthCells / 2 + 0.5, z: cell.row - grid.heightCells / 2 + 0.5 });

function standable(grid: PathGrid, cell: PathCell) {
  if (cell.col < 0 || cell.row < 0 || cell.col + grid.size > grid.widthCells || cell.row + grid.size > grid.heightCells) return false;
  const parts = footprint(grid, cell);
  if (!parts.every(part => !grid.blockedCells?.has(key(part.col, part.row)) && !grid.hostileCells?.has(key(part.col, part.row)) && !cellCutByWall(cellCenter(grid, part).x, cellCenter(grid, part).z, grid.walls))) return false;
  // A large creature must not straddle a wall: the seams between its own cells must be open too.
  if (grid.size > 1) {
    for (const part of parts) {
      for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
        const next = { col: part.col + dc, row: part.row + dr };
        if (next.col >= cell.col + grid.size || next.row >= cell.row + grid.size) continue;
        if (pathBlocked(cellCenter(grid, part), cellCenter(grid, next), grid.edges)) return false;
      }
    }
  }
  return true;
}

function stepCost(grid: PathGrid, to: PathCell, diagonal: boolean, diagonalsSoFar: number) {
  let cost = 1;
  if (diagonal && grid.rule === '5-10-5' && (diagonalsSoFar + 1) % 2 === 0) cost = 2;
  if (grid.isDifficult && footprint(grid, to).some(part => grid.isDifficult!(part))) cost *= 2;
  return cost;
}

class Heap<T> {
  private items: Array<{ priority: number; value: T }> = [];
  get size() { return this.items.length; }
  push(priority: number, value: T) {
    const items = this.items;
    items.push({ priority, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.priority <= items[i]!.priority) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }
  pop(): T {
    const items = this.items;
    const top = items[0]!.value;
    const last = items.pop()!;
    if (items.length) {
      items[0] = last;
      let i = 0;
      while (true) {
        const left = i * 2 + 1, right = left + 1;
        let smallest = i;
        if (left < items.length && items[left]!.priority < items[smallest]!.priority) smallest = left;
        if (right < items.length && items[right]!.priority < items[smallest]!.priority) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i]!, items[smallest]!];
        i = smallest;
      }
    }
    return top;
  }
}

type Node = { cell: PathCell; cost: number; diagonals: number; previous: string | null };

function search(grid: PathGrid, from: PathCell, target: PathCell | null, maxCost: number) {
  const parityMatters = grid.rule === '5-10-5';
  const stateKey = (cell: PathCell, diagonals: number) => `${cell.col}:${cell.row}${parityMatters ? `:${diagonals % 2}` : ''}`;
  const before = grid.diagonalsBefore ?? 0;
  const start: Node = { cell: from, cost: 0, diagonals: before, previous: null };
  const best = new Map<string, Node>([[stateKey(from, before), start]]);
  const done = new Set<string>();
  const heap = new Heap<string>();
  const junctions = junctionsOf(grid.edges);
  const heuristic = (cell: PathCell) => (target ? Math.max(Math.abs(cell.col - target.col), Math.abs(cell.row - target.row)) : 0);
  heap.push(heuristic(from), stateKey(from, before));
  while (heap.size) {
    const id = heap.pop();
    if (done.has(id)) continue;
    done.add(id);
    const node = best.get(id)!;
    if (target && node.cell.col === target.col && node.cell.row === target.row) return { best, end: id };
    const fromCenter = centerOf(grid, node.cell);
    for (const [dc, dr] of STEPS) {
      const next = { col: node.cell.col + dc, row: node.cell.row + dr };
      if (!standable(grid, next)) continue;
      if (stepBlocked(fromCenter, centerOf(grid, next), grid.edges, junctions)) continue;
      const diagonal = dc !== 0 && dr !== 0;
      const cost = node.cost + stepCost(grid, next, diagonal, node.diagonals);
      if (cost > maxCost + 1e-9) continue;
      const diagonals = node.diagonals + (diagonal ? 1 : 0);
      const nextId = stateKey(next, diagonals);
      const known = best.get(nextId);
      if (known && known.cost <= cost) continue;
      best.set(nextId, { cell: next, cost, diagonals, previous: id });
      heap.push(cost + heuristic(next), nextId);
    }
  }
  return { best, end: null as string | null };
}

export function shortestPath(grid: PathGrid, from: PathCell, to: PathCell, maxCost = Infinity): PathResult | null {
  if (from.col === to.col && from.row === to.row) return { cost: 0, diagonals: 0, cells: [from] };
  if (!standable(grid, to)) return null;
  const { best, end } = search(grid, from, to, maxCost);
  if (!end) return null;
  const cells: PathCell[] = [];
  let id: string | null = end;
  while (id) {
    const node: Node = best.get(id)!;
    cells.unshift(node.cell);
    id = node.previous;
  }
  const last = best.get(end)!;
  return { cost: last.cost, diagonals: last.diagonals - (grid.diagonalsBefore ?? 0), cells };
}

export type Reachable = { cell: PathCell; cost: number; previous: PathCell | null };

export function reachablePositions(grid: PathGrid, from: PathCell, maxCost: number): Map<string, Reachable> {
  const { best } = search(grid, from, null, maxCost);
  const result = new Map<string, Reachable>();
  for (const node of best.values()) {
    const id = key(node.cell.col, node.cell.row);
    const known = result.get(id);
    if (!known || node.cost < known.cost) {
      result.set(id, { cell: node.cell, cost: node.cost, previous: node.previous ? best.get(node.previous)!.cell : null });
    }
  }
  return result;
}
