import type {
  FastifyPluginAsync,
  FastifyRequest,
} from 'fastify';

import type { Database, Queryable } from '../db.ts';

type Options = {
  db: Database;

  auth: (request: FastifyRequest) => Promise<string>;

  membership: (
    db: Queryable,
    campaignId: string,
    userId: string,
    lock?: boolean,
  ) => Promise<any>;
};

type CampaignParams = {
  campaignId: string;
};

type NoteParams = CampaignParams & {
  noteId: string;
};

type GrantParams = NoteParams & {
  userId: string;
};

function reject(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

const uuid = { type: 'string', format: 'uuid' };

function objectSchema(properties: Record<string, unknown>) {
  return {
    type: 'object',
    required: Object.keys(properties),
    additionalProperties: false,
    properties,
  };
}

const campaignParams = objectSchema({ campaignId: uuid });
const noteParams = objectSchema({ campaignId: uuid, noteId: uuid });
const grantParams = objectSchema({ campaignId: uuid, noteId: uuid, userId: uuid });

export const noteRoutes: FastifyPluginAsync<Options> =
async (app, options) => {
  const { db, auth, membership } = options;

  async function canManageNotes(q: Queryable, member: any, userId: string): Promise<boolean> {
    if (member.owner_user_id === userId || member.is_full_gm) return true;

    const { rows } = await q.query(
      `SELECT 1 FROM member_permissions
       WHERE campaign_id=$1 AND user_id=$2 AND permission='notes.manage'`,
      [member.campaign_id, userId],
    );

    return rows.length > 0;
  }

  async function canSeeNote(q: Queryable, campaignId: string, noteId: string, userId: string, manager: boolean): Promise<boolean> {
    if (manager) return true;

    const { rows } = await q.query(
      `SELECT 1 FROM campaign_note_grants WHERE campaign_id=$1 AND note_id=$2 AND user_id=$3`,
      [campaignId, noteId, userId],
    );

    return rows.length > 0;
  }

  app.get<{ Params: CampaignParams }>(
    '/campaigns/:campaignId/notes',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const manager = await canManageNotes(q, member, userId);

        if (manager) {
          const notes = (
            await q.query(
              `SELECT id, title, created_by, revision FROM campaign_notes
               WHERE campaign_id=$1
               ORDER BY title, id`,
              [campaignId],
            )
          ).rows;

          const noteIds = notes.map(n => n.id);

          const grantRows = noteIds.length
            ? (
                await q.query(
                  `SELECT g.note_id, g.user_id, u.display_name
                   FROM campaign_note_grants g
                   JOIN users u ON u.id = g.user_id
                   WHERE g.campaign_id=$1 AND g.note_id = ANY($2::uuid[])`,
                  [campaignId, noteIds],
                )
              ).rows
            : [];

          const grantsByNote = new Map<string, Array<{ userId: string; displayName: string }>>();

          for (const grant of grantRows) {
            const list = grantsByNote.get(grant.note_id) ?? [];
            list.push({ userId: grant.user_id, displayName: grant.display_name });
            grantsByNote.set(grant.note_id, list);
          }

          return {
            canManage: true,
            notes: notes.map(n => ({ ...n, grantedUsers: grantsByNote.get(n.id) ?? [] })),
          };
        }

        const notes = (
          await q.query(
            `SELECT n.id, n.title, n.created_by, n.revision
             FROM campaign_notes n
             JOIN campaign_note_grants g
               ON g.campaign_id=n.campaign_id AND g.note_id=n.id
             WHERE n.campaign_id=$1 AND g.user_id=$2
             ORDER BY n.title, n.id`,
            [campaignId, userId],
          )
        ).rows;

        return { canManage: false, notes };
      });
    },
  );

  app.get<{ Params: NoteParams }>(
    '/campaigns/:campaignId/notes/:noteId',
    { schema: { params: noteParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, noteId } = request.params;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const manager = await canManageNotes(q, member, userId);

        if (!(await canSeeNote(q, campaignId, noteId, userId, manager))) {
          reject(403, 'Недостаточно прав для просмотра заметки.');
        }

        const note = (
          await q.query(
            `SELECT id, title, body, created_by, revision FROM campaign_notes
             WHERE campaign_id=$1 AND id=$2`,
            [campaignId, noteId],
          )
        ).rows[0];

        if (!note) reject(404, 'Заметка не найдена.');

        return note;
      });
    },
  );

  app.post<{
    Params: CampaignParams;
    Body: { title: string; body?: string };
  }>(
    '/campaigns/:campaignId/notes',
    {
      schema: {
        params: campaignParams,
        body: {
          type: 'object',
          required: ['title'],
          additionalProperties: false,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
            body: { type: 'string', maxLength: 20000 },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { title, body } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        if (!(await canManageNotes(q, member, userId))) {
          reject(403, 'Создавать заметки может только мастер.');
        }

        const inserted = await q.query(
          `INSERT INTO campaign_notes (campaign_id, created_by, title, body)
           VALUES ($1,$2,$3,$4)
           RETURNING id, title, body, created_by, revision`,
          [campaignId, userId, title.trim(), body ?? ''],
        );

        return inserted.rows[0];
      });

      return reply.code(201).send(result);
    },
  );

  app.patch<{
    Params: NoteParams;
    Body: { title?: string; body?: string; revision: number };
  }>(
    '/campaigns/:campaignId/notes/:noteId',
    {
      schema: {
        params: noteParams,
        body: {
          type: 'object',
          required: ['revision'],
          additionalProperties: false,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
            body: { type: 'string', maxLength: 20000 },
            revision: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, noteId } = request.params;
      const { title, body, revision } = request.body;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        if (!(await canManageNotes(q, member, userId))) {
          reject(403, 'Изменять заметки может только мастер.');
        }

        const note = (
          await q.query(
            `SELECT revision FROM campaign_notes
             WHERE campaign_id=$1 AND id=$2
             FOR UPDATE`,
            [campaignId, noteId],
          )
        ).rows[0];

        if (!note) reject(404, 'Заметка не найдена.');

        if (note.revision !== revision) {
          reject(409, 'Заметка уже изменена другим участником.');
        }

        const updated = await q.query(
          `UPDATE campaign_notes SET
             title = COALESCE($1, title),
             body = COALESCE($2, body),
             revision = revision + 1
           WHERE campaign_id=$3 AND id=$4
           RETURNING id, title, body, created_by, revision`,
          [title?.trim() ?? null, body ?? null, campaignId, noteId],
        );

        return updated.rows[0];
      });
    },
  );

  app.delete<{ Params: NoteParams }>(
    '/campaigns/:campaignId/notes/:noteId',
    { schema: { params: noteParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, noteId } = request.params;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        if (!(await canManageNotes(q, member, userId))) {
          reject(403, 'Удалять заметки может только мастер.');
        }

        await q.query(
          `DELETE FROM campaign_note_grants WHERE campaign_id=$1 AND note_id=$2`,
          [campaignId, noteId],
        );

        await q.query(
          `DELETE FROM scene_pins WHERE campaign_id=$1 AND note_id=$2`,
          [campaignId, noteId],
        );

        await q.query(
          `DELETE FROM campaign_notes WHERE campaign_id=$1 AND id=$2`,
          [campaignId, noteId],
        );
      });

      return reply.code(204).send();
    },
  );

  app.post<{
    Params: NoteParams;
    Body: { username: string };
  }>(
    '/campaigns/:campaignId/notes/:noteId/grants',
    {
      schema: {
        params: noteParams,
        body: objectSchema({
          username: { type: 'string', pattern: '^[a-zA-Z0-9_]{3,32}$' },
        }),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, noteId } = request.params;
      const { username } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        if (!(await canManageNotes(q, member, userId))) {
          reject(403, 'Выдавать доступ к заметкам может только мастер.');
        }

        const note = (
          await q.query(`SELECT id FROM campaign_notes WHERE campaign_id=$1 AND id=$2`, [campaignId, noteId])
        ).rows[0];

        if (!note) reject(404, 'Заметка не найдена.');

        const target = (
          await q.query(
            `SELECT a.user_id, u.display_name
             FROM accounts a
             JOIN users u ON u.id = a.user_id
             JOIN campaign_members m
               ON m.campaign_id=$1 AND m.user_id=a.user_id
             WHERE a.username=$2`,
            [campaignId, username.toLowerCase()],
          )
        ).rows[0];

        if (!target) reject(404, 'Игрок с таким логином не найден в этой кампании. Проверьте логин и то, что игрок уже вступил в кампанию.');

        await q.query(
          `INSERT INTO campaign_note_grants (campaign_id, note_id, user_id, granted_by)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (note_id, user_id) DO NOTHING`,
          [campaignId, noteId, target.user_id, userId],
        );

        return { userId: target.user_id, displayName: target.display_name };
      });

      return reply.code(201).send({ granted: true, ...result });
    },
  );

  app.delete<{ Params: GrantParams }>(
    '/campaigns/:campaignId/notes/:noteId/grants/:userId',
    { schema: { params: grantParams } },
    async (request, reply) => {
      const actor = await auth(request);
      const { campaignId, noteId, userId: targetUserId } = request.params;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, actor, true);

        if (!(await canManageNotes(q, member, actor))) {
          reject(403, 'Отзывать доступ к заметкам может только мастер.');
        }

        await q.query(
          `DELETE FROM campaign_note_grants
           WHERE campaign_id=$1 AND note_id=$2 AND user_id=$3`,
          [campaignId, noteId, targetUserId],
        );
      });

      return reply.code(204).send();
    },
  );
};
