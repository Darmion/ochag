import type { Queryable } from '../../db.ts';
import { bumpScene, objectSchema, reject, sceneParams, uuid, type SceneFeatureContext } from '../scene-feature.ts';

export async function canManageNotes(q: Queryable, member: any, userId: string): Promise<boolean> {
  if (member.owner_user_id === userId || member.is_full_gm) return true;

  const { rows } = await q.query(
    `SELECT 1 FROM member_permissions WHERE campaign_id=$1 AND user_id=$2 AND permission='notes.manage'`,
    [member.campaign_id, userId],
  );

  return rows.length > 0;
}

export async function loadPins(q: Queryable, campaignId: string, sceneId: string, member: any, userId: string) {
  const manager = await canManageNotes(q, member, userId);

  return (
    await q.query(
      `SELECT p.id, p.note_id, n.title, p.x, p.z
       FROM scene_pins p
       JOIN campaign_notes n ON n.campaign_id = p.campaign_id AND n.id = p.note_id
       WHERE p.campaign_id=$1 AND p.scene_id=$2
         AND ($3::boolean OR EXISTS (
           SELECT 1 FROM campaign_note_grants g
           WHERE g.campaign_id = p.campaign_id AND g.note_id = p.note_id AND g.user_id = $4
         ))
       ORDER BY p.created_at, p.id`,
      [campaignId, sceneId, manager, userId],
    )
  ).rows;
}

export function registerPinRoutes(ctx: SceneFeatureContext) {
  const { app, db, auth, membership, getScene, notify } = ctx;

  app.post<{ Params: { campaignId: string; sceneId: string }; Body: { noteId: string; x: number; z: number } }>(
    '/campaigns/:campaignId/scenes/:sceneId/pins',
    {
      schema: {
        params: sceneParams,
        body: objectSchema({
          noteId: uuid,
          x: { type: 'number', minimum: -1000, maximum: 1000 },
          z: { type: 'number', minimum: -1000, maximum: 1000 },
        }),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const { noteId, x, z } = request.body;

      const created = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await getScene(q, campaignId, sceneId);

        if (!(await canManageNotes(q, member, userId))) reject(403, 'Прикалывать заметки к карте может мастер.');

        const note = (
          await q.query('SELECT title FROM campaign_notes WHERE campaign_id=$1 AND id=$2', [campaignId, noteId])
        ).rows[0];
        if (!note) reject(404, 'Заметка не найдена в этой кампании.');

        const inserted = await q.query(
          `INSERT INTO scene_pins (campaign_id, scene_id, note_id, x, z, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id, note_id, x, z`,
          [campaignId, sceneId, noteId, x, z, userId],
        );

        await bumpScene(q, sceneId);
        return { ...inserted.rows[0], title: note.title };
      });

      void notify(campaignId, sceneId);
      return reply.code(201).send(created);
    },
  );

  app.delete<{ Params: { campaignId: string; sceneId: string; pinId: string } }>(
    '/campaigns/:campaignId/scenes/:sceneId/pins/:pinId',
    { schema: { params: objectSchema({ campaignId: uuid, sceneId: uuid, pinId: uuid }) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId, pinId } = request.params;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await getScene(q, campaignId, sceneId);

        if (!(await canManageNotes(q, member, userId))) reject(403, 'Снимать булавки может мастер.');

        const removed = await q.query(
          'DELETE FROM scene_pins WHERE campaign_id=$1 AND scene_id=$2 AND id=$3 RETURNING id',
          [campaignId, sceneId, pinId],
        );
        if (!removed.rows[0]) reject(404, 'Булавка не найдена.');

        await bumpScene(q, sceneId);
      });

      void notify(campaignId, sceneId);
      return reply.code(204).send();
    },
  );
}
