import type { Queryable } from '../../db.ts';
import { mixedPact, pactSystem } from '../multiclass.ts';
import { applySpellRefs } from '../spell-refs.ts';
import { parseClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { normalizeStructure } from '../../../../../packages/importer/proposal.ts';

export async function applyStructure(q: Queryable, campaignId: string, characterId: string, raw: unknown, sheetExtra?: unknown) {
  if (raw === undefined || raw === null) return;
  const structure = normalizeStructure(raw);

  if (structure.spellSaveDc !== null || structure.spellAttack !== null) {
    await q.query(
      `UPDATE characters SET spell_save_dc_override = COALESCE($3, spell_save_dc_override), spell_attack_override = COALESCE($4, spell_attack_override)
       WHERE campaign_id=$1 AND id=$2`,
      [campaignId, characterId, structure.spellSaveDc, structure.spellAttack],
    );
  }

  await q.query(
    `UPDATE characters SET
       class_name = COALESCE($3, class_name),
       level = COALESCE($4, level),
       experience = COALESCE($5, experience),
       hit_die = COALESCE($6, hit_die),
       spellcasting_ability = COALESCE($7, spellcasting_ability)
     WHERE campaign_id=$1 AND id=$2`,
    [campaignId, characterId, structure.className, structure.level, structure.experience, structure.hitDie, structure.spellcastingAbility],
  );

  if (structure.skills.length) {
    await q.query('DELETE FROM character_skills WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId]);
    for (const skill of structure.skills) {
      await q.query(
        'INSERT INTO character_skills (campaign_id, character_id, skill_index, proficient, expertise) VALUES ($1,$2,$3,$4,$5)',
        [campaignId, characterId, skill.index, skill.proficient, skill.expertise],
      );
    }
  }

  if (structure.saves.length) {
    for (const ability of ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']) {
      await q.query(
        `INSERT INTO character_saves (campaign_id, character_id, ability, proficient) VALUES ($1,$2,$3,$4)
         ON CONFLICT (campaign_id, character_id, ability) DO UPDATE SET proficient=EXCLUDED.proficient`,
        [campaignId, characterId, ability, structure.saves.includes(ability)],
      );
    }
  }

  const existingWeapons = new Set(
    (await q.query('SELECT lower(name) AS name FROM character_weapons WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId])).rows.map(row => row.name),
  );
  for (const weapon of structure.weapons) {
    if (existingWeapons.has(weapon.name.toLowerCase())) continue;
    await q.query(
      `INSERT INTO character_weapons (campaign_id, character_id, name, ability, proficient, damage_formula, damage_type, attack_bonus)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [campaignId, characterId, weapon.name, weapon.ability, weapon.proficient, weapon.damageFormula, weapon.damageType, weapon.attackBonus],
    );
  }

  const slots = new Map(structure.spellSlots.map(slot => [slot.level, { ...slot }]));
  const pact = structure.pactSlots;
  if (pact) {
    const separate = (await pactSystem(q, campaignId)) === 'separate' && Boolean(mixedPact(parseClassLevels(structure.className, structure.level).classes));
    if (separate) {
      await q.query(
        'UPDATE characters SET pact_slots_max=$3, pact_slots_current=$4, pact_slot_level=$5 WHERE campaign_id=$1 AND id=$2',
        [campaignId, characterId, pact.max, pact.current, pact.level],
      );
    } else {
      const same = slots.get(pact.level);
      slots.set(pact.level, same
        ? { level: pact.level, max: same.max + pact.max, current: same.current + pact.current }
        : { ...pact });
    }
  }

  for (const slot of slots.values()) {
    await q.query(
      `INSERT INTO character_spell_slots (campaign_id, character_id, level, current, max) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (campaign_id, character_id, level) DO UPDATE SET max=EXCLUDED.max, current=LEAST(EXCLUDED.current, EXCLUDED.max)`,
      [campaignId, characterId, slot.level, slot.current, slot.max],
    );
  }

  const existingResources = new Set(
    (await q.query('SELECT lower(name) AS name FROM character_resources WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId])).rows.map(row => row.name),
  );
  for (const resource of structure.resources) {
    if (existingResources.has(resource.name.toLowerCase())) continue;
    await q.query(
      'INSERT INTO character_resources (campaign_id, character_id, name, current, max) VALUES ($1,$2,$3,$4,$5)',
      [campaignId, characterId, resource.name, resource.current, resource.max],
    );
  }

  await applySpellRefs(q, campaignId, characterId, sheetExtra ?? { importedStructure: raw });
}
