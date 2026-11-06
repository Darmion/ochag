import type { TableContext } from '../../context.ts';
import { notify } from '../../live/notify.ts';
import { getScene } from '../board.ts';
import { canManage, reject, sceneParams, type SceneParams } from '../../shared.ts';

export function registerSceneTerrainRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.put<{ Params: SceneParams; Body: { cells: number[][] } }>(
    '/campaigns/:campaignId/scenes/:sceneId/terrain',
    {
      schema: {
        params: sceneParams,
        body: {
          type: 'object',
          required: ['cells'],
          additionalProperties: false,
          properties: {
            cells: {
              type: 'array',
              maxItems: 40000,
              items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: 0, maximum: 199 } },
            },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;

      const cells = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Местность отмечает мастер.');
        const scene = await getScene(q, campaignId, sceneId);

        const unique = new Map<string, number[]>();
        for (const [col, row] of request.body.cells) {
          if (col! >= scene.width_cells || row! >= scene.height_cells) reject(400, 'Клетка вне карты.');
          unique.set(`${col}:${row}`, [col!, row!]);
        }
        const list = [...unique.values()];

        await q.query('UPDATE scenes SET difficult_cells=$3::jsonb, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId, JSON.stringify(list)]);
        return list;
      });

      void notify(ctx, campaignId, sceneId);
      return { cells };
    },
  );
}
