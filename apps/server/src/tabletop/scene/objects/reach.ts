import { positionOf, reachablePositions } from '../../../../../../packages/domain/map/pathfinding.ts';
import type { TableContext } from '../../context.ts';
import { getScene } from '../board.ts';
import { creatureCells, diagonalRule, gmFreeMove, movementGrid, movementState } from '../movement.ts';
import { controls, loadPlacements, rightsOf } from '../placements.ts';
import { objectParams, type ObjectParams, type Placement, reject } from '../../shared.ts';

const FREE_ROUTE_CELLS = 30;

export function registerReachRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.get<{ Params: ObjectParams; Querystring: { mode?: 'turn' | 'drag' } }>(
    '/campaigns/:campaignId/scenes/:sceneId/objects/:objectId/reach',
    {
      schema: {
        params: objectParams,
        querystring: { type: 'object', properties: { mode: { type: 'string', enum: ['turn', 'drag'] } }, additionalProperties: false },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId, objectId } = request.params;
      const drag = request.query.mode === 'drag';

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId);
        const scene: any = await getScene(q, campaignId, sceneId, false);
        const freeRoutes = async (placement: Placement, sceneManager: boolean) => {
          const grid = await movementGrid(q, campaignId, scene, entry => entry.id === placement.id, placement.size, await diagonalRule(q, campaignId), !sceneManager);
          const occupied = (await creatureCells(q, campaignId, scene, placement.id)) ?? new Set<string>();
          const fogged = !sceneManager && !member.fog_disabled_by_gm
            && (await q.query('SELECT fog_enabled FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.fog_enabled === true;
          const explored = fogged
            ? new Set<number>((await q.query('SELECT explored_cells FROM scene_fog_state WHERE campaign_id=$1 AND scene_id=$2 AND user_id=$3', [campaignId, sceneId, userId])).rows[0]?.explored_cells ?? [])
            : null;
          const trail: number[][] = [];
          const costs: number[][] = [];
          for (const { cell, cost, previous } of reachablePositions(grid, positionOf(grid, placement.world_x, placement.world_z), FREE_ROUTE_CELLS).values()) {
            const parts = Array.from({ length: grid.size * grid.size }, (_, index) => ({ col: cell.col + (index % grid.size), row: cell.row + Math.floor(index / grid.size) }));
            if (explored && !parts.every(part => explored.has(part.row * scene.width_cells + part.col))) continue;
            if (previous) trail.push([cell.col, cell.row, previous.col, previous.row]);
            if (!parts.some(part => occupied.has(`${part.col}:${part.row}`))) costs.push([cell.col, cell.row, Math.round(cost * scene.feet_per_unit * 1000) / 1000]);
          }
          return { trail, costs };
        };
        const placements = await loadPlacements(q, campaignId, sceneId);
        const placement = placements.find(entry => entry.id === objectId);
        if (!placement) reject(404, 'Объект не найден на этой сцене.');
        const rights = await rightsOf(q, member, userId);
        if (!placement.shared && !controls(rights, userId, placement.character_id, placement.owner_user_id)) {
          reject(403, 'Недостаточно прав.');
        }

        const none = { limited: false, isTurn: false, feetLeft: null as number | null, budget: null as number | null, crawling: false, reasons: [] as string[], cells: [] as number[][], costs: [] as number[][], trail: [] as number[][] };
        if (placement.kind === 'object' || placement.parent_object_id) return none;
        const state = await movementState(q, campaignId, scene, placement.character_id, false);
        if (!state) return drag && !(rights.sceneManager && (await gmFreeMove(q, campaignId))) ? { ...none, ...(await freeRoutes(placement, rights.sceneManager)) } : none;
        if (drag && !state.mine.is_current && rights.sceneManager && (await gmFreeMove(q, campaignId))) return none;

        const result = {
          limited: true,
          isTurn: Boolean(state.mine.is_current),
          feetLeft: Math.max(0, state.left),
          budget: state.budget,
          crawling: state.speed.crawling,
          reasons: state.speed.reasons,
          cells: [] as number[][],
          costs: [] as number[][],
          trail: [] as number[][],
        };
        if (!result.isTurn || state.speed.feet <= 0 || state.left <= 0) return result;

        const occupiedByCreatures = drag ? (await creatureCells(q, campaignId, scene, placement.id)) ?? new Set<string>() : new Set<string>();
        const start = positionOf(state.grid, placement.world_x, placement.world_z);
        const cells = new Map<string, number[]>();
        for (const { cell, cost, previous } of reachablePositions(state.grid, start, state.left / state.feetPerCell).values()) {
          if (previous) result.trail.push([cell.col, cell.row, previous.col, previous.row]);
          const footprint: Array<{ col: number; row: number }> = [];
          for (let row = cell.row; row < cell.row + state.grid.size; row += 1) {
            for (let col = cell.col; col < cell.col + state.grid.size; col += 1) footprint.push({ col, row });
          }
          if (footprint.some(part => occupiedByCreatures.has(`${part.col}:${part.row}`))) continue;
          for (const part of footprint) cells.set(`${part.col}:${part.row}`, [part.col, part.row]);
          result.costs.push([cell.col, cell.row, Math.round(cost * state.feetPerCell * 1000) / 1000]);
        }

        result.cells = [...cells.values()];
        return result;
      });
    },
  );
}
