import { characterAccessLevel, requireCharacterAccess } from './access.ts';
import { characterParams, type CharacterParams, uuid } from './shared.ts';
import { loadVisibleSet } from './visibility.ts';
import type { RouteContext } from '../../system/route-context.ts';

type CharacterSaveParams = CharacterParams & { ability: string };

export const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const;
export const characterSaveParams = {
  type: 'object', required: ['campaignId', 'characterId', 'ability'], additionalProperties: false,
  properties: { campaignId: uuid, characterId: uuid, ability: { type: 'string', enum: [...ABILITIES] } },
};

export function registerSaveRoutes(ctx: RouteContext) {
  const { app, auth, db, membership } = ctx;

  app.get<{ Params: CharacterParams }>(
    '/campaigns/:campaignId/characters/:characterId/saves',
    { schema: { params: characterParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId);
        const privileged = await characterAccessLevel(ctx, q, campaignId, characterId, userId, member);

        const rows = (
          await q.query(
            'SELECT ability, proficient, custom_bonus FROM character_saves WHERE campaign_id=$1 AND character_id=$2',
            [campaignId, characterId],
          )
        ).rows;
        const byAbility = new Map(rows.map(r => [r.ability, r]));
        const hidden = privileged ? null : await loadVisibleSet(q, campaignId, characterId, 'save', userId);

        const saves = ABILITIES.map(ability => {
          const isHidden = hidden?.has(`save:${ability}`) ?? false;
          return {
            ability,
            hidden: isHidden,
            proficient: isHidden ? null : byAbility.get(ability)?.proficient ?? false,
            customBonus: isHidden ? null : byAbility.get(ability)?.custom_bonus ?? 0,
          };
        });

        return { saves };
      });
    },
  );

  app.put<{ Params: CharacterSaveParams; Body: { proficient: boolean; customBonus: number } }>(
    '/campaigns/:campaignId/characters/:characterId/saves/:ability',
    {
      schema: {
        params: characterSaveParams,
        body: {
          type: 'object', required: ['proficient', 'customBonus'], additionalProperties: false,
          properties: { proficient: { type: 'boolean' }, customBonus: { type: 'integer', minimum: -99, maximum: 99 } },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId, ability } = request.params;
      const { proficient, customBonus } = request.body;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await requireCharacterAccess(ctx, q, campaignId, characterId, userId, member);

        const { rows } = await q.query(
          `INSERT INTO character_saves (campaign_id, character_id, ability, proficient, custom_bonus)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (campaign_id, character_id, ability) DO UPDATE SET
             proficient=$4, custom_bonus=$5
           RETURNING ability, proficient, custom_bonus`,
          [campaignId, characterId, ability, proficient, customBonus],
        );

        return { ability: rows[0].ability, proficient: rows[0].proficient, customBonus: rows[0].custom_bonus };
      });
    },
  );
}
