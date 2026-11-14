import { SCENE_PRESET_IDS, type ScenePresetId } from '../../../../../../packages/domain/map/scene-presets.ts';
import type { TableContext } from '../../context.ts';
import { createSceneFromPackage, presetPackage } from '../scene-package.ts';
import { campaignParams, type CampaignParams, canManage, reject } from '../../shared.ts';

const SCENE_ROW = `id, name, revision, width_cells, height_cells,
  feet_per_unit::float8 AS feet_per_unit, background_asset_id,
  default_vision_radius_feet::float8 AS default_vision_radius_feet`;

export function registerSceneCreateRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.post<{
    Params: CampaignParams;
    Body: { name: string; widthCells?: number; heightCells?: number; preset?: ScenePresetId };
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
            preset: { type: 'string', enum: [...SCENE_PRESET_IDS] },
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

        if (request.body.preset) {
          const created = await createSceneFromPackage(q, campaignId, presetPackage(request.body.preset), 'copy', request.body.name.trim(), userId);
          return (await q.query(`SELECT ${SCENE_ROW} FROM scenes WHERE campaign_id=$1 AND id=$2`, [campaignId, created.id])).rows[0];
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
           RETURNING ${SCENE_ROW}`,
          [campaignId, request.body.name.trim(), widthCells, heightCells],
        );

        return rows[0];
      });

      return reply.code(201).send(scene);
    },
  );
}
