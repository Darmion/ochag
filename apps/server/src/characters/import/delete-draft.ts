import type { FastifyInstance } from 'fastify';
import { type Options, reject, draftParamsSchema, type DraftParams } from './shared.ts';

export function registerDeleteDraftRoute(app: FastifyInstance, { db, auth, membership }: Options) {
  app.delete<{
    Params: DraftParams;
  }>('/campaigns/:campaignId/imports/:draftId', {
    schema: { params: draftParamsSchema },
  }, async (request, reply) => {
    const userId = await auth(request);
    const { campaignId, draftId } = request.params;

    await db.transaction(async q => {
      await membership(q, campaignId, userId, true);

      const { rows } = await q.query(
        `SELECT status FROM import_drafts
         WHERE id=$1 AND campaign_id=$2 AND created_by=$3
         FOR UPDATE`,
        [draftId, campaignId, userId],
      );

      if (!rows[0]) reject(404, 'Черновик не найден.');

      if (rows[0].status === 'confirmed') {
        reject(409, 'Импорт уже подтверждён.');
      }

      await q.query(
        `UPDATE import_drafts
         SET status='cancelled'
         WHERE id=$1`,
        [draftId],
      );
    });

    return reply.code(204).send();
  });
}
