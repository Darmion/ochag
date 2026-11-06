import type { TableContext } from '../../context.ts';
import { notify } from '../../live/notify.ts';
import { getScene } from '../board.ts';
import { controls, detachChildren, rightsOf } from '../placements.ts';
import { objectParams, type ObjectParams, reject } from '../../shared.ts';

export function registerUnplaceObjectRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.delete<{ Params: ObjectParams }>(
    '/campaigns/:campaignId/scenes/:sceneId/objects/:objectId',
    { schema: { params: objectParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId, objectId } = request.params;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await getScene(q, campaignId, sceneId);

        const sceneObject = (
          await q.query(
            `SELECT p.id, p.scene_id, p.character_id, c.owner_user_id
             FROM scene_objects p
             JOIN characters c ON c.campaign_id=p.campaign_id AND c.id=p.character_id
             WHERE p.campaign_id=$1 AND p.scene_id=$2 AND p.id=$3
             FOR UPDATE OF p`,
            [campaignId, sceneId, objectId],
          )
        ).rows[0];

        if (!sceneObject) reject(404, 'Объект не найден на этой сцене.');

        if (!controls(await rightsOf(q, member, userId), userId, sceneObject.character_id, sceneObject.owner_user_id)) {
          reject(403, 'Убрать объект со сцены может его владелец, мастер или тот, кому выдано «Редактирование».');
        }

        await detachChildren(q, campaignId, [{ id: objectId, scene_id: sceneId }]);
        await q.query('DELETE FROM scene_objects WHERE id=$1', [objectId]);
        await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
      });

      void notify(ctx, campaignId, sceneId);

      return reply.code(204).send();
    },
  );
}
