import type { Queryable } from '../db.ts';
import { monsterSheet, type SrdMonster } from '../../../../packages/domain/world/bestiary.ts';

export function ownBody(row: any, mental: boolean) {
  return {
    hp_current: row.hp_current, hp_max: row.hp_max, armor_class: row.armor_class, speed_feet: row.speed_feet,
    strength: row.strength, dexterity: row.dexterity, constitution: row.constitution, size: row.size,
    ...(mental ? { intelligence: row.intelligence, wisdom: row.wisdom, charisma: row.charisma } : {}),
  };
}

export async function takeBeastBody(q: Queryable, campaignId: string, characterId: string, beast: SrdMonster, mental: boolean) {
  await q.query(
    `UPDATE characters SET hp_current=$3, hp_max=$3, hp_temp=0, armor_class=$4, speed_feet=$5, strength=$6, dexterity=$7, constitution=$8, size=$9,
       intelligence=COALESCE($10, intelligence), wisdom=COALESCE($11, wisdom), charisma=COALESCE($12, charisma), revision=revision+1
     WHERE campaign_id=$1 AND id=$2`,
    [
      campaignId, characterId, beast.hp, beast.ac, beast.speed, beast.abilities[0], beast.abilities[1], beast.abilities[2], beast.size,
      mental ? beast.abilities[3] : null, mental ? beast.abilities[4] : null, mental ? beast.abilities[5] : null,
    ],
  );
  for (const weapon of monsterSheet(beast, beast.hp).weapons) {
    await q.query(
      `INSERT INTO character_weapons (campaign_id, character_id, name, ability, proficient, damage_formula, damage_type, range_feet, weapon_kind,
         long_range_feet, thrown_range_feet, versatile_formula, properties, attack_bonus, extra_damage_formula, extra_damage_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16)`,
      [
        campaignId, characterId, `${weapon.name} (${beast.nameRu})`.slice(0, 100), weapon.ability, weapon.proficient, weapon.damage_formula, weapon.damage_type,
        weapon.range_feet, weapon.weapon_kind, weapon.long_range_feet, weapon.thrown_range_feet, weapon.versatile_formula,
        JSON.stringify([...weapon.properties, 'wild_shape']), weapon.attack_bonus, weapon.extra_damage_formula, weapon.extra_damage_type,
      ],
    );
  }
}

export async function restoreOwnForm(q: Queryable, campaignId: string, characterId: string, parameters: any, overflow = 0) {
  const own = parameters?.own ?? {};
  const hp = Math.max(0, Number(own.hp_current ?? 0) - Math.max(0, overflow));
  await q.query(
    `UPDATE characters SET hp_current=$3, hp_max=$4, armor_class=$5, speed_feet=$6, strength=$7, dexterity=$8, constitution=$9, size=$10,
       intelligence=COALESCE($11, intelligence), wisdom=COALESCE($12, wisdom), charisma=COALESCE($13, charisma), hp_temp=0, revision=revision+1
     WHERE campaign_id=$1 AND id=$2`,
    [
      campaignId, characterId, hp, own.hp_max, own.armor_class, own.speed_feet, own.strength, own.dexterity, own.constitution, own.size ?? 'medium',
      own.intelligence ?? null, own.wisdom ?? null, own.charisma ?? null,
    ],
  );
  await q.query(`DELETE FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND properties ? 'wild_shape'`, [campaignId, characterId]);
  return { hp, beastName: String(parameters?.beastName ?? 'зверь'), ownHp: Number(own.hp_current ?? 0) };
}
