import { pendingSpellRefs } from '../characters/spell-refs.ts';
import { abilityModifier, proficiencyOf } from '../../../../packages/domain/dice/dice.ts';
import { characterClassLevels } from '../../../../packages/domain/character/classes.ts';
import { spellAttackBonus, spellSaveDc } from '../../../../packages/domain/spells/spell-mechanics.ts';

import { characterAccessLevel, requireCharacterAccess } from '../characters/sheet/access.ts';
import { characterParams, type CharacterParams } from '../characters/sheet/shared.ts';
import type { RouteContext } from '../system/route-context.ts';

export const ABILITY_NAMES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

export function registerSpellcastingRoutes(ctx: RouteContext) {
  const { app, auth, db, membership } = ctx;

  app.get<{ Params: CharacterParams }>(
    '/campaigns/:campaignId/characters/:characterId/spellcasting',
    { schema: { params: characterParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId);
        const privileged = await characterAccessLevel(ctx, q, campaignId, characterId, userId, member);
        const character = (
          await q.query(
            `SELECT level, challenge_rating::float8 AS challenge_rating, sheet_extra, class_name, spellcasting_ability, spell_save_dc_override, spell_attack_override, auto_reactions,
                    strength, dexterity, constitution, intelligence, wisdom, charisma
             FROM characters WHERE campaign_id=$1 AND id=$2`,
            [campaignId, characterId],
          )
        ).rows[0];
        const ability: string = character.spellcasting_ability ??
          ['intelligence', 'wisdom', 'charisma'].reduce((best, entry) => (character[entry] > character[best] ? entry : best), 'intelligence');
        const modifier = abilityModifier(character[ability]);
        const proficiency = proficiencyOf(character) ?? 0;
        return {
          ability, abilityFromSheet: character.spellcasting_ability !== null, modifier, proficiency,
          dc: character.spell_save_dc_override ?? spellSaveDc(proficiency, modifier),
          attack: character.spell_attack_override ?? spellAttackBonus(proficiency, modifier),
          dcOverride: character.spell_save_dc_override, attackOverride: character.spell_attack_override,
          classes: characterClassLevels(character).classes.map(entry => entry.id),
          autoReactions: character.auto_reactions ?? [],
          knowsShield: Boolean((await q.query(`SELECT 1 FROM character_spells WHERE campaign_id=$1 AND character_id=$2 AND source='srd' AND srd_index='shield'`, [campaignId, characterId])).rows[0]),
          knowsCounterspell: Boolean((await q.query(`SELECT 1 FROM character_spells WHERE campaign_id=$1 AND character_id=$2 AND source='srd' AND srd_index='counterspell'`, [campaignId, characterId])).rows[0]),
          knowsRebuke: Boolean((await q.query(`SELECT 1 FROM character_spells WHERE campaign_id=$1 AND character_id=$2 AND source='srd' AND srd_index='hellish-rebuke'`, [campaignId, characterId])).rows[0]),
          pending: privileged ? await pendingSpellRefs(q, campaignId, character.sheet_extra) : [],
        };
      });
    },
  );

  app.put<{ Params: CharacterParams; Body: { ability?: string | null; dcOverride?: number | null; attackOverride?: number | null } }>(
    '/campaigns/:campaignId/characters/:characterId/spellcasting',
    {
      schema: {
        params: characterParams,
        body: {
          type: 'object', additionalProperties: false, minProperties: 1,
          properties: {
            ability: { anyOf: [{ type: 'string', enum: ABILITY_NAMES }, { type: 'null' }] },
            dcOverride: { anyOf: [{ type: 'integer', minimum: 1, maximum: 40 }, { type: 'null' }] },
            attackOverride: { anyOf: [{ type: 'integer', minimum: -10, maximum: 30 }, { type: 'null' }] },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const body = request.body;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await requireCharacterAccess(ctx, q, campaignId, characterId, userId, member);
        await q.query(
          `UPDATE characters SET
             spellcasting_ability = CASE WHEN $3 THEN $4 ELSE spellcasting_ability END,
             spell_save_dc_override = CASE WHEN $5 THEN $6::smallint ELSE spell_save_dc_override END,
             spell_attack_override = CASE WHEN $7 THEN $8::smallint ELSE spell_attack_override END
           WHERE campaign_id=$1 AND id=$2`,
          [campaignId, characterId, 'ability' in body, body.ability ?? null, 'dcOverride' in body, body.dcOverride ?? null, 'attackOverride' in body, body.attackOverride ?? null],
        );
        return { ok: true };
      });
    },
  );
}
