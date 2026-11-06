import { characterForEditing } from './access.ts';
import { characterParams, type CharacterParams, reject, resourceParams, type ResourceParams } from './shared.ts';
import type { RouteContext } from '../../system/route-context.ts';

export function registerResourceRoutes(ctx: RouteContext) {
  const { app, auth, db, membership } = ctx;

  app.post<{
    Params: CharacterParams;
    Body: { name: string; current: number; max: number; recharge?: 'none' | 'short' | 'long' };
  }>(
    '/campaigns/:campaignId/characters/:characterId/resources',
    {
      schema: {
        params: characterParams,
        body: {
          type: 'object',
          required: ['name', 'current', 'max'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
            current: { type: 'integer', minimum: 0 },
            max: { type: 'integer', minimum: 0 },
            recharge: { type: 'string', enum: ['none', 'short', 'long'] },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { name, current, max, recharge } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await characterForEditing(ctx, q, campaignId, characterId, userId, member, true);

        const inserted = await q.query(
          `INSERT INTO character_resources (campaign_id, character_id, name, current, max, recharge)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id, name, current, max, recharge`,
          [campaignId, characterId, name.trim(), current, max, recharge ?? 'none'],
        );

        return inserted.rows[0];
      });

      return reply.code(201).send(result);
    },
  );

  app.patch<{
    Params: ResourceParams;
    Body: { name?: string; current?: number; max?: number; recharge?: 'none' | 'short' | 'long' };
  }>(
    '/campaigns/:campaignId/characters/:characterId/resources/:resourceId',
    {
      schema: {
        params: resourceParams,
        body: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
            current: { type: 'integer', minimum: 0 },
            max: { type: 'integer', minimum: 0 },
            recharge: { type: 'string', enum: ['none', 'short', 'long'] },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId, resourceId } = request.params;
      const { name, current, max, recharge } = request.body;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await characterForEditing(ctx, q, campaignId, characterId, userId, member, true);

        const updated = await q.query(
          `UPDATE character_resources SET
             name = COALESCE($1, name),
             current = COALESCE($2, current),
             max = COALESCE($3, max),
             recharge = COALESCE($7, recharge)
           WHERE campaign_id=$4 AND character_id=$5 AND id=$6
           RETURNING id, name, current, max, recharge`,
          [name?.trim() ?? null, current ?? null, max ?? null, campaignId, characterId, resourceId, recharge ?? null],
        );

        if (!updated.rows[0]) reject(404, 'Ресурс не найден.');

        return updated.rows[0];
      });
    },
  );

  app.delete<{ Params: ResourceParams }>(
    '/campaigns/:campaignId/characters/:characterId/resources/:resourceId',
    { schema: { params: resourceParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId, resourceId } = request.params;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await characterForEditing(ctx, q, campaignId, characterId, userId, member, true);

        await q.query(
          `DELETE FROM character_resources
           WHERE campaign_id=$1 AND character_id=$2 AND id=$3`,
          [campaignId, characterId, resourceId],
        );
      });

      return reply.code(204).send();
    },
  );
}
