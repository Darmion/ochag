import { pathBlocked } from '../../../../../../packages/domain/map/blockers.ts';
import { positionOf, reachablePositions, centerOf } from '../../../../../../packages/domain/map/pathfinding.ts';
import { occupiedCells } from '../../../../../../packages/domain/map/footprint.ts';
import { autoOptions } from '../planner.ts';
import { feetBetween } from '../../scene/board.ts';
import { creatureCells, movementRules } from '../../scene/movement.ts';
import type { Placement } from '../../shared.ts';
import type { Queryable } from '../../../db.ts';
import type { TurnBoard, TurnInput } from './types.ts';

export async function chooseTarget(q: Queryable, { campaignId, targetMode }: TurnInput, { scene, npc, alive, reach }: TurnBoard) {
  const pathRules = await movementRules(q, campaignId, scene, npc.character_id);
  const pathGrid = pathRules.grid;
  const occupied = (await creatureCells(q, campaignId, scene, npc.id)) ?? new Set<string>();
  const fromCell = positionOf(pathGrid, npc.world_x, npc.world_z);
  const fromKey = `${fromCell.col}:${fromCell.row}`;
  const everywhere = reachablePositions(pathGrid, fromCell, pathGrid.widthCells * pathGrid.heightCells * 2);
  const free = (cell: { col: number; row: number }, id: string) => id === fromKey ||
    !occupiedCells(scene, centerOf(pathGrid, cell).x, centerOf(pathGrid, cell).z, pathGrid.size).some(part => occupied.has(`${part.col}:${part.row}`));
  const strikesFrom = (cell: { col: number; row: number }, enemy: Placement) => {
    const at = centerOf(pathGrid, cell);
    return feetBetween(scene, { ...npc, world_x: at.x, world_z: at.z }, enemy) <= reach
      && !pathBlocked(at, { x: enemy.world_x, z: enemy.world_z }, pathGrid.edges);
  };
  const pathTo = (enemy: Placement) => {
    let bestCost = Infinity;
    for (const [id, entry] of everywhere) if (entry.cost < bestCost && free(entry.cell, id) && strikesFrom(entry.cell, enemy)) bestCost = entry.cost;
    return bestCost;
  };
  const hpOf = new Map(
    (await q.query('SELECT id, hp_current FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, alive.map(entry => entry.character_id)]))
      .rows.map(row => [row.id as string, Number(row.hp_current ?? 0)]),
  );
  const threatOf = new Map<string, number>();
  if (targetMode === 'threat') {
    for (const entry of alive) {
      threatOf.set(entry.character_id, Math.max(0, ...(await autoOptions(q, campaignId, entry.character_id)).filter(option => option.kind !== 'heal').map(option => option.expected)));
    }
  }
  const ranked = alive.map(entry => ({
    entry, path: pathTo(entry), straight: feetBetween(scene, npc, entry), hp: hpOf.get(entry.character_id) ?? 0, threat: threatOf.get(entry.character_id) ?? 0,
  })).sort((a, b) => {
    const unreachable = Number(a.path === Infinity) - Number(b.path === Infinity);
    if (targetMode !== 'nearest' && unreachable) return unreachable;
    if (targetMode === 'weakest' && a.hp !== b.hp) return a.hp - b.hp;
    if (targetMode === 'threat' && a.threat !== b.threat) return b.threat - a.threat;
    return a.path - b.path || a.straight - b.straight;
  });
  const target = ranked[0]!.entry;
  return { pathRules, pathGrid, fromCell, free, strikesFrom, hpOf, target };
}

export type TargetChoice = Awaited<ReturnType<typeof chooseTarget>>;
