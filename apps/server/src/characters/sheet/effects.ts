import { removeCondition } from '../../rules/conditions.ts';

import { characterForEditing } from './access.ts';
import { characterParams, type CharacterParams, effectParams, type EffectParams, reject } from './shared.ts';
import type { RouteContext } from '../../system/route-context.ts';

export function registerEffectRoutes(ctx: RouteContext) {
  const { app, auth, db, membership } = ctx;

  app.post<{
    Params: CharacterParams;
    Body: { effectCode: string; parameters?: Record<string, unknown> };
  }>(
    '/campaigns/:campaignId/characters/:characterId/effects',
    {
      schema: {
        params: characterParams,
        body: {
          type: 'object',
          required: ['effectCode'],
          additionalProperties: false,
          properties: {
            effectCode: { type: 'string', minLength: 1, maxLength: 50, pattern: '\\S' },
            parameters: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { effectCode, parameters } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await characterForEditing(ctx, q, campaignId, characterId, userId, member, true);

        const existing = (
          await q.query(
            `SELECT id FROM character_effects
             WHERE campaign_id=$1 AND character_id=$2 AND effect_code=$3 AND active`,
            [campaignId, characterId, effectCode],
          )
        ).rows[0];

        if (existing) return { id: existing.id, alreadyActive: true };

        const inserted = await q.query(
          `INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters)
           VALUES ($1,$2,$3,$4::jsonb)
           RETURNING id`,
          [campaignId, characterId, effectCode, JSON.stringify(parameters ?? {})],
        );

        return { id: inserted.rows[0].id, alreadyActive: false };
      });

      return reply.code(201).send(result);
    },
  );

  app.patch<{
    Params: EffectParams;
    Body: { active?: boolean; parameters?: Record<string, unknown> };
  }>(
    '/campaigns/:campaignId/characters/:characterId/effects/:effectId',
    {
      schema: {
        params: effectParams,
        body: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          properties: {
            active: { type: 'boolean' },
            parameters: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId, effectId } = request.params;
      const { active, parameters } = request.body;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await characterForEditing(ctx, q, campaignId, characterId, userId, member, true);

        const updated = await q.query(
          `UPDATE character_effects SET
             active = COALESCE($1, active),
             parameters = COALESCE($2::jsonb, parameters)
           WHERE campaign_id=$3 AND character_id=$4 AND id=$5
           RETURNING id, effect_code, parameters, active`,
          [
            active ?? null,
            parameters !== undefined ? JSON.stringify(parameters) : null,
            campaignId, characterId, effectId,
          ],
        );

        if (!updated.rows[0]) reject(404, 'Эффект не найден.');

        return updated.rows[0];
      });
    },
  );

  app.delete<{ Params: EffectParams }>(
    '/campaigns/:campaignId/characters/:characterId/effects/:effectId',
    { schema: { params: effectParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId, effectId } = request.params;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await characterForEditing(ctx, q, campaignId, characterId, userId, member, true);

        const effect = (
          await q.query('SELECT effect_code FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND id=$3', [campaignId, characterId, effectId])
        ).rows[0] as { effect_code: string } | undefined;
        if (effect && (effect.effect_code === 'concentration' || effect.effect_code === 'raging' || effect.effect_code === 'wild_shape' || effect.effect_code === 'hasted')) {
          await removeCondition(q, campaignId, characterId, effect.effect_code);
        } else {
          await q.query('DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND id=$3', [campaignId, characterId, effectId]);
        }
      });

      return reply.code(204).send();
    },
  );
}
