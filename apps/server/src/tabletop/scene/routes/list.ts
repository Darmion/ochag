import type { TableContext } from '../../context.ts';
import { campaignParams, type CampaignParams, canManage } from '../../shared.ts';

export function registerSceneListRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.get<{ Params: CampaignParams }>(
    '/campaigns/:campaignId/scenes',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;

      const member = await membership(db, campaignId, userId);

      const { rows } = await db.query(
        `SELECT id, name, revision, width_cells, height_cells,
                feet_per_unit::float8 AS feet_per_unit, background_asset_id, background_rotation
         FROM scenes
         WHERE campaign_id=$1
           AND scene_document->>'kind'='shared-grid-v1'
         ORDER BY name, id`,
        [campaignId],
      );

      return { scenes: rows, canManage: await canManage(db, member, userId) };
    },
  );
}
