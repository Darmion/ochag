import type { TableContext } from '../../context.ts';
import { notify } from '../../live/notify.ts';
import { getScene } from '../board.ts';
import { MAX_HEIGHT_FEET } from '../../../../../../packages/domain/map/relief.ts';
import { canManage, reject, sceneParams, type SceneParams } from '../../shared.ts';

const cell = { type: 'integer', minimum: 0, maximum: 199 };

export function registerSceneTerrainRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.put<{ Params: SceneParams; Body: { cells: number[][]; water?: number[][]; heights?: number[][] } }>(
    '/campaigns/:campaignId/scenes/:sceneId/terrain',
    {
      schema: {
        params: sceneParams,
        body: {
          type: 'object',
          required: ['cells'],
          additionalProperties: false,
          properties: {
            cells: { type: 'array', maxItems: 40000, items: { type: 'array', minItems: 2, maxItems: 2, items: cell } },
            water: {
              type: 'array',
              maxItems: 40000,
              items: { type: 'array', minItems: 3, maxItems: 3, items: [cell, cell, { type: 'integer', enum: [1, 2] }] },
            },
            heights: {
              type: 'array',
              maxItems: 40000,
              items: {
                type: 'array', minItems: 3, maxItems: 3,
                items: [cell, cell, { type: 'integer', minimum: -MAX_HEIGHT_FEET, maximum: MAX_HEIGHT_FEET, multipleOf: 5 }],
              },
            },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;

      const saved = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Местность отмечает мастер.');
        const scene = await getScene(q, campaignId, sceneId);
        const inside = (col: number, row: number) => {
          if (col >= scene.width_cells || row >= scene.height_cells) reject(400, 'Клетка вне карты.');
        };

        const water = new Map<string, number[]>();
        for (const [col, row, depth] of request.body.water ?? (Array.isArray(scene.water_cells) ? scene.water_cells : [])) {
          inside(col!, row!);
          water.set(`${col}:${row}`, [col!, row!, depth!]);
        }
        const difficult = new Map<string, number[]>();
        for (const [col, row] of request.body.cells) {
          inside(col!, row!);
          if (!water.has(`${col}:${row}`)) difficult.set(`${col}:${row}`, [col!, row!]);
        }
        const heights = new Map<string, number[]>();
        for (const [col, row, feet] of request.body.heights ?? (Array.isArray(scene.elevation_cells) ? scene.elevation_cells : [])) {
          inside(col!, row!);
          if (feet) heights.set(`${col}:${row}`, [col!, row!, feet]);
          else heights.delete(`${col}:${row}`);
        }
        const cells = [...difficult.values()], waterCells = [...water.values()], heightCells = [...heights.values()];

        await q.query(
          'UPDATE scenes SET difficult_cells=$3::jsonb, water_cells=$4::jsonb, elevation_cells=$5::jsonb, revision=revision+1 WHERE campaign_id=$1 AND id=$2',
          [campaignId, sceneId, JSON.stringify(cells), JSON.stringify(waterCells), JSON.stringify(heightCells)],
        );
        return { cells, water: waterCells, heights: heightCells };
      });

      void notify(ctx, campaignId, sceneId);
      return saved;
    },
  );
}
