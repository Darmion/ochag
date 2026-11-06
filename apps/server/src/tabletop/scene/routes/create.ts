import type { TableContext } from '../../context.ts';
import { campaignParams, type CampaignParams, canManage, reject } from '../../shared.ts';

export function registerSceneCreateRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.post<{
    Params: CampaignParams;
    Body: { name: string; widthCells?: number; heightCells?: number };
  }>(
    '/campaigns/:campaignId/scenes',
    {
      schema: {
        params: campaignParams,
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: {
              type: 'string',
              minLength: 1,
              maxLength: 200,
              pattern: '\\S',
            },
            widthCells: { type: 'integer', minimum: 1, maximum: 200 },
            heightCells: { type: 'integer', minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const widthCells = request.body.widthCells ?? 20;
      const heightCells = request.body.heightCells ?? 20;

      const scene = await db.transaction(async q => {
        const member = await membership(
          q, campaignId, userId, true,
        );

        if (!(await canManage(q, member, userId))) {
          reject(403, 'Создавать сцены может мастер.');
        }

        const { rows } = await q.query(
          `INSERT INTO scenes (
             campaign_id, name, feet_per_unit,
             width_cells, height_cells, scene_document
           )
           VALUES (
             $1, $2, 5, $3, $4,
             '{"kind":"shared-grid-v1"}'::jsonb
           )
           RETURNING id, name, revision, width_cells, height_cells,
                     feet_per_unit::float8 AS feet_per_unit, background_asset_id,
                     default_vision_radius_feet::float8 AS default_vision_radius_feet`,
          [campaignId, request.body.name.trim(), widthCells, heightCells],
        );

        return rows[0];
      });

      return reply.code(201).send(scene);
    },
  );
}
