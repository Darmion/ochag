import type { TableContext } from '../../context.ts';
import { notifyCampaign } from '../../live/notify.ts';
import { rightsOf } from '../placements.ts';
import { type CampaignParams, objectSchema, reject, uuid } from '../../shared.ts';
import { assertAsset } from '../../../characters/sheet/shared.ts';

const MAX_ITEMS = 60;

// Many objects get a picture at once (a random tree or rock from a set); the picture's open pair and crop belong to the old one.
export function registerObjectPicturesRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.post<{ Params: CampaignParams; Body: { items: Array<{ characterId: string; imageAssetId: string }> } }>(
    '/campaigns/:campaignId/characters/pictures',
    {
      schema: {
        params: objectSchema({ campaignId: uuid }),
        body: objectSchema({
          items: { type: 'array', minItems: 1, maxItems: MAX_ITEMS, items: objectSchema({ characterId: uuid, imageAssetId: uuid }) },
        }),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { items } = request.body;

      const updated = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await rightsOf(q, member, userId)).sceneManager) reject(403, 'Картинки объектам сразу помногу меняет мастер.');
        for (const assetId of new Set(items.map(item => item.imageAssetId))) await assertAsset(q, campaignId, assetId, 'object_image');
        let count = 0;
        for (const item of items) {
          count += (await q.query(
            `UPDATE characters SET image_asset_id=$3, image_open_asset_id=NULL, image_crop=NULL, revision=revision+1
             WHERE campaign_id=$1 AND id=$2 AND kind='object' RETURNING id`,
            [campaignId, item.characterId, item.imageAssetId],
          )).rows.length;
        }
        if (count) await q.query('UPDATE scenes SET revision=revision+1 WHERE campaign_id=$1', [campaignId]);
        return count;
      });

      if (updated) void notifyCampaign(ctx, campaignId, { type: 'changed' });
      return { updated };
    },
  );
}
