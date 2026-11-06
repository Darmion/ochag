import { applyClassSlots } from '../characters/class-slots.ts';

import { characterAccessLevel, requireCharacterAccess } from '../characters/sheet/access.ts';
import { characterParams, type CharacterParams, reject, uuid } from '../characters/sheet/shared.ts';
import type { RouteContext } from '../system/route-context.ts';

// Path params arrive as strings (coerceTypes is off), so the schema checks one digit as a string, not an integer.
type CharacterSpellSlotParams = CharacterParams & { level: string };

export const SPELL_SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const characterSpellSlotParams = {
  type: 'object', required: ['campaignId', 'characterId', 'level'], additionalProperties: false,
  properties: { campaignId: uuid, characterId: uuid, level: { type: 'string', pattern: '^[1-9]$' } },
};

export function registerSpellSlotRoutes(ctx: RouteContext) {
  const { app, auth, db, membership } = ctx;

  app.get<{ Params: CharacterParams }>(
    '/campaigns/:campaignId/characters/:characterId/spell-slots',
    { schema: { params: characterParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId);
        await characterAccessLevel(ctx, q, campaignId, characterId, userId, member);

        const rows = (
          await q.query(
            'SELECT level, current, max FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2',
            [campaignId, characterId],
          )
        ).rows;
        const byLevel = new Map(rows.map(r => [r.level, r]));

        const slots = SPELL_SLOT_LEVELS.map(level => ({
          level,
          current: byLevel.get(level)?.current ?? 0,
          max: byLevel.get(level)?.max ?? 0,
        }));
        const own = (
          await q.query('SELECT pact_slots_current, pact_slots_max, pact_slot_level FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])
        ).rows[0];
        const pact = own?.pact_slots_max ? { current: own.pact_slots_current, max: own.pact_slots_max, slotLevel: own.pact_slot_level } : null;

        return { slots, pact };
      });
    },
  );

  app.put<{ Params: CharacterSpellSlotParams; Body: { current: number; max: number } }>(
    '/campaigns/:campaignId/characters/:characterId/spell-slots/:level',
    {
      schema: {
        params: characterSpellSlotParams,
        body: {
          type: 'object', required: ['current', 'max'], additionalProperties: false,
          properties: { current: { type: 'integer', minimum: 0 }, max: { type: 'integer', minimum: 0 } },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const level = Number(request.params.level);
      const { current, max } = request.body;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await requireCharacterAccess(ctx, q, campaignId, characterId, userId, member);

        const { rows } = await q.query(
          `INSERT INTO character_spell_slots (campaign_id, character_id, level, current, max)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (campaign_id, character_id, level) DO UPDATE SET
             current=$4, max=$5
           RETURNING level, current, max`,
          [campaignId, characterId, level, current, max],
        );

        return rows[0];
      });
    },
  );

  app.post<{ Params: CharacterParams }>(
    '/campaigns/:campaignId/characters/:characterId/spell-slots/by-class',
    { schema: { params: characterParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await requireCharacterAccess(ctx, q, campaignId, characterId, userId, member);
        const applied = await applyClassSlots(q, campaignId, characterId);
        if (!applied) reject(400, 'Класс не узнан или не заклинатель — укажите класс в листе (например, «Волшебник»).');
        if (applied.pactSystem === 'manual') {
          reject(400, 'Колдун-мультикласс: по правилу кампании «Ячейки договора при мультиклассе» ячейки ставятся вручную.');
        }
        return applied;
      });
    },
  );
}
