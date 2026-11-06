import { requireCharacterAccess } from './access.ts';
import { characterParams, type CharacterParams } from './shared.ts';
import type { RouteContext } from '../../system/route-context.ts';

export const AUTO_REACTIONS = ['shield', 'counterspell', 'hellish-rebuke', 'protection', 'deflect-missiles', 'uncanny-dodge', 'parry', 'riposte', 'cutting-words', 'lucky', 'retaliation'] as const;

export function registerReactionRoutes(ctx: RouteContext) {
  const { app, auth, db, membership } = ctx;

  app.put<{ Params: CharacterParams; Body: { shield?: boolean; counterspell?: boolean; 'hellish-rebuke'?: boolean; protection?: boolean; 'deflect-missiles'?: boolean; 'uncanny-dodge'?: boolean; parry?: boolean; riposte?: boolean; 'cutting-words'?: boolean; lucky?: boolean } }>(
    '/campaigns/:campaignId/characters/:characterId/reactions',
    {
      schema: {
        params: characterParams,
        body: {
          type: 'object', minProperties: 1, additionalProperties: false,
          properties: {
            shield: { type: 'boolean' }, counterspell: { type: 'boolean' }, 'hellish-rebuke': { type: 'boolean' }, protection: { type: 'boolean' },
            'deflect-missiles': { type: 'boolean' }, 'uncanny-dodge': { type: 'boolean' },
            parry: { type: 'boolean' }, riposte: { type: 'boolean' }, 'cutting-words': { type: 'boolean' },
            lucky: { type: 'boolean' },
            retaliation: { type: 'boolean' },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await requireCharacterAccess(ctx, q, campaignId, characterId, userId, member);
        const current = new Set<string>(
          (await q.query('SELECT auto_reactions FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, characterId])).rows[0]?.auto_reactions ?? [],
        );
        for (const key of AUTO_REACTIONS) {
          const value = (request.body as Record<string, boolean | undefined>)[key];
          if (value === true) current.add(key);
          if (value === false) current.delete(key);
        }
        const row = (
          await q.query(
            'UPDATE characters SET auto_reactions=$3::text[] WHERE campaign_id=$1 AND id=$2 RETURNING auto_reactions',
            [campaignId, characterId, AUTO_REACTIONS.filter(key => current.has(key))],
          )
        ).rows[0];
        return { autoReactions: row.auto_reactions };
      });
    },
  );
}
