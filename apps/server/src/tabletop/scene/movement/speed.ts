import type { Queryable } from '../../../db.ts';
import { ARMOR } from '../../../../../../packages/domain/srd/heroes.ts';
import { SRD_GEAR_BY_INDEX } from '../../../../../../packages/domain/srd/gear.ts';
import { hasFeat } from '../../../../../../packages/domain/character/feats.ts';
import { classFeaturesFor, unarmoredDefense, unarmoredMovementFeet, classLevelOf } from '../../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../../packages/domain/character/classes.ts';
import { findMonster } from '../../../../../../packages/domain/world/bestiary.ts';

export async function naturalFlySpeed(q: Queryable, campaignId: string, characterId: string): Promise<number> {
  const extra = (await q.query('SELECT sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0]?.sheet_extra as any;
  return flySpeedFrom(extra);
}

export function flySpeedFrom(extra: any): number {
  const own = Number(extra?.flySpeedFeet ?? 0);
  if (own > 0) return own;
  const monster = typeof extra?.srdMonster === 'string' ? findMonster(extra.srdMonster) : undefined;
  const match = /летая (\d+) фт/i.exec(monster?.speedNote ?? '');
  return match ? Number(match[1]) : 0;
}

export async function flightSpeed(q: Queryable, campaignId: string, characterId: string, walk: number): Promise<number | null> {
  const effects = (
    await q.query(`SELECT effect_code, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('flying', 'dragon_wings')`, [campaignId, characterId])
  ).rows as Array<{ effect_code: string; parameters: any }>;
  if (!effects.length) return null;
  const speeds = effects.map(effect => (effect.effect_code === 'dragon_wings' ? walk : Number(effect.parameters?.feet ?? 0) || walk));
  return Math.max(...speeds);
}

export const HEAVY_ARMOR_NAMES = Object.entries(ARMOR).filter(([, armor]) => armor.group === 'heavy')
  .map(([index]) => SRD_GEAR_BY_INDEX.get(index)?.nameRu.toLowerCase()).filter((name): name is string => Boolean(name));

export const ANY_ARMOR_NAMES = [...Object.keys(ARMOR), 'shield'].map(index => SRD_GEAR_BY_INDEX.get(index)?.nameRu.toLowerCase()).filter((name): name is string => Boolean(name));

export async function classSpeedBonus(q: Queryable, campaignId: string, characterId: string): Promise<{ feet: number; reasons: string[] }> {
  const none = { feet: 0, reasons: [] as string[] };
  const row = (
    await q.query('SELECT id, kind, level, class_name, sheet_extra, armor_class, dexterity, constitution, wisdom FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])
  ).rows[0] as any;
  if (!row || row.kind === 'object') return none;
  const classes = characterClassLevels(row).classes;
  const ids = new Set(classFeaturesFor(classes).map(feature => feature.id));
  const mobile = hasFeat(row.sheet_extra, 'mobile');
  if (!ids.has('fast-movement') && !ids.has('unarmored-movement') && !mobile) return none;
  const held = (
    await q.query(`SELECT lower(name) AS name FROM characters WHERE campaign_id=$1 AND container_id=$2 AND kind='object'`, [campaignId, characterId])
  ).rows.map(entry => String(entry.name));
  const holds = (names: string[]) => held.some(name => names.some(armor => name === armor || name.startsWith(`${armor} `)));
  const result = { feet: 0, reasons: [] as string[] };
  if (ids.has('unarmored-movement')) {
    const unarmored = unarmoredDefense(classes, { dexterity: Number(row.dexterity ?? 10), constitution: Number(row.constitution ?? 10), wisdom: Number(row.wisdom ?? 10) });
    if (unarmored && Number(row.armor_class) === unarmored.ac && !holds(ANY_ARMOR_NAMES)) {
      const feet = unarmoredMovementFeet(classLevelOf(classes, 'monk', row.level));
      result.feet += feet;
      result.reasons.push(`скорость +${feet} фт.: движение без доспехов`);
    }
  }
  if (ids.has('fast-movement') && !holds(HEAVY_ARMOR_NAMES)) {
    result.feet += 10;
    result.reasons.push('скорость +10 фт.: быстрое передвижение');
  }
  if (mobile) {
    result.feet += 10;
    result.reasons.push('скорость +10 фт.: мобильный');
  }
  return result;
}
