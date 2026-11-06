import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { buildRecap, type ChronicleFacts } from '../../../../packages/domain/world/chronicle.ts';
import { clockText } from '../../../../packages/domain/world/clock.ts';

const COLUMNS = 'id, title, body, started_at, ended_at, published, revision';

export function registerChronicleRoutes(ctx: SceneFeatureContext) {
  const { app, db, auth, membership, canManage, notifyCampaign } = ctx;
  const campaignParams = objectSchema({ campaignId: uuid });
  const entryParams = objectSchema({ campaignId: uuid, entryId: uuid });

  async function assertManager(q: Queryable, campaignId: string, userId: string) {
    const member = await membership(q, campaignId, userId, true);
    if (!(await canManage(q, member, userId))) reject(403, 'Хронику ведёт мастер.');
  }

  function showRecap(campaignId: string, entry: any) {
    void notifyCampaign(campaignId, { type: 'handout', handout: { id: `chronicle-${entry.id}`, title: `В прошлый раз: ${entry.title}`, body: entry.body, assetId: null } });
  }

  async function factsSince(q: Queryable, campaignId: string, from: Date, startMinutes: number | null): Promise<ChronicleFacts> {
    const fights = (
      await q.query(
        `SELECT r.summary, s.name AS scene_name FROM combat_records r JOIN scenes s ON s.campaign_id=r.campaign_id AND s.id=r.scene_id
         WHERE r.campaign_id=$1 AND r.ended_at >= $2 ORDER BY r.ended_at`,
        [campaignId, from],
      )
    ).rows.map(row => ({
      sceneName: row.scene_name as string,
      rounds: Number(row.summary.rounds ?? 1),
      participants: (row.summary.participants ?? []).map((entry: any) => ({
        name: String(entry.name), side: String(entry.side ?? ''), damageDealt: Number(entry.damageDealt ?? 0),
        kills: Number(entry.kills ?? 0), crits: Number(entry.crits ?? 0), experience: entry.experience === null || entry.experience === undefined ? null : Number(entry.experience),
      })),
    }));
    const quests = (
      await q.query(
        `SELECT title, status FROM campaign_quests WHERE campaign_id=$1 AND updated_at >= $2 AND status IN ('completed', 'failed') ORDER BY updated_at`,
        [campaignId, from],
      )
    ).rows as ChronicleFacts['quests'];
    const rolls = (
      await q.query(
        `SELECT r.formula, r.dice_results, r.outcome, c.name FROM roll_log r JOIN characters c ON c.campaign_id=r.campaign_id AND c.id=r.character_id
         WHERE r.campaign_id=$1 AND r.created_at >= $2 AND NOT r.hidden AND r.outcome->>'kind' = 'attack' ORDER BY r.created_at`,
        [campaignId, from],
      )
    ).rows;
    const highlights: ChronicleFacts['highlights'] = [];
    for (const roll of rolls) {
      const target = roll.outcome?.target?.name ?? null;
      if (roll.outcome?.critical && roll.outcome?.hit) highlights.push({ name: roll.name, kind: 'crit', target });
      else if (/^(?:1d20|2d20)/.test(roll.formula) && Array.isArray(roll.dice_results) && roll.dice_results.length === 1 && roll.dice_results[0] === 1) {
        highlights.push({ name: roll.name, kind: 'fumble', target });
      }
    }
    const handouts = (
      await q.query('SELECT title FROM handouts WHERE campaign_id=$1 AND created_at >= $2 ORDER BY created_at', [campaignId, from])
    ).rows.map(row => row.title as string);
    const now = (await q.query('SELECT world_minutes FROM campaigns WHERE id=$1', [campaignId])).rows[0];
    return {
      date: new Date(), fights, quests, highlights, handouts,
      clockFrom: startMinutes === null ? null : clockText(startMinutes),
      clockTo: now ? clockText(Number(now.world_minutes)) : null,
    };
  }

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/chronicle',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const member = await membership(db, campaignId, userId);
      const manager = await canManage(db, member, userId);
      const entries = (
        await db.query(`SELECT ${COLUMNS} FROM chronicle_entries WHERE campaign_id=$1 AND ($2 OR published) ORDER BY ended_at DESC`, [campaignId, manager])
      ).rows;
      const session = (await db.query('SELECT session_started_at FROM campaigns WHERE id=$1', [campaignId])).rows[0];
      return { canManage: manager, sessionStartedAt: manager ? session?.session_started_at ?? null : null, entries };
    },
  );

  app.post<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/session/start',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const previous = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        await q.query('UPDATE campaigns SET session_started_at=now(), session_start_minutes=world_minutes WHERE id=$1', [campaignId]);
        return (
          await q.query(`SELECT ${COLUMNS} FROM chronicle_entries WHERE campaign_id=$1 AND published ORDER BY ended_at DESC LIMIT 1`, [campaignId])
        ).rows[0] ?? null;
      });
      if (previous) showRecap(campaignId, previous);
      return { started: true, previous };
    },
  );

  app.post<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/session/end',
    { schema: { params: campaignParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const entry = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const session = (await q.query('SELECT session_started_at, session_start_minutes FROM campaigns WHERE id=$1 FOR UPDATE', [campaignId])).rows[0];
        const last = (await q.query('SELECT max(ended_at) AS at FROM chronicle_entries WHERE campaign_id=$1', [campaignId])).rows[0]?.at;
        const from = session?.session_started_at ? new Date(session.session_started_at) : last ? new Date(last) : new Date(Date.now() - 24 * 3600 * 1000);
        const recap = buildRecap(await factsSince(q, campaignId, from, session?.session_start_minutes ?? null));
        await q.query('UPDATE campaigns SET session_started_at=NULL, session_start_minutes=NULL WHERE id=$1', [campaignId]);
        return (
          await q.query(
            `INSERT INTO chronicle_entries (campaign_id, title, body, started_at, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING ${COLUMNS}`,
            [campaignId, recap.title, recap.body, from, userId],
          )
        ).rows[0];
      });
      return reply.code(201).send({ entry });
    },
  );

  app.patch<{ Params: { campaignId: string; entryId: string }; Body: { title?: string; body?: string; published?: boolean; revision: number } }>(
    '/campaigns/:campaignId/chronicle/:entryId',
    {
      schema: {
        params: entryParams,
        body: {
          type: 'object', additionalProperties: false, required: ['revision'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 160, pattern: '\\S' },
            body: { type: 'string', maxLength: 20000 },
            published: { type: 'boolean' },
            revision: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, entryId } = request.params;
      const { title, body, published, revision } = request.body;
      const entry = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const current = (await q.query('SELECT revision FROM chronicle_entries WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, entryId])).rows[0];
        if (!current) reject(404, 'Записи нет.');
        if (current.revision !== revision) reject(409, 'Запись уже изменена — перечитайте её.');
        return (
          await q.query(
            `UPDATE chronicle_entries SET title=COALESCE($3, title), body=COALESCE($4, body), published=COALESCE($5, published), revision=revision+1
             WHERE campaign_id=$1 AND id=$2 RETURNING ${COLUMNS}`,
            [campaignId, entryId, title?.trim() ?? null, body ?? null, published ?? null],
          )
        ).rows[0];
      });
      return { entry };
    },
  );

  app.post<{ Params: { campaignId: string; entryId: string } }>(
    '/campaigns/:campaignId/chronicle/:entryId/show',
    { schema: { params: entryParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, entryId } = request.params;
      const entry = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const row = (await q.query(`SELECT ${COLUMNS} FROM chronicle_entries WHERE campaign_id=$1 AND id=$2`, [campaignId, entryId])).rows[0];
        if (!row) reject(404, 'Записи нет.');
        if (!row.published) await q.query('UPDATE chronicle_entries SET published=true, revision=revision+1 WHERE id=$1', [entryId]);
        return row;
      });
      showRecap(campaignId, entry);
      return { shown: true };
    },
  );

  app.delete<{ Params: { campaignId: string; entryId: string } }>(
    '/campaigns/:campaignId/chronicle/:entryId',
    { schema: { params: entryParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, entryId } = request.params;
      await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const deleted = await q.query('DELETE FROM chronicle_entries WHERE campaign_id=$1 AND id=$2 RETURNING id', [campaignId, entryId]);
        if (!deleted.rows[0]) reject(404, 'Записи нет.');
      });
      return reply.code(204).send();
    },
  );
}
