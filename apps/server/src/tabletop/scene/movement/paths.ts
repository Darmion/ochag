import type { Queryable } from '../../../db.ts';
import { pathBlocked } from '../../../../../../packages/domain/map/blockers.ts';
import { centerOf, costlyCell, positionOf, shortestPath, type PathCell, type PathGrid } from '../../../../../../packages/domain/map/pathfinding.ts';
import type { WallSegment } from '../../../../../../packages/domain/map/los.ts';
import type { TableContext } from '../../context.ts';
import { creatureCells } from './cells.ts';
import { diagonalRule, movementGrid } from './grid.ts';

type Point = { x: number; z: number };
export type WalkPath = { revision: number; to: Point; points: Array<[number, number]> };

const KEEP = 4000;
const TIP = 0.35;

// A diagonal step through a free wall end is legal but clips the wall: short crosses there make an equal-cost way round preferred.
function tipCrosses(edges: WallSegment[]): WallSegment[] {
  const ends = new Map<string, { x: number; z: number; count: number }>();
  for (const edge of edges) {
    for (const [x, z] of [[edge.x1, edge.z1], [edge.x2, edge.z2]] as const) {
      const id = `${Math.round(x * 1000)}:${Math.round(z * 1000)}`;
      const known = ends.get(id);
      if (known) known.count += 1;
      else ends.set(id, { x, z, count: 1 });
    }
  }
  return [...ends.values()].filter(end => end.count === 1).flatMap(({ x, z }) => [
    { x1: x - TIP, z1: z, x2: x + TIP, z2: z },
    { x1: x, z1: z - TIP, x2: x, z2: z + TIP },
  ]);
}

export function walkRoute(grid: PathGrid, from: Point, to: Point, avoid: ReadonlySet<string> = new Set()): Point[] | null {
  const start = positionOf(grid, from.x, from.z);
  const end = positionOf(grid, to.x, to.z);
  const inside = (cell: PathCell) => cell.col >= 0 && cell.row >= 0 && cell.col + grid.size <= grid.widthCells && cell.row + grid.size <= grid.heightCells;
  if (!inside(start) || !inside(end) || (start.col === end.col && start.row === end.row)) return null;
  const plain = shortestPath(grid, start, end);
  if (!plain) return null;
  const tipped: PathGrid = { ...grid, edges: [...grid.edges, ...tipCrosses(grid.edges)] };
  const crowd = new Set([...(grid.hostileCells ?? []), ...avoid]);
  const preferred = [{ ...tipped, hostileCells: crowd }, tipped, ...(avoid.size ? [{ ...grid, hostileCells: crowd }] : [])];
  let cells = plain.cells;
  for (const candidate of preferred) {
    const found = shortestPath(candidate, start, end, plain.cost);
    if (found) { cells = found.cells; break; }
  }
  const onPath = new Set(cells.flatMap(cell => Array.from({ length: grid.size * grid.size }, (_, index) => `${cell.col + (index % grid.size)}:${cell.row + Math.floor(index / grid.size)}`)));
  const points: Point[] = cells.map(cell => centerOf(grid, cell));
  points[0] = from;
  points[points.length - 1] = to;

  const closed = (col: number, row: number) => {
    const id = `${col}:${row}`;
    if (grid.blockedCells?.has(id) || grid.hostileCells?.has(id)) return true;
    return !onPath.has(id) && (avoid.has(id) || costlyCell(grid, { col, row }) || Boolean(grid.groundAt && grid.groundAt({ col, row }) !== 0));
  };
  const half = grid.size === 1 ? 0.3 : grid.size / 2 - 0.2;
  const clear = (a: Point, b: Point) => {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (!length) return true;
    const nx = -(b.z - a.z) / length * half, nz = (b.x - a.x) / length * half;
    for (const side of [0, 1, -1]) {
      const from = { x: a.x + nx * side, z: a.z + nz * side };
      const to = { x: b.x + nx * side, z: b.z + nz * side };
      if (pathBlocked(from, to, tipped.edges)) return false;
      const steps = Math.ceil(length / 0.25);
      for (let step = 1; step < steps; step += 1) {
        const t = step / steps;
        const col = Math.floor(from.x + (to.x - from.x) * t + grid.widthCells / 2);
        const row = Math.floor(from.z + (to.z - from.z) * t + grid.heightCells / 2);
        if (closed(col, row)) return false;
      }
    }
    return true;
  };
  const smooth: Point[] = [points[0]!];
  const last = points.length - 1;
  for (let anchor = 0; anchor < last;) {
    let next = anchor + 1;
    while (next < last && clear(points[anchor]!, points[next + 1]!)) next += 1;
    smooth.push(points[next]!);
    anchor = next;
  }
  return smooth.length > 2 ? smooth : null;
}

export function rememberWalk(ctx: TableContext, objectId: string, revision: number, to: Point, points: Point[] | null) {
  ctx.walkPaths.delete(objectId);
  if (!points) return;
  if (ctx.walkPaths.size >= KEEP) ctx.walkPaths.delete(ctx.walkPaths.keys().next().value!);
  ctx.walkPaths.set(objectId, {
    revision, to: { x: to.x, z: to.z },
    points: points.map(point => [Math.round(point.x * 1000) / 1000, Math.round(point.z * 1000) / 1000]),
  });
}

export function walkOf(ctx: TableContext, placement: { id: string; revision: number; world_x: number; world_z: number; parent_object_id?: string | null }) {
  const known = ctx.walkPaths.get(placement.id);
  if (!known || placement.parent_object_id || known.revision !== placement.revision) return null;
  if (Math.abs(known.to.x - placement.world_x) > 1e-6 || Math.abs(known.to.z - placement.world_z) > 1e-6) return null;
  return known.points;
}

export async function recordWalk(
  ctx: TableContext, q: Queryable, campaignId: string, scene: any, mover: { id: string; size: string },
  from: Point, to: Point, revision: number, creatures: boolean,
) {
  const grid = await movementGrid(q, campaignId, scene, placement => placement.id === mover.id, mover.size, await diagonalRule(q, campaignId), creatures);
  const avoid = (await creatureCells(q, campaignId, scene, mover.id)) ?? new Set<string>();
  rememberWalk(ctx, mover.id, revision, to, walkRoute(grid, from, to, avoid));
}
