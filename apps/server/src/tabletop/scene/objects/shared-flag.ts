import type { TableContext } from '../../context.ts';
import { notifyCampaign } from '../../live/notify.ts';
import { rightsOf } from '../placements.ts';
import { type CampaignParams, objectSchema, reject, uuid } from '../../shared.ts';

export function registerSharedObjectRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.patch<{ Params: CampaignParams & { characterId: string }; Body: { shared: boolean } }>(
    '/campaigns/:campaignId/characters/:characterId/shared',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, characterId: uuid }),
        body: objectSchema({ shared: { type: 'boolean' } }),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const character = (
          await q.query(
            'SELECT owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE',
            [campaignId, characterId],
          )
        ).rows[0];

        if (!character) reject(404, 'Объект не найден.');

        const rights = await rightsOf(q, member, userId);

        if (character.owner_user_id !== userId && !rights.sceneManager && !rights.characterManager) {
          reject(403, 'Сделать объект общим может его владелец или мастер.');
        }

        await q.query('UPDATE characters SET shared=$1 WHERE id=$2', [request.body.shared, characterId]);
        await q.query('UPDATE scenes SET revision=revision+1 WHERE campaign_id=$1', [campaignId]);
      });

      void notifyCampaign(ctx, campaignId, { type: 'changed' });
      return { shared: request.body.shared };
    },
  );
}
