import { randomInt } from 'node:crypto';
import type { Queryable } from '../../db.ts';
import { proficiencyOf, abilityModifier } from '../../../../../packages/domain/dice/dice.ts';
import type { FormulaContext } from '../../../../../packages/domain/dice/formula.ts';

export async function campaignFlag(q: Queryable, campaignId: string, key: string): Promise<boolean | null> {
  const row = (await q.query(`SELECT value FROM campaign_rules WHERE campaign_id=$1 AND key=$2 AND kind='flag'`, [campaignId, key])).rows[0];
  return row ? row.value === true : null;
}

export const DAMAGE_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
] as const;

export function rollDie(sides: number): number {
  return randomInt(1, sides + 1);
}

export async function insertRoll(
  q: Queryable,
  campaignId: string,
  userId: string,
  characterId: string | null,
  label: string | null,
  formula: string,
  results: number[],
  modifier: number,
  total: number,
  hidden: boolean,
  breakdown: unknown[] | null = null,
  outcome: Record<string, unknown> | null = null,
) {
  const inserted = await q.query(
    `INSERT INTO roll_log (
         campaign_id, user_id, character_id, label, formula,
         dice_results, modifier, total, hidden, breakdown, outcome
       )
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11::jsonb)
       RETURNING id, user_id, character_id, label, formula,
                 dice_results, modifier, total, hidden, breakdown, outcome, created_at`,
    [
      campaignId, userId, characterId, label, formula, JSON.stringify(results), modifier, total, hidden,
      breakdown ? JSON.stringify(breakdown) : null,
      outcome ? JSON.stringify(outcome) : null,
    ],
  );

  return inserted.rows[0];
}

export function characterFormulaContext(character: any): FormulaContext {
  const proficiencyBonus = proficiencyOf(character);

  return {
    str: abilityModifier(character.strength),
    dex: abilityModifier(character.dexterity),
    con: abilityModifier(character.constitution),
    int: abilityModifier(character.intelligence),
    wis: abilityModifier(character.wisdom),
    cha: abilityModifier(character.charisma),
    ...(proficiencyBonus !== null ? { prof: proficiencyBonus } : {}),
  };
}
