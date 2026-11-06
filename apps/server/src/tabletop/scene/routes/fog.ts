import type { TableContext } from '../../context.ts';
import { notifyCampaign } from '../../live/notify.ts';
import { canManage, reject, uuid } from '../../shared.ts';

export function registerCampaignFogRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.put<{ Params: { campaignId: string }; Body: { enabled: boolean } }>(
    '/campaigns/:campaignId/fog',
    {
      schema: {
        params: { type: 'object', required: ['campaignId'], additionalProperties: false, properties: { campaignId: uuid } },
        body: { type: 'object', required: ['enabled'], additionalProperties: false, properties: { enabled: { type: 'boolean' } } },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Туман включает и выключает мастер.');
        await q.query('UPDATE campaigns SET fog_enabled=$2 WHERE id=$1', [campaignId, request.body.enabled]);
      });
      void notifyCampaign(ctx, campaignId, { type: 'changed' });
      return { fogEnabled: request.body.enabled };
    },
  );
}
