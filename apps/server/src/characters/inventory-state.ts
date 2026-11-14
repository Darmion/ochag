import type { Queryable } from '../db.ts';
import { COINS } from '../../../../packages/domain/character/coins.ts';
import { characterClassLevels } from '../../../../packages/domain/character/classes.ts';
import { knownFightingStyles } from '../../../../packages/domain/character/feats.ts';
import {
  carriedWeight, encumberedSpeed, encumbrance, gearArmorClass, heavyArmorSlow, itemCategory, type InventoryItem,
} from '../../../../packages/domain/character/inventory.ts';
import { SRD_CLASSES } from '../../../../packages/domain/srd/heroes.ts';
import { weaponGained } from '../../../../packages/domain/character/multiclass-gains.ts';
import type { ClassLevel } from '../../../../packages/domain/character/classes.ts';
import type { SrdWeapon } from '../../../../packages/domain/srd/weapons.ts';

export const ITEM_COLUMNS = `c.id, c.name, c.kind, c.container_id, c.owner_user_id, c.image_asset_id, c.price_cp, c.weight_lb::float8 AS weight_lb,
  c.quantity, c.item_category, c.item_srd, c.item_wear, c.equipped_slot, c.item_grip, c.infinite, c.item_note`;

export type ItemRow = Record<string, any>;

export function asItem(row: ItemRow): InventoryItem {
  return {
    id: row.id, name: row.name, containerId: row.container_id ?? null, quantity: Number(row.quantity ?? 1),
    weightLb: row.weight_lb === null || row.weight_lb === undefined ? null : Number(row.weight_lb),
    priceCp: row.price_cp === null || row.price_cp === undefined ? null : Number(row.price_cp),
    category: row.item_category ?? null, srd: row.item_srd ?? null, wear: row.item_wear ?? null,
    slot: row.equipped_slot ?? null, grip: row.item_grip ?? null, infinite: row.infinite === true,
  };
}

export async function loadHeldItems(q: Queryable, campaignId: string, holderId: string): Promise<ItemRow[]> {
  return (
    await q.query(
      `WITH RECURSIVE tree AS (
         SELECT c.id, 0 AS depth FROM characters c WHERE c.campaign_id=$1 AND c.container_id=$2 AND c.kind='object'
         UNION ALL
         SELECT c.id, tree.depth + 1 FROM characters c JOIN tree ON c.container_id = tree.id WHERE c.campaign_id=$1 AND tree.depth < 8
       )
       SELECT ${ITEM_COLUMNS}, tree.depth FROM tree JOIN characters c ON c.campaign_id=$1 AND c.id = tree.id
       ORDER BY tree.depth, c.name, c.id LIMIT 2000`,
      [campaignId, holderId],
    )
  ).rows;
}

export async function refreshGearAc(q: Queryable, campaignId: string, holderId: string): Promise<number | null> {
  const holder = (
    await q.query(
      'SELECT id, kind, ac_mode, armor_class, dexterity, constitution, wisdom, class_name, sheet_extra, level FROM characters WHERE campaign_id=$1 AND id=$2',
      [campaignId, holderId],
    )
  ).rows[0] as ItemRow | undefined;
  if (!holder || holder.kind === 'object' || holder.ac_mode !== 'gear') return null;
  const value = await gearAcValue(q, campaignId, holder);
  if (value !== Number(holder.armor_class)) {
    await q.query('UPDATE characters SET armor_class=$3, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, holderId, value]);
  }
  return value;
}

export async function itemLeftHolder(q: Queryable, campaignId: string, itemId: string, formerHolderId: string | null) {
  await q.query('DELETE FROM character_weapons WHERE campaign_id=$1 AND source_item_id=$2 AND source_auto', [campaignId, itemId]);
  await q.query('UPDATE character_weapons SET source_item_id=NULL WHERE campaign_id=$1 AND source_item_id=$2', [campaignId, itemId]);
  if (formerHolderId) await refreshGearAc(q, campaignId, formerHolderId);
}

export async function wornArmorInCombat(q: Queryable, campaignId: string, itemIds: string[]) {
  if (!itemIds.length) return null;
  const rows = (await q.query(`SELECT ${ITEM_COLUMNS} FROM characters c WHERE c.campaign_id=$1 AND c.id = ANY($2::uuid[]) AND c.equipped_slot='body'`, [campaignId, itemIds])).rows;
  for (const row of rows) {
    if (itemCategory(asItem(row)) !== 'armor' || !row.container_id) continue;
    const fighting = (await q.query(
      `SELECT 1 FROM initiative_entries ie WHERE ie.campaign_id=$1 AND ie.character_id=$2
         AND EXISTS (SELECT 1 FROM initiative_entries x WHERE x.campaign_id=ie.campaign_id AND x.scene_id=ie.scene_id AND x.is_current) LIMIT 1`,
      [campaignId, row.container_id],
    )).rows[0];
    if (fighting) return row.name as string;
  }
  return null;
}

export function proficientWith(classes: ClassLevel[], weapon: SrdWeapon): boolean {
  return classes.some((entry, index) => {
    if (index > 0) return weaponGained(entry.id, weapon.nameRu);
    const hero = SRD_CLASSES.find(candidate => candidate.id === entry.id);
    return Boolean(hero && (hero.weapons.groups.includes(weapon.category) || (hero.weapons.extra ?? []).includes(weapon.index)));
  });
}

export async function linkedTwoHanded(q: Queryable, campaignId: string, characterId: string, weaponId: string) {
  const row = (await q.query(
    `SELECT i.item_grip FROM character_weapons w JOIN characters i ON i.campaign_id=w.campaign_id AND i.id=w.source_item_id
     WHERE w.campaign_id=$1 AND w.character_id=$2 AND w.id=$3 AND i.container_id=$2`,
    [campaignId, characterId, weaponId],
  )).rows[0];
  return row?.item_grip === 'two';
}

export async function gearAcValue(q: Queryable, campaignId: string, holder: ItemRow) {
  const worn = (await q.query(`SELECT ${ITEM_COLUMNS} FROM characters c WHERE c.campaign_id=$1 AND c.container_id=$2 AND c.equipped_slot IS NOT NULL`, [campaignId, holder.id])).rows.map(asItem);
  const gear = gearArmorClass({
    worn, dexterity: Number(holder.dexterity), constitution: Number(holder.constitution), wisdom: Number(holder.wisdom),
    classes: characterClassLevels(holder).classes, defenseStyle: knownFightingStyles(holder.sheet_extra).ids.includes('defense'),
  });
  const magic = await magicArmorBonus(q, campaignId, holder.id);
  return Math.max(0, gear.value + magic);
}

export async function magicArmorBonus(q: Queryable, campaignId: string, holderId: string) {
  return Number((
    await q.query(`SELECT COALESCE(SUM((applied->>'armorClass')::int), 0) AS ac FROM magic_items WHERE campaign_id=$1 AND applied->>'characterId' = $2::text`, [campaignId, holderId])
  ).rows[0]?.ac ?? 0);
}

export async function loadSlowdown(
  campaignFlag: (q: Queryable, campaignId: string, key: string) => Promise<boolean | null>, q: Queryable, campaignId: string, characterId: string, feet: number,
): Promise<{ feet: number; reasons: string[] }> {
  const holder = (await q.query('SELECT strength, size, kind, cp, sp, ep, gp, pp FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as ItemRow | undefined;
  if (!holder || holder.kind === 'object') return { feet, reasons: [] };
  const items = (await loadHeldItems(q, campaignId, characterId)).map(asItem);
  const reasons: string[] = [];
  let result = feet;
  const worn = items.filter(item => item.containerId === characterId && item.slot);
  const armorSlow = heavyArmorSlow(worn, Number(holder.strength ?? 10));
  if (armorSlow && result > 0) {
    result = Math.max(0, result - armorSlow);
    reasons.push(`скорость −${armorSlow} фт.: тяжёлому доспеху не хватает Силы`);
  }
  if ((await campaignFlag(q, campaignId, 'encumbrance')) === true && (await campaignFlag(q, campaignId, 'encumbrance_speed')) === true) {
    const coins = COINS.reduce((sum, coin) => sum + Math.max(0, Number(holder[coin] ?? 0)), 0);
    const weight = carriedWeight(characterId, items, coins);
    const load = encumbrance(weight.pounds, weight.unknown, Number(holder.strength ?? 10), holder.size ?? null);
    const slowed = encumberedSpeed(result, load);
    if (slowed !== result) {
      reasons.push(load.level === 'over' ? 'перегрузка: не больше 5 фт.' : `скорость −${load.penalty} фт.: ${load.level === 'heavy' ? 'тяжёлая нагрузка' : 'нагрузка'}`);
      result = slowed;
    }
  }
  return { feet: result, reasons };
}

