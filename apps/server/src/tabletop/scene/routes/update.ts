import { weatherRules, WEATHERS } from '../../../../../../packages/domain/world/clock.ts';
import type { TableContext } from '../../context.ts';
import { notify, notifyCampaign } from '../../live/notify.ts';
import { getScene } from '../board.ts';
import { canManage, reject, sceneParams, type SceneParams, uuid } from '../../shared.ts';

export function registerSceneUpdateRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.patch<{
    Params: SceneParams;
    Body: {
      widthCells?: number;
      heightCells?: number;
      feetPerUnit?: number;
      backgroundAssetId?: string | null;
      backgroundRotation?: 0 | 90 | 180 | 270;
      defaultVisionRadiusFeet?: number | null;
      lighting?: 'bright' | 'dim' | 'dark';
      sky?: 'fixed' | 'clock';
      weather?: string;
      grid?: { visible?: boolean; style?: string; color?: string | null; opacity?: number; width?: number };
      ambience?: { place?: string; water?: string; volume?: number; steps?: string };
      name?: string;
    };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId',
    {
      schema: {
        params: sceneParams,
        body: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
            widthCells: { type: 'integer', minimum: 1, maximum: 200 },
            heightCells: { type: 'integer', minimum: 1, maximum: 200 },
            feetPerUnit: {
              type: 'number',
              exclusiveMinimum: 0,
              maximum: 100,
            },
            backgroundAssetId: { oneOf: [uuid, { type: 'null' }] },
            backgroundRotation: { type: 'integer', enum: [0, 90, 180, 270] },
            defaultVisionRadiusFeet: {
              oneOf: [
                { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
                { type: 'null' },
              ],
            },
            lighting: { type: 'string', enum: ['bright', 'dim', 'dark'] },
            sky: { type: 'string', enum: ['fixed', 'clock'] },
            weather: { type: 'string', enum: [...WEATHERS] },
            grid: {
              type: 'object',
              additionalProperties: false,
              properties: {
                visible: { type: 'boolean' },
                style: { type: 'string', enum: ['lines', 'dashed', 'dots', 'crosses'] },
                color: { oneOf: [{ type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, { type: 'null' }] },
                opacity: { type: 'number', minimum: 0.05, maximum: 1 },
                width: { type: 'integer', minimum: 1, maximum: 4 },
              },
            },
            ambience: {
              type: 'object',
              additionalProperties: false,
              properties: {
                place: { type: 'string', enum: ['none', 'forest', 'cave', 'beach', 'sea', 'inside'] },
                water: { type: 'string', enum: ['none', 'river', 'stream', 'waterfall'] },
                volume: { type: 'number', minimum: 0, maximum: 1 },
                steps: { type: 'string', enum: ['auto', 'dirt', 'stone', 'water', 'wood'] },
              },
            },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const {
        widthCells, heightCells, feetPerUnit, backgroundAssetId, backgroundRotation,
        defaultVisionRadiusFeet, lighting, sky, weather, grid, ambience, name,
      } = request.body;
      let doused: string[] = [];

      const result = await db.transaction(async q => {
        const member = await membership(
          q, campaignId, userId, true,
        );

        if (!(await canManage(q, member, userId))) {
          reject(403, 'Изменять сцену может мастер.');
        }

        await getScene(q, campaignId, sceneId);

        if (backgroundAssetId !== undefined && backgroundAssetId !== null) {
          const asset = (
            await q.query(
              `SELECT id FROM assets
               WHERE campaign_id=$1 AND id=$2 AND kind='scene_background'`,
              [campaignId, backgroundAssetId],
            )
          ).rows[0];

          if (!asset) reject(400, 'Картинка не найдена в этой кампании.');
        }

        const updated = await q.query(
          `UPDATE scenes SET
             width_cells = COALESCE($1, width_cells),
             height_cells = COALESCE($2, height_cells),
             feet_per_unit = COALESCE($3, feet_per_unit),
             background_asset_id =
               CASE WHEN $4 THEN $5 ELSE background_asset_id END,
             default_vision_radius_feet =
               CASE WHEN $7 THEN $8 ELSE default_vision_radius_feet END,
             lighting = COALESCE($9, lighting),
             sky = COALESCE($10, sky),
             weather = COALESCE($11, weather),
             background_rotation = COALESCE($12, background_rotation),
             grid = COALESCE($13::jsonb, grid),
             ambience = COALESCE($14::jsonb, ambience),
             name = COALESCE($15, name),
             revision = revision + 1
           WHERE id=$6
           RETURNING id, name, revision, width_cells, height_cells,
                     feet_per_unit::float8 AS feet_per_unit, background_asset_id, background_rotation,
                     default_vision_radius_feet::float8 AS default_vision_radius_feet, lighting, sky, weather, grid, ambience`,
          [
            widthCells ?? null,
            heightCells ?? null,
            feetPerUnit ?? null,
            backgroundAssetId !== undefined,
            backgroundAssetId ?? null,
            sceneId,
            defaultVisionRadiusFeet !== undefined,
            defaultVisionRadiusFeet ?? null,
            lighting ?? null,
            sky ?? null,
            weather ?? null,
            backgroundRotation ?? null,
            grid === undefined ? null : JSON.stringify(grid),
            ambience === undefined ? null : JSON.stringify(ambience),
            name === undefined ? null : name.trim(),
          ],
        );

        if (weather && weatherRules(weather).dousesFlames) {
          doused = (
            await q.query(
              `UPDATE object_states s SET lit=false
               FROM scene_objects p, characters c
               WHERE s.campaign_id=$1 AND p.campaign_id=s.campaign_id AND p.scene_id=$2 AND p.character_id=s.character_id
                 AND c.campaign_id=s.campaign_id AND c.id=s.character_id AND s.light_open_flame AND s.lit
               RETURNING c.name`,
              [campaignId, sceneId],
            )
          ).rows.map(row => row.name as string);
        }

        return updated.rows[0];
      });

      void notify(ctx, campaignId, sceneId);
      if (name !== undefined) void notifyCampaign(ctx, campaignId, { type: 'changed' });
      if (doused.length) {
        void notifyCampaign(ctx, campaignId, { type: 'notice', title: 'Ливень гасит огонь', detail: `Погасли: ${[...new Set(doused)].join(', ')}.`, tone: 'info' });
        void notifyCampaign(ctx, campaignId, { type: 'changed' });
      }

      return result;
    },
  );
}
