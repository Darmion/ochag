import type { Queryable } from '../../db.ts';

export type CampaignParams = {
  campaignId: string;
};

export type CharacterParams = CampaignParams & {
  characterId: string;
};

export type EffectParams = CharacterParams & {
  effectId: string;
};

export type ResourceParams = CharacterParams & {
  resourceId: string;
};

export type WeaponParams = CharacterParams & {
  weaponId: string;
};

export function reject(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

export const uuid = { type: 'string', format: 'uuid' };

export const characterParams = {
  type: 'object',
  required: ['campaignId', 'characterId'],
  additionalProperties: false,
  properties: { campaignId: uuid, characterId: uuid },
};

export const effectParams = {
  type: 'object',
  required: ['campaignId', 'characterId', 'effectId'],
  additionalProperties: false,
  properties: { campaignId: uuid, characterId: uuid, effectId: uuid },
};

export const resourceParams = {
  type: 'object',
  required: ['campaignId', 'characterId', 'resourceId'],
  additionalProperties: false,
  properties: { campaignId: uuid, characterId: uuid, resourceId: uuid },
};

export const weaponParams = {
  type: 'object',
  required: ['campaignId', 'characterId', 'weaponId'],
  additionalProperties: false,
  properties: { campaignId: uuid, characterId: uuid, weaponId: uuid },
};

export const OBJECT_KINDS = ['character', 'npc', 'object'] as const;
export type ObjectKind = typeof OBJECT_KINDS[number];
export const DISPOSITIONS = ['hostile', 'neutral', 'friendly'] as const;
export type Disposition = typeof DISPOSITIONS[number];
export const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
export type Size = typeof SIZES[number];

export const CHARACTER_COLUMNS = `id, campaign_id, owner_user_id, name, level, sheet_version, revision,
       kind, disposition, size, model_asset_id, image_asset_id, image_crop, shared,
       strength, dexterity, constitution, intelligence, wisdom, charisma,
       hp_current, hp_max, hp_temp, armor_class, damage_threshold,
       speed_feet::float8 AS speed_feet, sheet_extra, death_successes, death_failures,
       damage_resistances, damage_immunities, damage_vulnerabilities, spellcasting_ability,
       hit_die, hit_dice_spent, hit_dice_spent_by_die, pact_slots_max, pact_slots_current, pact_slot_level,
       experience, challenge_rating::float8 AS challenge_rating, xp_award, inspiration,
       class_name, attacks_per_action,
       cp, sp, ep, gp, pp, price_cp, weight_lb::float8 AS weight_lb, merchant`;

export const nullableUuid = { oneOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] };

export const DAMAGE_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
] as const;
export const DAMAGE_TYPE_LIST = { type: 'array', maxItems: 13, uniqueItems: true, items: { type: 'string', enum: [...DAMAGE_TYPES] } };

export const ABILITY_NAMES = new Set(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']);

export async function assertAsset(q: Queryable, campaignId: string, assetId: string, kind: 'object_image' | 'object_model') {
  const { rows } = await q.query(
    'SELECT 1 FROM assets WHERE campaign_id=$1 AND id=$2 AND kind=$3',
    [campaignId, assetId, kind],
  );

  if (!rows[0]) {
    reject(400, kind === 'object_image' ? 'Картинка не найдена в этой кампании.' : 'Модель не найдена в этой кампании.');
  }
}
