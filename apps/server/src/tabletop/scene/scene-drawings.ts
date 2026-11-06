import type { Queryable } from '../../db.ts';
import { bumpScene, objectSchema, reject, sceneParams, uuid, type SceneFeatureContext } from '../scene-feature.ts';

type DrawingParams = { campaignId: string; sceneId: string; drawingId: string };

type DrawingBody = {
  kind: 'path' | 'text';
  layer?: 'all' | 'gm';
  color: string;
  width?: number;
  points: number[][];
  text?: string;
};

const MAX_PATH_POINTS = 2000;
const COORDINATE_LIMIT = 1000;

const point = {
  type: 'array',
  minItems: 2,
  maxItems: 2,
  items: { type: 'number', minimum: -COORDINATE_LIMIT, maximum: COORDINATE_LIMIT },
};

export async function loadDrawings(q: Queryable, campaignId: string, sceneId: string, manager: boolean) {
  return (
    await q.query(
      `SELECT d.id, d.kind, d.layer, d.color, d.width::float8 AS width, d.points, d.text,
              d.created_by, u.display_name AS author_name, d.created_at
       FROM scene_drawings d
       JOIN users u ON u.id = d.created_by
       WHERE d.campaign_id=$1 AND d.scene_id=$2 AND ($3::boolean OR d.layer='all')
       ORDER BY d.created_at, d.id`,
      [campaignId, sceneId, manager],
    )
  ).rows;
}

export function registerDrawingRoutes(ctx: SceneFeatureContext) {
  const { app, db, auth, membership, canManage, getScene, notify } = ctx;

  app.post<{ Params: { campaignId: string; sceneId: string }; Body: DrawingBody }>(
    '/campaigns/:campaignId/scenes/:sceneId/drawings',
    {
      schema: {
        params: sceneParams,
        body: objectSchema({
          kind: { type: 'string', enum: ['path', 'text'] },
          layer: { type: 'string', enum: ['all', 'gm'] },
          color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          width: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
          points: { type: 'array', minItems: 1, maxItems: MAX_PATH_POINTS, items: point },
          text: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
        }, ['kind', 'color', 'points']),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const body = request.body;
      const layer = body.layer ?? 'all';

      if (body.kind === 'path' && body.points.length < 2) reject(400, 'У линии должно быть хотя бы две точки.');
      if (body.kind === 'text' && body.points.length !== 1) reject(400, 'У подписи одна точка — где она стоит.');
      if (body.kind === 'text' && !body.text) reject(400, 'Подпись без текста.');
      if (body.kind === 'path' && body.text) reject(400, 'Текст бывает только у подписи.');

      const created = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await getScene(q, campaignId, sceneId);

        if (layer === 'gm' && !(await canManage(q, member, userId))) {
          reject(403, 'Слой «только мастер» доступен мастеру сцены.');
        }

        const inserted = await q.query(
          `INSERT INTO scene_drawings (campaign_id, scene_id, kind, layer, color, width, points, text, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
           RETURNING id, kind, layer, color, width::float8 AS width, points, text, created_by, created_at`,
          [
            campaignId, sceneId, body.kind, layer, body.color.toLowerCase(), body.width ?? 0.08,
            JSON.stringify(body.points), body.kind === 'text' ? body.text!.trim() : null, userId,
          ],
        );

        await bumpScene(q, sceneId);
        return inserted.rows[0];
      });

      void notify(campaignId, sceneId);
      return reply.code(201).send(created);
    },
  );

  for (const scope of ['mine', 'all'] as const) {
    app.delete<{ Params: { campaignId: string; sceneId: string } }>(
      `/campaigns/:campaignId/scenes/:sceneId/drawings/${scope}`,
      { schema: { params: sceneParams } },
      async request => {
        const userId = await auth(request);
        const { campaignId, sceneId } = request.params;

        const removed = await db.transaction(async q => {
          const member = await membership(q, campaignId, userId, true);
          await getScene(q, campaignId, sceneId);

          if (scope === 'all' && !(await canManage(q, member, userId))) {
            reject(403, 'Стереть все рисунки сцены может мастер.');
          }

          const result = await q.query(
            `DELETE FROM scene_drawings
             WHERE campaign_id=$1 AND scene_id=$2 AND ($3::boolean OR created_by=$4)
             RETURNING id`,
            [campaignId, sceneId, scope === 'all', userId],
          );

          if (result.rows.length) await bumpScene(q, sceneId);
          return result.rows.length;
        });

        if (removed) void notify(campaignId, sceneId);
        return { removed };
      },
    );
  }

  app.patch<{ Params: DrawingParams; Body: { text?: string; color?: string; point?: number[] } }>(
    '/campaigns/:campaignId/scenes/:sceneId/drawings/:drawingId',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, sceneId: uuid, drawingId: uuid }),
        body: {
          type: 'object', additionalProperties: false, minProperties: 1,
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
            color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
            point,
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId, drawingId } = request.params;
      const { text, color, point: place } = request.body;

      const updated = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await getScene(q, campaignId, sceneId);
        const manager = await canManage(q, member, userId);
        const drawing = (
          await q.query('SELECT kind, created_by, layer FROM scene_drawings WHERE campaign_id=$1 AND scene_id=$2 AND id=$3', [campaignId, sceneId, drawingId])
        ).rows[0];
        if (!drawing || (drawing.layer === 'gm' && !manager)) reject(404, 'Подпись не найдена.');
        if (drawing.kind !== 'text') reject(400, 'Изменить можно подпись; линию — стереть и нарисовать заново.');
        if (drawing.created_by !== userId && !manager) reject(403, 'Изменить чужую подпись может только мастер.');
        const row = (
          await q.query(
            `UPDATE scene_drawings SET
               text = COALESCE($2, text),
               color = COALESCE($3, color),
               points = COALESCE($4::jsonb, points)
             WHERE id=$1
             RETURNING id, kind, layer, color, width::float8 AS width, points, text, created_by, created_at`,
            [drawingId, text?.trim() ?? null, color?.toLowerCase() ?? null, place ? JSON.stringify([place]) : null],
          )
        ).rows[0];
        await bumpScene(q, sceneId);
        return row;
      });

      void notify(campaignId, sceneId);
      return updated;
    },
  );

  app.delete<{ Params: DrawingParams }>(
    '/campaigns/:campaignId/scenes/:sceneId/drawings/:drawingId',
    { schema: { params: objectSchema({ campaignId: uuid, sceneId: uuid, drawingId: uuid }) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId, drawingId } = request.params;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await getScene(q, campaignId, sceneId);
        const manager = await canManage(q, member, userId);

        // No FOR UPDATE: the app role has no UPDATE right on drawings, so Postgres refuses the lock; two racing deletes are harmless.
        const drawing = (
          await q.query(
            `SELECT created_by, layer FROM scene_drawings
             WHERE campaign_id=$1 AND scene_id=$2 AND id=$3`,
            [campaignId, sceneId, drawingId],
          )
        ).rows[0];

        if (!drawing || (drawing.layer === 'gm' && !manager)) reject(404, 'Рисунок не найден.');
        if (drawing.created_by !== userId && !manager) reject(403, 'Стереть чужой рисунок может только мастер.');

        await q.query('DELETE FROM scene_drawings WHERE id=$1', [drawingId]);
        await bumpScene(q, sceneId);
      });

      void notify(campaignId, sceneId);
      return reply.code(204).send();
    },
  );
}
