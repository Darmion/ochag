import type { Queryable } from '../../db.ts';
import { auraOfProtection, auraOfDevotion, auraOfCourage, classFeaturesFor, NATURES_SANCTUARY_TYPES } from '../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { placementFactions, placementsAllied } from '../../campaign/factions.ts';
import { spellSaveDc } from '../../../../../packages/domain/spells/spell-mechanics.ts';
import { loadConditionState } from '../../rules/conditions.ts';
import { incapacitatedReason } from '../../../../../packages/domain/combat/conditions.ts';
import { abilityModifier, proficiencyBonusForLevel } from '../../../../../packages/domain/dice/dice.ts';

import { feetBetween, getScene } from '../scene/board.ts';
import { loadPlacements } from '../scene/placements.ts';
import { creatureTypeOf } from '../spells/rules.ts';

export async function auraSurroundings(q: Queryable, campaignId: string, characterId: string) {
  const placed = (
    await q.query(
      `SELECT o.scene_id FROM scene_objects o
         LEFT JOIN initiative_entries i ON i.campaign_id=o.campaign_id AND i.scene_id=o.scene_id AND i.character_id=o.character_id
         WHERE o.campaign_id=$1 AND o.character_id=$2 AND o.parent_object_id IS NULL
         ORDER BY (i.id IS NOT NULL) DESC, o.created_at DESC LIMIT 1`,
      [campaignId, characterId],
    )
  ).rows[0] as { scene_id: string } | undefined;
  const scene = placed ? await getScene(q, campaignId, placed.scene_id, false) : null;
  const placements = scene ? await loadPlacements(q, campaignId, scene.id) : [];
  const self = placements.find(entry => entry.character_id === characterId && !entry.parent_object_id) ?? null;
  const ids = [characterId, ...placements.filter(entry => !entry.parent_object_id && entry.character_id !== characterId && self && placementFactions(self).length > 0 && placementsAllied(entry, self)).map(entry => entry.character_id)];
  const reaches = async (paladinId: string, feet: number) => {
    if (paladinId !== characterId) {
      const at = placements.find(entry => entry.character_id === paladinId && !entry.parent_object_id);
      if (!at || !self || !scene || feetBetween(scene, self, at) > feet) return false;
    }
    return !incapacitatedReason(await loadConditionState(q, campaignId, paladinId));
  };
  return { ids, reaches };
}

export async function protectionAura(q: Queryable, campaignId: string, characterId: string): Promise<{ bonus: number; name: string | null } | null> {
  const { ids, reaches } = await auraSurroundings(q, campaignId, characterId);
  const rows = (
    await q.query('SELECT id, name, level, class_name, sheet_extra, charisma FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[]) AND COALESCE(level, 0) >= 6', [campaignId, ids])
  ).rows as any[];
  let best: { bonus: number; name: string | null } | null = null;
  for (const row of rows) {
    const aura = auraOfProtection(characterClassLevels(row).classes, abilityModifier(row.charisma));
    if (!aura || (best && best.bonus >= aura.bonus)) continue;
    if (!(await reaches(row.id, aura.feet))) continue;
    best = { bonus: aura.bonus, name: row.id === characterId ? null : row.name };
  }
  return best;
}

export async function devotionAura(q: Queryable, campaignId: string, characterId: string): Promise<string | null> {
  const { ids, reaches } = await auraSurroundings(q, campaignId, characterId);
  const rows = (
    await q.query('SELECT id, name, level, class_name, sheet_extra FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[]) AND COALESCE(level, 0) >= 7', [campaignId, ids])
  ).rows as any[];
  for (const row of rows) {
    const aura = auraOfDevotion(characterClassLevels(row).classes);
    if (!aura || !(await reaches(row.id, aura.feet))) continue;
    return row.id === characterId ? 'аура преданности' : `аура преданности: ${row.name}`;
  }
  return null;
}
export async function courageAura(q: Queryable, campaignId: string, characterId: string): Promise<string | null> {
  const { ids, reaches } = await auraSurroundings(q, campaignId, characterId);
  const rows = (
    await q.query('SELECT id, name, level, class_name, sheet_extra FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[]) AND COALESCE(level, 0) >= 10', [campaignId, ids])
  ).rows as any[];
  for (const row of rows) {
    const aura = auraOfCourage(characterClassLevels(row).classes);
    if (!aura || !(await reaches(row.id, aura.feet))) continue;
    return row.id === characterId ? 'аура отваги' : `аура отваги: ${row.name}`;
  }
  return null;
}

export async function hasClassFeature(q: Queryable, campaignId: string, characterId: string, id: string) {
  const row = (await q.query('SELECT level, class_name, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
  return Boolean(row) && classFeaturesFor(characterClassLevels(row).classes).some(feature => feature.id === id);
}
export async function protectedFromEvil(q: Queryable, campaignId: string, characterId: string) {
  if ((await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='protected_from_evil' AND active`, [campaignId, characterId])).rows[0]) return true;
  return hasClassFeature(q, campaignId, characterId, 'purity-of-spirit');
}
export async function naturesSanctuaryDc(q: Queryable, campaignId: string, targetId: string, attackerId: string): Promise<number | null> {
  if (targetId === attackerId || !(await hasClassFeature(q, campaignId, targetId, 'natures-sanctuary'))) return null;
  const type = await creatureTypeOf(q, campaignId, attackerId);
  if (!type || !(NATURES_SANCTUARY_TYPES as readonly string[]).includes(type)) return null;
  const druid = (await q.query('SELECT level, wisdom, spell_save_dc_override FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0] as any;
  return druid.spell_save_dc_override ?? spellSaveDc(proficiencyBonusForLevel(Math.max(1, druid.level ?? 1)), abilityModifier(Number(druid.wisdom ?? 10)));
}
