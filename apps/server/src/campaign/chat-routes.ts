import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';

export type ChatContext = SceneFeatureContext & {
  canActAs: (q: Queryable, member: any, userId: string, characterId: string) => Promise<boolean>;
};

const COLUMNS = `m.id, m.user_id, u.display_name AS user_name, m.character_id, c.name AS character_name,
  m.to_user_id, t.display_name AS to_user_name, m.in_character, m.body, m.created_at`;
const JOINS = `FROM chat_messages m
  JOIN users u ON u.id = m.user_id
  LEFT JOIN users t ON t.id = m.to_user_id
  LEFT JOIN characters c ON c.campaign_id = m.campaign_id AND c.id = m.character_id`;

export async function insertChatMessage(
  q: Queryable, campaignId: string, userId: string,
  message: { characterId: string | null; body: string; inCharacter?: boolean },
) {
  const inserted = (
    await q.query(
      `INSERT INTO chat_messages (campaign_id, user_id, character_id, to_user_id, in_character, body)
       VALUES ($1,$2,$3,NULL,$4,$5) RETURNING id`,
      [campaignId, userId, message.characterId, message.inCharacter === true, message.body.slice(0, 1000)],
    )
  ).rows[0];
  return (await q.query(`SELECT ${COLUMNS} ${JOINS} WHERE m.campaign_id=$1 AND m.id=$2`, [campaignId, inserted.id])).rows[0];
}

export function registerChatRoutes(ctx: ChatContext) {
  const { app, db, auth, membership, canManage, notifyCampaign, notifyUsers, canActAs } = ctx;
  const campaignParams = objectSchema({ campaignId: uuid });

  app.get<{ Params: { campaignId: string }; Querystring: { before?: string } }>(
    '/campaigns/:campaignId/chat',
    {
      schema: {
        params: campaignParams,
        querystring: { type: 'object', additionalProperties: false, properties: { before: { type: 'string', format: 'date-time' } } },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      await membership(db, campaignId, userId);
      const rows = (
        await db.query(
          `SELECT ${COLUMNS} ${JOINS}
           WHERE m.campaign_id=$1 AND (m.to_user_id IS NULL OR m.user_id=$2 OR m.to_user_id=$2)
             AND ($3::timestamptz IS NULL OR m.created_at < $3)
           ORDER BY m.created_at DESC LIMIT 100`,
          [campaignId, userId, request.query.before ?? null],
        )
      ).rows;
      return { messages: rows.reverse() };
    },
  );

  app.post<{ Params: { campaignId: string }; Body: { body: string; characterId?: string; inCharacter?: boolean; toUserId?: string } }>(
    '/campaigns/:campaignId/chat',
    {
      schema: {
        params: campaignParams,
        body: {
          type: 'object', additionalProperties: false, required: ['body'],
          properties: {
            body: { type: 'string', minLength: 1, maxLength: 1000, pattern: '\\S' },
            characterId: uuid, inCharacter: { type: 'boolean' }, toUserId: uuid,
          },
        },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { body, characterId, inCharacter, toUserId } = request.body;
      if (inCharacter && !characterId) reject(400, 'В роли говорит персонаж — выберите его.');

      const message = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId);
        if (characterId && !(await canActAs(q, member, userId, characterId))) reject(403, 'Говорить можно от своего персонажа.');
        if (toUserId) {
          if (toUserId === userId) reject(400, 'Шептать самому себе незачем.');
          const recipient = (await q.query('SELECT 1 FROM campaign_members WHERE campaign_id=$1 AND user_id=$2', [campaignId, toUserId])).rows[0];
          if (!recipient) reject(400, 'Шептать можно только участнику этой кампании.');
        }
        const inserted = (
          await q.query(
            `INSERT INTO chat_messages (campaign_id, user_id, character_id, to_user_id, in_character, body)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [campaignId, userId, characterId ?? null, toUserId ?? null, inCharacter === true, body.trim()],
          )
        ).rows[0];
        return (await q.query(`SELECT ${COLUMNS} ${JOINS} WHERE m.campaign_id=$1 AND m.id=$2`, [campaignId, inserted.id])).rows[0];
      });

      if (message.to_user_id) void notifyUsers?.(campaignId, [userId, message.to_user_id], { type: 'chat', message });
      else void notifyCampaign(campaignId, { type: 'chat', message });
      return reply.code(201).send({ message });
    },
  );

  app.delete<{ Params: { campaignId: string; messageId: string } }>(
    '/campaigns/:campaignId/chat/:messageId',
    { schema: { params: objectSchema({ campaignId: uuid, messageId: uuid }) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, messageId } = request.params;
      const removed = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const row = (await q.query('SELECT user_id, to_user_id FROM chat_messages WHERE campaign_id=$1 AND id=$2', [campaignId, messageId])).rows[0];
        if (!row) reject(404, 'Сообщения нет.');
        if (row.user_id !== userId && !(await canManage(q, member, userId))) reject(403, 'Убрать сообщение может автор или мастер.');
        await q.query('DELETE FROM chat_messages WHERE campaign_id=$1 AND id=$2', [campaignId, messageId]);
        return row;
      });
      const event = { type: 'chatRemoved', messageId };
      if (removed.to_user_id) void notifyUsers?.(campaignId, [removed.user_id, removed.to_user_id], event);
      else void notifyCampaign(campaignId, event);
      return reply.code(204).send();
    },
  );
}
