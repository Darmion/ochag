import type { Queryable } from '../../db.ts';
import { bumpScene, objectSchema, reject, sceneParams, uuid, type SceneFeatureContext } from '../scene-feature.ts';

type CounterParams = { campaignId: string; sceneId: string; counterId: string };

const MAX_COUNTERS = 30;
const VALUE_LIMIT = 9999;

const value = { type: 'integer', minimum: -VALUE_LIMIT, maximum: VALUE_LIMIT };
const name = { type: 'string', minLength: 1, maxLength: 60, pattern: '\\S' };

export async function loadCounters(q: Queryable, campaignId: string, sceneId: string, userId: string, manager: boolean) {
  return (
    await q.query(
      `SELECT c.id, c.name, c.kind, c.value, c.hidden, c.revision, c.created_by,
              u.display_name AS author_name,
              ($4::boolean OR c.created_by=$3) AS can_edit
       FROM scene_counters c
       JOIN users u ON u.id = c.created_by
       WHERE c.campaign_id=$1 AND c.scene_id=$2 AND (NOT c.hidden OR $4::boolean OR c.created_by=$3)
       ORDER BY c.created_at, c.id`,
      [campaignId, sceneId, userId, manager],
    )
  ).rows;
}

export async function tickRoundTimers(q: Queryable, campaignId: string, sceneId: string) {
  const ticked = await q.query(
    `UPDATE scene_counters SET value=value-1, revision=revision+1
     WHERE campaign_id=$1 AND scene_id=$2 AND kind='rounds' AND value > 0
     RETURNING id`,
    [campaignId, sceneId],
  );
  return ticked.rows.length > 0;
}

export function registerCounterRoutes(ctx: SceneFeatureContext) {
  const { app, db, auth, membership, canManage, getScene, notify } = ctx;

  async function loadEditable(q: Queryable, params: CounterParams, userId: string) {
    const member = await membership(q, params.campaignId, userId, true);
    await getScene(q, params.campaignId, params.sceneId);

    const counter = (
      await q.query(
        `SELECT id, kind, value, hidden, created_by FROM scene_counters
         WHERE campaign_id=$1 AND scene_id=$2 AND id=$3 FOR UPDATE`,
        [params.campaignId, params.sceneId, params.counterId],
      )
    ).rows[0];

    const manager = await canManage(q, member, userId);
    if (!counter || (counter.hidden && !manager && counter.created_by !== userId)) reject(404, 'Счётчик не найден.');
    if (!manager && counter.created_by !== userId) reject(403, 'Менять счётчик может его автор или мастер.');

    return counter;
  }

  app.post<{
    Params: { campaignId: string; sceneId: string };
    Body: { name: string; kind: 'counter' | 'rounds'; value: number; hidden?: boolean };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId/counters',
    {
      schema: {
        params: sceneParams,
        body: objectSchema(
          { name, kind: { type: 'string', enum: ['counter', 'rounds'] }, value, hidden: { type: 'boolean' } },
          ['name', 'kind', 'value'],
        ),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const body = request.body;

      if (body.kind === 'rounds' && body.value < 1) reject(400, 'Таймер — хотя бы на один раунд.');

      const created = await db.transaction(async q => {
        await membership(q, campaignId, userId, true);
        await getScene(q, campaignId, sceneId, true);

        const count = (
          await q.query('SELECT count(*)::int AS n FROM scene_counters WHERE campaign_id=$1 AND scene_id=$2', [campaignId, sceneId])
        ).rows[0].n as number;
        if (count >= MAX_COUNTERS) reject(400, `На сцене уже ${MAX_COUNTERS} счётчиков — уберите ненужные.`);

        const inserted = (
          await q.query(
            `INSERT INTO scene_counters (campaign_id, scene_id, name, kind, value, hidden, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING id, name, kind, value, hidden, revision, created_by`,
            [campaignId, sceneId, body.name.trim(), body.kind, body.value, body.hidden ?? false, userId],
          )
        ).rows[0];

        await bumpScene(q, sceneId);
        return inserted;
      });

      void notify(campaignId, sceneId);
      return reply.code(201).send(created);
    },
  );

  app.patch<{
    Params: CounterParams;
    Body: { delta?: number; value?: number; name?: string; hidden?: boolean };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId/counters/:counterId',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, sceneId: uuid, counterId: uuid }),
        body: {
          ...objectSchema(
            { delta: { type: 'integer', minimum: -100, maximum: 100 }, value, name, hidden: { type: 'boolean' } },
            [],
          ),
          minProperties: 1,
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const params = request.params;
      const body = request.body;

      if (body.delta !== undefined && body.value !== undefined) reject(400, 'Либо delta, либо value — не оба сразу.');

      const updated = await db.transaction(async q => {
        const counter = await loadEditable(q, params, userId);

        let next = body.value ?? counter.value + (body.delta ?? 0);
        next = Math.max(-VALUE_LIMIT, Math.min(VALUE_LIMIT, next));
        if (counter.kind === 'rounds') next = Math.max(0, next);

        const row = (
          await q.query(
            `UPDATE scene_counters
             SET value=$4,
                 name=COALESCE($5, name),
                 hidden=COALESCE($6, hidden),
                 revision=revision+1
             WHERE campaign_id=$1 AND scene_id=$2 AND id=$3
             RETURNING id, name, kind, value, hidden, revision, created_by`,
            [params.campaignId, params.sceneId, params.counterId, next, body.name?.trim() ?? null, body.hidden ?? null],
          )
        ).rows[0];

        await bumpScene(q, params.sceneId);
        return row;
      });

      void notify(params.campaignId, params.sceneId);
      return reply.send(updated);
    },
  );

  app.delete<{ Params: CounterParams }>(
    '/campaigns/:campaignId/scenes/:sceneId/counters/:counterId',
    { schema: { params: objectSchema({ campaignId: uuid, sceneId: uuid, counterId: uuid }) } },
    async (request, reply) => {
      const userId = await auth(request);
      const params = request.params;

      await db.transaction(async q => {
        await loadEditable(q, params, userId);
        await q.query('DELETE FROM scene_counters WHERE id=$1', [params.counterId]);
        await bumpScene(q, params.sceneId);
      });

      void notify(params.campaignId, params.sceneId);
      return reply.code(204).send();
    },
  );
}
