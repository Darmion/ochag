import type { Queryable } from '../../../db.ts';
import { reject } from '../../shared.ts';

export async function spendCharge(q: Queryable, campaignId: string, characterId: string, name: string, recharge: 'short' | 'long', empty: string): Promise<number> {
  let charge = (
    await q.query(`SELECT id, current FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name=$3 FOR UPDATE`, [campaignId, characterId, name])
  ).rows[0] as { id: string; current: number } | undefined;
  if (!charge) {
    charge = (
      await q.query(`INSERT INTO character_resources (campaign_id, character_id, name, current, max, recharge) VALUES ($1,$2,$3,1,1,$4) RETURNING id, current`, [campaignId, characterId, name, recharge])
    ).rows[0] as { id: string; current: number };
  }
  if (Number(charge.current) <= 0) reject(400, empty);
  await q.query('UPDATE character_resources SET current=current-1 WHERE id=$1', [charge.id]);
  return Number(charge.current) - 1;
}
