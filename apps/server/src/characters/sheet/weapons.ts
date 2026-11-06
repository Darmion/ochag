import type { Queryable } from '../../db.ts';
import { resolveFormula } from '../../../../../packages/domain/dice/formula.ts';

import { characterForEditing } from './access.ts';
import { characterParams, type CharacterParams, DAMAGE_TYPES, nullableUuid, reject, weaponParams, type WeaponParams } from './shared.ts';
import type { RouteContext } from '../../system/route-context.ts';

export const WEAPON_ABILITIES = ['strength', 'dexterity', 'finesse'] as const;
export const WEAPON_PROPERTY_CODES = ['ammunition', 'finesse', 'heavy', 'light', 'loading', 'reach', 'special', 'thrown', 'two-handed', 'versatile'] as const;
export const WEAPON_COLUMNS = `id, name, ability, proficient, damage_formula, damage_type, range_feet,
  weapon_kind, long_range_feet, thrown_range_feet, versatile_formula, ammo_resource_id, properties, srd_index,
  attack_bonus, extra_damage_formula, extra_damage_type`;

export const WEAPON_DAMAGE_PROPERTIES = {
  damageFormula: { oneOf: [{ type: 'string', maxLength: 60 }, { type: 'null' }] },
  damageType: { oneOf: [{ type: 'string', enum: [...DAMAGE_TYPES] }, { type: 'null' }] },
  rangeFeet: { type: 'integer', minimum: 5, maximum: 1000 },
  weaponKind: { type: 'string', enum: ['melee', 'ranged'] },
  longRangeFeet: { oneOf: [{ type: 'integer', minimum: 5, maximum: 2000 }, { type: 'null' }] },
  thrownRangeFeet: { oneOf: [{ type: 'integer', minimum: 5, maximum: 1000 }, { type: 'null' }] },
  versatileFormula: { oneOf: [{ type: 'string', maxLength: 60 }, { type: 'null' }] },
  ammoResourceId: nullableUuid,
  properties: { type: 'array', maxItems: 10, uniqueItems: true, items: { type: 'string', enum: [...WEAPON_PROPERTY_CODES] } },
  srdIndex: { oneOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
  attackBonus: { type: 'integer', minimum: -10, maximum: 20 },
  extraDamageFormula: { oneOf: [{ type: 'string', maxLength: 60 }, { type: 'null' }] },
  extraDamageType: { oneOf: [{ type: 'string', enum: [...DAMAGE_TYPES] }, { type: 'null' }] },
};

export type WeaponExtras = {
  weaponKind?: 'melee' | 'ranged'; longRangeFeet?: number | null; thrownRangeFeet?: number | null;
  versatileFormula?: string | null; ammoResourceId?: string | null; properties?: string[]; srdIndex?: string | null;
  attackBonus?: number; extraDamageFormula?: string | null; extraDamageType?: string | null;
};

export function assertDamageFormula(formula: string | null | undefined) {
  if (!formula?.trim()) return;
  const probe = resolveFormula(formula.replace(/@mod\b/g, '@str'), { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, prof: 0 });
  if (!probe.ok) reject(400, `Формула урона «${formula}» не разобрана: нужно вида 1d8+@dex (кости и переменные @str…@cha, @prof, @mod).`);
}

export async function assertAmmo(q: Queryable, campaignId: string, characterId: string, resourceId: string | null | undefined) {
  if (!resourceId) return;
  const row = (await q.query('SELECT 1 FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND id=$3', [campaignId, characterId, resourceId])).rows[0];
  if (!row) reject(400, 'Боеприпасы — ресурс этого же листа (например, «Стрелы»).');
}

export function registerWeaponRoutes(ctx: RouteContext) {
  const { app, auth, db, membership } = ctx;

  app.post<{
    Params: CharacterParams;
    Body: {
      name: string; ability: 'strength' | 'dexterity' | 'finesse'; proficient?: boolean;
      damageFormula?: string | null; damageType?: string | null; rangeFeet?: number;
    } & WeaponExtras;
  }>(
    '/campaigns/:campaignId/characters/:characterId/weapons',
    {
      schema: {
        params: characterParams,
        body: {
          type: 'object',
          required: ['name', 'ability'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
            ability: { type: 'string', enum: [...WEAPON_ABILITIES] },
            proficient: { type: 'boolean' },
            ...WEAPON_DAMAGE_PROPERTIES,
          },
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { name, ability, proficient, damageFormula, damageType, rangeFeet } = request.body;
      const extras = request.body;
      assertDamageFormula(damageFormula);
      assertDamageFormula(extras.versatileFormula);
      assertDamageFormula(extras.extraDamageFormula);

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await characterForEditing(ctx, q, campaignId, characterId, userId, member, true);
        await assertAmmo(q, campaignId, characterId, extras.ammoResourceId);

        const inserted = await q.query(
          `INSERT INTO character_weapons (
             campaign_id, character_id, name, ability, proficient, damage_formula, damage_type, range_feet,
             weapon_kind, long_range_feet, thrown_range_feet, versatile_formula, ammo_resource_id, properties, srd_index,
             attack_bonus, extra_damage_formula, extra_damage_type
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18)
           RETURNING ${WEAPON_COLUMNS}`,
          [
            campaignId, characterId, name.trim(), ability, proficient ?? true, damageFormula?.trim() || null, damageType ?? null,
            rangeFeet ?? (extras.weaponKind === 'ranged' ? 80 : 5),
            extras.weaponKind ?? ((rangeFeet ?? 5) > 10 ? 'ranged' : 'melee'),
            extras.longRangeFeet ?? null, extras.thrownRangeFeet ?? null, extras.versatileFormula?.trim() || null,
            extras.ammoResourceId ?? null, JSON.stringify(extras.properties ?? []), extras.srdIndex ?? null,
            extras.attackBonus ?? 0, extras.extraDamageFormula?.trim() || null, extras.extraDamageType ?? null,
          ],
        );

        return inserted.rows[0];
      });

      return reply.code(201).send(result);
    },
  );

  app.patch<{
    Params: WeaponParams;
    Body: {
      name?: string; ability?: 'strength' | 'dexterity' | 'finesse'; proficient?: boolean;
      damageFormula?: string | null; damageType?: string | null; rangeFeet?: number;
    } & WeaponExtras;
  }>(
    '/campaigns/:campaignId/characters/:characterId/weapons/:weaponId',
    {
      schema: {
        params: weaponParams,
        body: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
            ability: { type: 'string', enum: [...WEAPON_ABILITIES] },
            proficient: { type: 'boolean' },
            ...WEAPON_DAMAGE_PROPERTIES,
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId, weaponId } = request.params;
      const { name, ability, proficient, damageFormula, damageType, rangeFeet } = request.body;
      const extras = request.body;
      assertDamageFormula(damageFormula);
      assertDamageFormula(extras.versatileFormula);
      assertDamageFormula(extras.extraDamageFormula);

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await characterForEditing(ctx, q, campaignId, characterId, userId, member, true);
        await assertAmmo(q, campaignId, characterId, extras.ammoResourceId);

        const updated = await q.query(
          `UPDATE character_weapons SET
             name = COALESCE($1, name),
             ability = COALESCE($2, ability),
             proficient = COALESCE($3, proficient),
             damage_formula = CASE WHEN $7 THEN $8 ELSE damage_formula END,
             damage_type = CASE WHEN $9 THEN $10 ELSE damage_type END,
             range_feet = COALESCE($11, range_feet),
             weapon_kind = COALESCE($12, weapon_kind),
             long_range_feet = CASE WHEN $13 THEN $14::integer ELSE long_range_feet END,
             thrown_range_feet = CASE WHEN $15 THEN $16::integer ELSE thrown_range_feet END,
             versatile_formula = CASE WHEN $17 THEN $18 ELSE versatile_formula END,
             ammo_resource_id = CASE WHEN $19 THEN $20::uuid ELSE ammo_resource_id END,
             properties = COALESCE($21::jsonb, properties),
             attack_bonus = COALESCE($22, attack_bonus),
             extra_damage_formula = CASE WHEN $23 THEN $24 ELSE extra_damage_formula END,
             extra_damage_type = CASE WHEN $25 THEN $26 ELSE extra_damage_type END
           WHERE campaign_id=$4 AND character_id=$5 AND id=$6
           RETURNING ${WEAPON_COLUMNS}`,
          [
            name?.trim() ?? null, ability ?? null, proficient ?? null, campaignId, characterId, weaponId,
            damageFormula !== undefined, damageFormula?.trim() || null,
            damageType !== undefined, damageType ?? null,
            rangeFeet ?? null,
            extras.weaponKind ?? null,
            extras.longRangeFeet !== undefined, extras.longRangeFeet ?? null,
            extras.thrownRangeFeet !== undefined, extras.thrownRangeFeet ?? null,
            extras.versatileFormula !== undefined, extras.versatileFormula?.trim() || null,
            extras.ammoResourceId !== undefined, extras.ammoResourceId ?? null,
            extras.properties ? JSON.stringify(extras.properties) : null,
            extras.attackBonus ?? null,
            extras.extraDamageFormula !== undefined, extras.extraDamageFormula?.trim() || null,
            extras.extraDamageType !== undefined, extras.extraDamageType ?? null,
          ],
        );

        if (!updated.rows[0]) reject(404, 'Оружие не найдено.');

        return updated.rows[0];
      });
    },
  );

  app.delete<{ Params: WeaponParams }>(
    '/campaigns/:campaignId/characters/:characterId/weapons/:weaponId',
    { schema: { params: weaponParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId, weaponId } = request.params;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await characterForEditing(ctx, q, campaignId, characterId, userId, member, true);

        await q.query(
          `DELETE FROM character_weapons
           WHERE campaign_id=$1 AND character_id=$2 AND id=$3`,
          [campaignId, characterId, weaponId],
        );
      });

      return reply.code(204).send();
    },
  );
}
