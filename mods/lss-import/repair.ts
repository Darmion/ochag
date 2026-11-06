import type { Queryable } from '../../apps/server/src/db.ts';
import { legacyLssWeapon, lssWeapon, normalizeLssDamage } from './lss/weapons.ts';

export async function repairLssWeapons(q: Queryable): Promise<number> {
  const rows = (await q.query(
    `SELECT w.id, w.name, w.ability, w.attack_bonus, w.damage_formula, w.damage_type,
            c.strength, c.dexterity, c.sheet_extra->'weapons' AS raw_weapons, c.sheet_extra->'proficiency' AS proficiency
     FROM character_weapons w
     JOIN characters c ON c.campaign_id=w.campaign_id AND c.id=w.character_id
     WHERE c.sheet_extra->'sourceMetadata'->>'format' = 'long-story-short'
       AND jsonb_typeof(c.sheet_extra->'weapons') = 'array'`,
  )).rows as Array<{
    id: string; name: string; ability: string; attack_bonus: number; damage_formula: string | null; damage_type: string | null;
    strength: number | null; dexterity: number | null; raw_weapons: unknown[]; proficiency: unknown;
  }>;
  let fixed = 0;
  for (const row of rows) {
    const modifier = (ability: string) => Math.floor((((ability === 'dexterity' ? row.dexterity : row.strength) ?? 10) - 10) / 2);
    const profValue = typeof row.proficiency === 'object' && row.proficiency !== null ? (row.proficiency as any).value : row.proficiency;
    const proficiency = Number.isFinite(Number(profValue)) && Number(profValue) >= 0 && Number(profValue) <= 10 ? Number(profValue) : 2;
    const raw = row.raw_weapons.find(entry => legacyLssWeapon(entry, modifier, proficiency)?.name.toLowerCase() === row.name.toLowerCase());
    if (!raw) continue;
    const old = legacyLssWeapon(raw, modifier, proficiency)!;
    const fresh = lssWeapon(raw, modifier, proficiency)!;
    const sets: string[] = [];
    const values: unknown[] = [row.id];
    const put = (column: string, value: unknown) => { values.push(value); sets.push(`${column}=$${values.length}`); };
    if (row.attack_bonus === old.attackBonus && fresh.attackBonus !== old.attackBonus) put('attack_bonus', fresh.attackBonus);
    if (row.ability === old.ability && fresh.ability !== old.ability) put('ability', fresh.ability);
    const damage = normalizeLssDamage(fresh.damageFormula);
    if (row.damage_formula === null && old.damageFormula === null && damage) {
      put('damage_formula', damage);
      if (row.damage_type === null && fresh.damageType) put('damage_type', fresh.damageType);
    }
    if (!sets.length) continue;
    await q.query(`UPDATE character_weapons SET ${sets.join(', ')} WHERE id=$1`, values);
    fixed += 1;
  }
  return fixed;
}
