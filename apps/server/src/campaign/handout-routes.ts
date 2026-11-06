import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';

type HandoutBody = { title: string; body?: string | null; assetId?: string | null; userIds?: string[] };

export function registerHandoutRoutes(ctx: SceneFeatureContext) {
  const { app, db, auth, membership, canManage, notifyUsers } = ctx;
  const campaignParams = objectSchema({ campaignId: uuid });
  const handoutParams = objectSchema({ campaignId: uuid, handoutId: uuid });
  const recipients = { type: 'array', items: uuid, minItems: 1, maxItems: 100, uniqueItems: true };

  async function assertManager(q: Queryable, campaignId: string, userId: string) {
    const member = await membership(q, campaignId, userId, true);
    if (!(await canManage(q, member, userId))) reject(403, 'Материалы показывает мастер.');
  }

  async function audience(q: Queryable, campaignId: string, userId: string, userIds?: string[]) {
    const members = (await q.query('SELECT user_id FROM campaign_members WHERE campaign_id=$1', [campaignId])).rows.map(row => row.user_id as string);
    if (userIds) {
      const outsider = userIds.find(id => !members.includes(id));
      if (outsider) reject(400, 'Показывать можно только участникам этой кампании.');
      return userIds;
    }
    return members.filter(id => id !== userId);
  }

  async function show(q: Queryable, campaignId: string, handoutId: string, userIds: string[]) {
    for (const userId of userIds) {
      await q.query(
        `INSERT INTO handout_recipients (campaign_id, handout_id, user_id) VALUES ($1,$2,$3)
         ON CONFLICT (handout_id, user_id) DO UPDATE SET shown_at=now()`,
        [campaignId, handoutId, userId],
      );
    }
  }

  async function view(q: Queryable, campaignId: string, handoutId: string) {
    const row = (
      await q.query('SELECT id, title, body, asset_id, created_at FROM handouts WHERE campaign_id=$1 AND id=$2', [campaignId, handoutId])
    ).rows[0];
    if (!row) reject(404, 'Материала нет.');
    return row;
  }

  function announce(campaignId: string, handout: any, userIds: string[], senderId: string) {
    void notifyUsers?.(campaignId, [...userIds, senderId], {
      type: 'handout', handout: { id: handout.id, title: handout.title, body: handout.body, assetId: handout.asset_id },
    });
  }

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/handouts',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const member = await membership(db, campaignId, userId);
      const manager = await canManage(db, member, userId);
      if (manager) {
        const handouts = (
          await db.query(
            `SELECT h.id, h.title, h.body, h.asset_id, h.created_at,
                    COALESCE(json_agg(json_build_object('userId', r.user_id, 'shownAt', r.shown_at)) FILTER (WHERE r.user_id IS NOT NULL), '[]') AS recipients
             FROM handouts h LEFT JOIN handout_recipients r ON r.handout_id = h.id
             WHERE h.campaign_id=$1 GROUP BY h.id ORDER BY h.created_at DESC`,
            [campaignId],
          )
        ).rows;
        return { canManage: true, handouts };
      }
      const handouts = (
        await db.query(
          `SELECT h.id, h.title, h.body, h.asset_id, h.created_at, r.shown_at
           FROM handouts h JOIN handout_recipients r ON r.handout_id = h.id AND r.user_id = $2
           WHERE h.campaign_id=$1 ORDER BY r.shown_at DESC`,
          [campaignId, userId],
        )
      ).rows;
      return { canManage: false, handouts };
    },
  );

  app.post<{ Params: { campaignId: string }; Body: HandoutBody }>(
    '/campaigns/:campaignId/handouts',
    {
      schema: {
        params: campaignParams,
        body: {
          type: 'object', additionalProperties: false, required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
            body: { oneOf: [{ type: 'string', maxLength: 20000 }, { type: 'null' }] },
            assetId: { oneOf: [uuid, { type: 'null' }] },
            userIds: recipients,
          },
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { title, body, assetId, userIds } = request.body;
      const text = body?.trim() || null;
      if (!text && !assetId) reject(400, 'Нужен текст или картинка.');

      const result = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        if (assetId) {
          const asset = (
            await q.query(`SELECT 1 FROM assets WHERE campaign_id=$1 AND id=$2 AND kind IN ('object_image', 'scene_background')`, [campaignId, assetId])
          ).rows[0];
          if (!asset) reject(400, 'Картинка — изображение этой кампании.');
        }
        const to = await audience(q, campaignId, userId, userIds);
        const created = (
          await q.query(
            'INSERT INTO handouts (campaign_id, title, body, asset_id, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
            [campaignId, title.trim(), text, assetId ?? null, userId],
          )
        ).rows[0];
        await show(q, campaignId, created.id, to);
        return { handout: await view(q, campaignId, created.id), to };
      });

      announce(campaignId, result.handout, result.to, userId);
      return reply.code(201).send({ handout: result.handout, shownTo: result.to });
    },
  );

  app.post<{ Params: { campaignId: string; handoutId: string }; Body: { userIds?: string[] } }>(
    '/campaigns/:campaignId/handouts/:handoutId/show',
    {
      schema: {
        params: handoutParams,
        body: { type: 'object', additionalProperties: false, properties: { userIds: recipients } },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, handoutId } = request.params;
      const result = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const handout = await view(q, campaignId, handoutId);
        const to = await audience(q, campaignId, userId, request.body?.userIds);
        await show(q, campaignId, handoutId, to);
        return { handout, to };
      });
      announce(campaignId, result.handout, result.to, userId);
      return { shownTo: result.to };
    },
  );

  app.delete<{ Params: { campaignId: string; handoutId: string } }>(
    '/campaigns/:campaignId/handouts/:handoutId',
    { schema: { params: handoutParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, handoutId } = request.params;
      await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const deleted = await q.query('DELETE FROM handouts WHERE campaign_id=$1 AND id=$2 RETURNING id', [campaignId, handoutId]);
        if (!deleted.rows[0]) reject(404, 'Материала нет.');
      });
      return reply.code(204).send();
    },
  );
}
