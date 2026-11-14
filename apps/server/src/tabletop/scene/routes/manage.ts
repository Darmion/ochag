import type { Queryable } from '../../../db.ts';
import type { TableContext } from '../../context.ts';
import { notifyCampaign, notifySceneRemoved } from '../../live/notify.ts';
import { getScene } from '../board.ts';
import { createSceneFromPackage, packageCounts, snapshotScene, type ScenePackage } from '../scene-package.ts';
import { listBackups, removeScene, sceneContents } from '../scene-removal.ts';
import { campaignParams, type CampaignParams, canManage, objectSchema, reject, sceneParams, type SceneParams, uuid } from '../../shared.ts';

const sceneName = { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' };

export function registerSceneManageRoutes(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  async function requireGm(q: Queryable, campaignId: string, userId: string, message: string) {
    const member = await membership(q, campaignId, userId, true);
    if (!(await canManage(q, member, userId))) reject(403, message);
  }

  app.get<{ Params: SceneParams }>(
    '/campaigns/:campaignId/scenes/:sceneId/contents',
    { schema: { params: sceneParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      return db.transaction(async q => {
        await requireGm(q, campaignId, userId, 'Состав сцены смотрит мастер.');
        await getScene(q, campaignId, sceneId, false);
        return sceneContents(q, campaignId, sceneId);
      });
    },
  );

  app.delete<{ Params: SceneParams }>(
    '/campaigns/:campaignId/scenes/:sceneId',
    { schema: { params: sceneParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const removed = await db.transaction(async q => {
        await requireGm(q, campaignId, userId, 'Удалить сцену может мастер.');
        const scene = await getScene(q, campaignId, sceneId);
        if ((await sceneContents(q, campaignId, sceneId)).combat) {
          reject(409, `На сцене «${scene.name}» идёт бой. Завершите его, потом удаляйте сцену.`);
        }
        const backupId = await removeScene(q, campaignId, sceneId, String(scene.name), userId);
        return { backupId, name: String(scene.name) };
      });
      void notifySceneRemoved(ctx, campaignId, sceneId, removed.name);
      return removed;
    },
  );

  app.post<{ Params: SceneParams; Body: { name: string; creatures?: boolean } }>(
    '/campaigns/:campaignId/scenes/:sceneId/copy',
    { schema: { params: sceneParams, body: objectSchema({ name: sceneName, creatures: { type: 'boolean' } }, ['name']) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const created = await db.transaction(async q => {
        await requireGm(q, campaignId, userId, 'Копировать сцену может мастер.');
        await getScene(q, campaignId, sceneId);
        const pkg = await snapshotScene(q, campaignId, sceneId, 'copy', request.body.creatures === true);
        const scene = await createSceneFromPackage(q, campaignId, pkg, 'copy', request.body.name.trim(), userId);
        return { ...scene, counts: packageCounts(pkg) };
      });
      void notifyCampaign(ctx, campaignId, { type: 'changed' });
      return reply.code(201).send(created);
    },
  );

  app.get<{ Params: CampaignParams }>(
    '/campaigns/:campaignId/scene-backups',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      return db.transaction(async q => {
        await requireGm(q, campaignId, userId, 'Удалённые сцены видит мастер.');
        return { backups: await listBackups(q, campaignId) };
      });
    },
  );

  app.post<{ Params: CampaignParams & { backupId: string } }>(
    '/campaigns/:campaignId/scene-backups/:backupId/restore',
    { schema: { params: objectSchema({ campaignId: uuid, backupId: uuid }) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, backupId } = request.params;
      const restored = await db.transaction(async q => {
        await requireGm(q, campaignId, userId, 'Вернуть сцену может мастер.');
        const backup = (
          await q.query('DELETE FROM scene_backups WHERE campaign_id=$1 AND id=$2 RETURNING name, package', [campaignId, backupId])
        ).rows[0];
        if (!backup) reject(404, 'Удалённая сцена не найдена: её уже вернули или она вытеснена более новыми.');
        return createSceneFromPackage(q, campaignId, backup.package as ScenePackage, 'backup', String(backup.name), userId);
      });
      void notifyCampaign(ctx, campaignId, { type: 'changed' });
      return reply.code(201).send(restored);
    },
  );
}
