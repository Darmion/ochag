import { createExperience, type ExperienceEvent } from '../experience.ts';
import { recordCombatEvent } from '../../tabletop/combat/combat-events.ts';
import { CHALLENGE_RATINGS } from '../../../../../packages/domain/character/experience.ts';

import { characterForEditing, isCharacterManager } from './access.ts';
import { attachExtras } from './extras.ts';
import {
  ABILITY_NAMES, assertAsset, CHARACTER_COLUMNS, characterParams, type CharacterParams, DAMAGE_TYPE_LIST, type Disposition,
  DISPOSITIONS, nullableUuid, OBJECT_KINDS, type ObjectKind, reject, type Size, SIZES,
} from './shared.ts';
import type { RouteContext } from '../../system/route-context.ts';

export function registerUpdateRoute(ctx: RouteContext) {
  const { app, auth, db, membership } = ctx;

  const experienceEngine = createExperience({
    campaignFlag: async (q, campaignId, key) => {
      const row = (await q.query(`SELECT value FROM campaign_rules WHERE campaign_id=$1 AND key=$2 AND kind='flag'`, [campaignId, key])).rows[0];
      return row ? row.value === true : null;
    },
  });
  function announce(campaignId: string, event: ExperienceEvent) {
    ctx.events?.emit(campaignId, { type: 'experience', reason: event.reason, awards: event.awards });
    ctx.events?.emit(campaignId, { type: 'changed' });
    for (const award of event.awards) ctx.events?.emit(campaignId, { type: 'character', characterId: award.characterId });
  }

  app.patch<{
    Params: CharacterParams;
    Body: {
      revision: number;
      name?: string;
      strength?: number;
      dexterity?: number;
      constitution?: number;
      intelligence?: number;
      wisdom?: number;
      charisma?: number;
      level?: number;
      hpCurrent?: number;
      hpMax?: number;
      hpTemp?: number;
      armorClass?: number;
      damageThreshold?: number | null;
      damageResistances?: string[];
      damageImmunities?: string[];
      damageVulnerabilities?: string[];
      spellcastingAbility?: string | null;
      hitDie?: number | null;
      hitDiceSpent?: number;
      experience?: number;
      challengeRating?: number | null;
      xpAward?: number | null;
      className?: string | null;
      attacksPerAction?: number | null;
      speedFeet?: number;
      sheetExtra?: Record<string, unknown>;
      kind?: ObjectKind;
      disposition?: Disposition | null;
      size?: Size;
      imageAssetId?: string | null;
      imageCrop?: { x: number; y: number; zoom: number } | null;
      modelAssetId?: string | null;
      coins?: { cp?: number; sp?: number; ep?: number; gp?: number; pp?: number };
      priceCp?: number | null;
      weightLb?: number | null;
      merchant?: boolean;
    };
  }>(
    '/campaigns/:campaignId/characters/:characterId',
    {
      schema: {
        params: characterParams,
        body: {
          type: 'object',
          required: ['revision'],
          additionalProperties: false,
          properties: {
            revision: { type: 'integer', minimum: 1 },
            name: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
            strength: { type: 'integer', minimum: 0 },
            dexterity: { type: 'integer', minimum: 0 },
            constitution: { type: 'integer', minimum: 0 },
            intelligence: { type: 'integer', minimum: 0 },
            wisdom: { type: 'integer', minimum: 0 },
            charisma: { type: 'integer', minimum: 0 },
            level: { type: 'integer', minimum: 1, maximum: 20 },
            hpCurrent: { type: 'integer', minimum: 0 },
            hpMax: { type: 'integer', minimum: 0 },
            hpTemp: { type: 'integer', minimum: 0 },
            armorClass: { type: 'integer' },
            damageThreshold: { oneOf: [{ type: 'integer', minimum: 0, maximum: 1000 }, { type: 'null' }] },
            damageResistances: DAMAGE_TYPE_LIST,
            damageImmunities: DAMAGE_TYPE_LIST,
            damageVulnerabilities: DAMAGE_TYPE_LIST,
            spellcastingAbility: { oneOf: [{ type: 'string', enum: [...ABILITY_NAMES] }, { type: 'null' }] },
            hitDie: { oneOf: [{ type: 'integer', enum: [6, 8, 10, 12] }, { type: 'null' }] },
            hitDiceSpent: { type: 'integer', minimum: 0, maximum: 30 },
            experience: { type: 'integer', minimum: 0, maximum: 10000000 },
            challengeRating: { oneOf: [{ type: 'number', enum: CHALLENGE_RATINGS }, { type: 'null' }] },
            xpAward: { oneOf: [{ type: 'integer', minimum: 0, maximum: 1000000 }, { type: 'null' }] },
            className: { oneOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
            attacksPerAction: { oneOf: [{ type: 'integer', minimum: 1, maximum: 10 }, { type: 'null' }] },
            speedFeet: { type: 'number', minimum: 0 },
            sheetExtra: { type: 'object', additionalProperties: true },
            kind: { type: 'string', enum: [...OBJECT_KINDS] },
            disposition: { oneOf: [{ type: 'string', enum: [...DISPOSITIONS] }, { type: 'null' }] },
            size: { type: 'string', enum: [...SIZES] },
            imageAssetId: nullableUuid,
            imageCrop: { oneOf: [{type: 'object', additionalProperties: false, required: ['x', 'y', 'zoom'], properties: {x: {type: 'number', minimum: 0, maximum: 100}, y: {type: 'number', minimum: 0, maximum: 100}, zoom: {type: 'number', minimum: 1, maximum: 5}}}, { type: 'null' }] },
            modelAssetId: nullableUuid,
            coins: {
              type: 'object', additionalProperties: false,
              properties: Object.fromEntries(['cp', 'sp', 'ep', 'gp', 'pp'].map(coin => [coin, { type: 'integer', minimum: 0, maximum: 1_000_000_000 }])),
            },
            priceCp: { oneOf: [{ type: 'integer', minimum: 0, maximum: 100_000_000 }, { type: 'null' }] },
            weightLb: { oneOf: [{ type: 'number', minimum: 0, maximum: 100_000 }, { type: 'null' }] },
            merchant: { type: 'boolean' },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const {
        revision, sheetExtra, kind, disposition, size, imageAssetId, imageCrop, modelAssetId, damageThreshold,
        damageResistances, damageImmunities, damageVulnerabilities, spellcastingAbility, hitDie, hitDiceSpent,
        experience, challengeRating, xpAward, className, attacksPerAction, coins, priceCp, weightLb, merchant, ...fields
      } = request.body;

      let defeated: ExperienceEvent | null = null;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        const character = await characterForEditing(ctx, q, campaignId, characterId, userId, member, true,
        );

        if (character.revision !== revision) {
          reject(409, 'Персонаж уже изменён другим участником.');
        }

        const kindChanges = kind !== undefined && kind !== character.kind;
        const dispositionChanges = disposition !== undefined && disposition !== character.disposition;

        if ((kindChanges || dispositionChanges) && !(await isCharacterManager(ctx, q, member, userId))) {
          reject(403, 'Менять вид объекта и отношение НПС может мастер.');
        }

        const nextKind: ObjectKind = kind ?? character.kind;
        let nextDisposition: Disposition | null = disposition !== undefined ? disposition : character.disposition;

        if (nextKind === 'npc') nextDisposition ??= 'neutral';
        else if (disposition) reject(400, 'Отношение (враг, нейтрал, союзник) бывает только у НПС.');
        else nextDisposition = null;

        if (imageAssetId) await assertAsset(q, campaignId, imageAssetId, 'object_image');
        if (modelAssetId) await assertAsset(q, campaignId, modelAssetId, 'object_model');

        if (coins !== undefined || priceCp !== undefined || weightLb !== undefined || merchant !== undefined) {
          if (merchant !== undefined) {
            const current = (await q.query('SELECT merchant FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0];
            if (current.merchant !== merchant && !(await isCharacterManager(ctx, q, member, userId))) reject(403, 'Торговцем НПС делает мастер.');
            if (merchant && nextKind !== 'npc') reject(400, 'Торговец — это НПС.');
          }
          await q.query(
            `UPDATE characters SET
               cp = COALESCE($3, cp), sp = COALESCE($4, sp), ep = COALESCE($5, ep), gp = COALESCE($6, gp), pp = COALESCE($7, pp),
               price_cp = CASE WHEN $8 THEN $9::integer ELSE price_cp END,
               weight_lb = CASE WHEN $10 THEN $11::numeric ELSE weight_lb END,
               merchant = COALESCE($12, merchant)
             WHERE campaign_id=$1 AND id=$2`,
            [
              campaignId, characterId, coins?.cp ?? null, coins?.sp ?? null, coins?.ep ?? null, coins?.gp ?? null, coins?.pp ?? null,
              priceCp !== undefined, priceCp ?? null, weightLb !== undefined, weightLb ?? null, merchant ?? null,
            ],
          );
        }

        const updated = await q.query(
          `UPDATE characters SET
             name = COALESCE($1, name),
             strength = COALESCE($2, strength),
             dexterity = COALESCE($3, dexterity),
             constitution = COALESCE($4, constitution),
             intelligence = COALESCE($5, intelligence),
             wisdom = COALESCE($6, wisdom),
             charisma = COALESCE($7, charisma),
             level = COALESCE($8, level),
             hp_current = COALESCE($9, hp_current),
             hp_max = COALESCE($10, hp_max),
             hp_temp = COALESCE($11, hp_temp),
             armor_class = COALESCE($12, armor_class),
             speed_feet = COALESCE($13, speed_feet),
             sheet_extra = COALESCE($14::jsonb, sheet_extra),
             kind = $17,
             disposition = $18,
             size = COALESCE($19, size),
             image_asset_id = CASE WHEN $20 THEN $21::uuid ELSE image_asset_id END,
             model_asset_id = CASE WHEN $22 THEN $23::uuid ELSE model_asset_id END,
             damage_threshold = CASE WHEN $24 THEN $25::integer ELSE damage_threshold END,
             damage_resistances = COALESCE($26::jsonb, damage_resistances),
             damage_immunities = COALESCE($27::jsonb, damage_immunities),
             damage_vulnerabilities = COALESCE($28::jsonb, damage_vulnerabilities),
             spellcasting_ability = CASE WHEN $29 THEN $30 ELSE spellcasting_ability END,
             hit_die = CASE WHEN $31 THEN $32::integer ELSE hit_die END,
             hit_dice_spent = COALESCE($33, hit_dice_spent),
             -- Потрачено поправили руками — раскладка по костям выводится заново.
             hit_dice_spent_by_die = CASE WHEN $33::integer IS NULL THEN hit_dice_spent_by_die END,
             experience = COALESCE($34, experience),
             challenge_rating = CASE WHEN $35 THEN $36::numeric ELSE challenge_rating END,
             xp_award = CASE WHEN $37 THEN $38::integer ELSE xp_award END,
             class_name = CASE WHEN $39 THEN $40 ELSE class_name END,
             attacks_per_action = CASE WHEN $41 THEN $42::integer ELSE attacks_per_action END,
             image_crop = CASE WHEN $43 THEN $44::jsonb WHEN $20 THEN NULL ELSE image_crop END,
             revision = revision + 1
           WHERE campaign_id=$15 AND id=$16
           RETURNING ${CHARACTER_COLUMNS}`,
          [
            fields.name?.trim() ?? null,
            fields.strength ?? null,
            fields.dexterity ?? null,
            fields.constitution ?? null,
            fields.intelligence ?? null,
            fields.wisdom ?? null,
            fields.charisma ?? null,
            fields.level ?? null,
            fields.hpCurrent ?? null,
            fields.hpMax ?? null,
            fields.hpTemp ?? null,
            fields.armorClass ?? null,
            fields.speedFeet ?? null,
            sheetExtra !== undefined ? JSON.stringify(sheetExtra) : null,
            campaignId,
            characterId,
            nextKind,
            nextDisposition,
            size ?? null,
            imageAssetId !== undefined,
            imageAssetId ?? null,
            modelAssetId !== undefined,
            modelAssetId ?? null,
            damageThreshold !== undefined,
            damageThreshold ?? null,
            damageResistances !== undefined ? JSON.stringify(damageResistances) : null,
            damageImmunities !== undefined ? JSON.stringify(damageImmunities) : null,
            damageVulnerabilities !== undefined ? JSON.stringify(damageVulnerabilities) : null,
            spellcastingAbility !== undefined,
            spellcastingAbility ?? null,
            hitDie !== undefined,
            hitDie ?? null,
            hitDiceSpent ?? null,
            experience ?? null,
            challengeRating !== undefined,
            challengeRating ?? null,
            xpAward !== undefined,
            xpAward ?? null,
            className !== undefined,
            className?.trim() || null,
            attacksPerAction !== undefined,
            attacksPerAction ?? null,
            imageCrop !== undefined,
            imageCrop ? JSON.stringify(imageCrop) : null,
          ],
        );

        const after = updated.rows[0] as any;
        if (after.kind === 'npc' && Number(character.hp_current) > 0 && Number(after.hp_current) === 0) {
          defeated = await experienceEngine.awardForDefeat(q, campaignId, characterId);
        }
        const delta = Number(after.hp_current) - Number(character.hp_current);
        if (delta !== 0 && after.kind !== 'object') {
          await recordCombatEvent(q, campaignId, {
            targetId: characterId, kind: delta < 0 ? 'damage' : 'heal', amount: Math.abs(delta),
            dropped: Number(character.hp_current) > 0 && Number(after.hp_current) === 0, source: 'manual',
          });
        }
        return attachExtras(q, campaignId, characterId, after);
      });
      if (defeated) announce(campaignId, defeated);
      return result;
    },
  );
}
