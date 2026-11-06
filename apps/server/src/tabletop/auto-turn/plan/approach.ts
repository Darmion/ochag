import { positionOf, reachablePositions, centerOf } from '../../../../../../packages/domain/map/pathfinding.ts';
import { detectOpportunities } from '../../combat/opportunity.ts';
import type { TableContext } from '../../context.ts';
import { feetBetween } from '../../scene/board.ts';
import { assertNotTowardFear, dragAlong, movementState, releaseDistantGrapples, spendMovement } from '../../scene/movement.ts';
import type { Queryable } from '../../../db.ts';
import type { TurnBoard, TurnInput, TurnLog } from './types.ts';
import type { TargetChoice } from './target.ts';

export async function approachTarget(
  ctx: TableContext, q: Queryable, { campaignId, sceneId, userId }: TurnInput, turn: TurnLog,
  { scene, npc, alive, holding, reach }: TurnBoard, { pathRules, pathGrid, fromCell, free, strikesFrom, target }: TargetChoice,
) {
  const { triggers } = ctx;
  let moved: { from: { x: number; z: number }; to: { x: number; z: number } } | null = null;
  const from = { x: npc.world_x, z: npc.world_z };
  let position = from;
  if (!strikesFrom(fromCell, target)) {
    const state = await movementState(q, campaignId, scene, npc.character_id, true);
    const left = state ? state.left : pathRules.speed.feet;
    const speedOk = state ? state.speed.feet > 0 : pathRules.speed.feet > 0;
    if (speedOk && left > 0) {
      const grid = state ? state.grid : pathGrid;
      const feetPerCell = state ? state.feetPerCell : pathRules.feetPerCell;
      const reachable = reachablePositions(grid, fromCell, left / feetPerCell);
      const toTarget = reachablePositions(pathGrid, positionOf(pathGrid, target.world_x, target.world_z), pathGrid.widthCells * pathGrid.heightCells * 2);
      const remaining = (cell: { col: number; row: number }) => toTarget.get(`${cell.col}:${cell.row}`)?.cost ?? Infinity;
      const fearCheck = async (to: { x: number; z: number }) => {
        try {
          await assertNotTowardFear(q, campaignId, scene, npc, to);
          return true;
        } catch {
          return false;
        }
      };
      let best: { to: { x: number; z: number }; strike: boolean; left: number; cost: number; straight: number; guard: number } | null = null;
      const keepAway = holding && reach > 5;
      const guardOf = (to: { x: number; z: number }) => Math.min(Infinity, ...alive.map(entry => feetBetween(scene, { ...npc, world_x: to.x, world_z: to.z }, entry)));
      for (const [id, { cell, cost: cellsCost }] of reachable) {
        if (cellsCost === 0 || !free(cell, id)) continue;
        const to = centerOf(grid, cell);
        const cost = cellsCost * feetPerCell;
        const strike = strikesFrom(cell, target);
        const rest = remaining(cell);
        const straight = Math.hypot(to.x - target.world_x, to.z - target.world_z);
        const guard = keepAway ? guardOf(to) : 0;
        const tie = (a: number, b: number) => Math.abs(a - b) < 1e-9;
        const better = !best
          || (strike && !best.strike)
          || (strike === best.strike && (strike
            ? (keepAway && guard > best.guard + 1e-9) || ((!keepAway || tie(guard, best.guard)) && (cost < best.cost - 1e-9 || (tie(cost, best.cost) && straight < best.straight - 1e-9)))
            : rest < best.left - 1e-9 || (tie(rest, best.left) && (cost < best.cost - 1e-9 || (tie(cost, best.cost) && straight < best.straight - 1e-9)))));
        if (better && (await fearCheck(to))) best = { to, strike, left: rest, cost, straight, guard };
      }
      if (best && (best.strike || best.left < remaining(fromCell))) {
        if (state) await spendMovement(ctx, q, campaignId, scene, npc.character_id, from, best.to);
        await q.query('UPDATE scene_objects SET x=$3, z=$4, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, npc.id, best.to.x, best.to.z]);
        await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
        turn.notices = await triggers.fireEnter(q, campaignId, scene, userId, { characterId: npc.character_id, name: npc.name, size: npc.size }, from, best.to);
        turn.notices.push(...await dragAlong(q, campaignId, scene, npc, from, best.to));
        turn.notices.push(...await releaseDistantGrapples(q, campaignId, scene, npc.character_id));
        turn.provoked = await detectOpportunities(q, campaignId, scene, npc.character_id, from, best.to);
        moved = { from, to: best.to };
        position = best.to;
      }
    }
  }
  return { moved, position };
}
