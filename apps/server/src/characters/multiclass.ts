import type { Queryable } from '../db.ts';
import type { ClassLevel } from '../../../../packages/domain/character/classes.ts';
import { multiclassSpellSlots } from '../../../../packages/domain/spells/spell-slots.ts';

export type PactSystem = 'merged' | 'separate' | 'manual';
export const PACT_SYSTEMS: PactSystem[] = ['merged', 'separate', 'manual'];

export async function pactSystem(q: Queryable, campaignId: string): Promise<PactSystem> {
  const row = (
    await q.query(`SELECT value FROM campaign_rules WHERE campaign_id=$1 AND key='pact_slots' AND kind='text'`, [campaignId])
  ).rows[0];
  return PACT_SYSTEMS.includes(row?.value) ? row.value : 'merged';
}

export function mixedPact(classes: ClassLevel[]) {
  const slots = multiclassSpellSlots(classes);
  return slots?.pact && slots.casters > 1 ? { ...slots, pact: slots.pact } : null;
}
