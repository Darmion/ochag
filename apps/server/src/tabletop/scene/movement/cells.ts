import type { Queryable } from '../../../db.ts';
import { pathBlocked } from '../../../../../../packages/domain/map/blockers.ts';
import { shortestPath, positionOf } from '../../../../../../packages/domain/map/pathfinding.ts';
import type { WallSegment } from '../../../../../../packages/domain/map/los.ts';
import { occupiedCells, footprintCells } from '../../../../../../packages/domain/map/footprint.ts';
import { anyCellCutByWall } from '../board.ts';
import { loadPlacements } from '../placements.ts';
import { reject } from '../../shared.ts';
import { diagonalRule, movementGrid } from './grid.ts';

export async function assertPassable(
  q: Queryable, campaignId: string, scene: any, movingId: string,
  from: { x: number; z: number }, to: { x: number; z: number }, size: string, gm = false,
) {
  if (from.x === to.x && from.z === to.z) return;

  const grid = await movementGrid(q, campaignId, scene, placement => placement.id === movingId, size, await diagonalRule(q, campaignId), !gm);

  const target = occupiedCells(scene, to.x, to.z, footprintCells(size));
  if (target.some(cell => grid.blockedCells?.has(`${cell.col}:${cell.row}`))) {
    reject(400, 'Туда не встать — там преграда.');
  }
  if (target.some(cell => grid.hostileCells?.has(`${cell.col}:${cell.row}`))) return;
  const start = positionOf(grid, from.x, from.z);
  const end = positionOf(grid, to.x, to.z);
  const inside = (cell: { col: number; row: number }) =>
    cell.col >= 0 && cell.row >= 0 && cell.col + grid.size <= grid.widthCells && cell.row + grid.size <= grid.heightCells;
  if (!inside(start) || !inside(end)) {
    if (pathBlocked(from, to, grid.edges)) reject(400, 'Путь перегораживает стена или закрытая преграда.');
    return;
  }
  if (!shortestPath(grid, start, end)) {
    reject(400, pathBlocked(from, to, grid.edges)
      ? 'Путь перегораживает стена или закрытая преграда — и в обход не пройти.'
      : 'Сквозь врага не пройти — обойдите его.');
  }
}

export async function creatureCells(q: Queryable, campaignId: string, scene: any, exceptId: string | null, alsoExcept: readonly string[] = []): Promise<Set<string> | null> {
  const flag = (
    await q.query(`SELECT value FROM campaign_rules WHERE campaign_id=$1 AND kind='flag' AND key='one_per_cell'`, [campaignId])
  ).rows[0];
  if (flag && flag.value !== true) return null;

  const others = (await loadPlacements(q, campaignId, scene.id))
    .filter(placement => placement.id !== exceptId && !alsoExcept.includes(placement.id) && placement.kind !== 'object' && !placement.parent_object_id && !placement.hidden);
  if (!others.length) return new Set();
  const dead = new Set(
    (
      await q.query(
        `SELECT character_id FROM character_effects WHERE campaign_id=$1 AND character_id = ANY($2::uuid[]) AND active AND effect_code='dead'`,
        [campaignId, others.map(placement => placement.character_id)],
      )
    ).rows.map(row => row.character_id as string),
  );
  return new Set(
    others
      .filter(placement => !dead.has(placement.character_id))
      .flatMap(placement => occupiedCells(scene, placement.world_x, placement.world_z, footprintCells(placement.size)))
      .map(cell => `${cell.col}:${cell.row}`),
  );
}

export async function assertFreeCell(
  q: Queryable, campaignId: string, scene: any, movingId: string,
  from: { x: number; z: number }, to: { x: number; z: number }, size: string, formation: readonly string[] = [],
) {
  if (from.x === to.x && from.z === to.z) return;
  const occupied = await creatureCells(q, campaignId, scene, movingId, formation);
  if (occupied && occupiedCells(scene, to.x, to.z, footprintCells(size)).some(cell => occupied.has(`${cell.col}:${cell.row}`))) {
    reject(400, 'Клетка занята другим существом — встаньте рядом.');
  }
}

export async function nearestFreeSpot(q: Queryable, campaignId: string, scene: any, at: { x: number; z: number }, n: number, walls: WallSegment[]) {
  const occupied = await creatureCells(q, campaignId, scene, null);
  if (!occupied && !walls.length) return at;
  const free = (x: number, z: number) => {
    const cells = occupiedCells(scene, x, z, n);
    return cells.length === n * n
      && !(occupied && cells.some(cell => occupied.has(`${cell.col}:${cell.row}`)))
      && !anyCellCutByWall(scene, x, z, n, walls);
  };
  if (free(at.x, at.z)) return at;
  const maxRing = Math.max(scene.width_cells, scene.height_cells);
  for (let ring = 1; ring <= maxRing; ring += 1) {
    const spots: Array<{ x: number; z: number; distance: number }> = [];
    for (let dz = -ring; dz <= ring; dz += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        if (free(at.x + dx, at.z + dz)) spots.push({ x: at.x + dx, z: at.z + dz, distance: Math.hypot(dx, dz) });
      }
    }
    if (spots.length) {
      spots.sort((a, b) => a.distance - b.distance);
      return { x: spots[0].x, z: spots[0].z };
    }
  }
  return at;
}
