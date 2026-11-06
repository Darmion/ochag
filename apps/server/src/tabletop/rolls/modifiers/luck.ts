import type { Queryable } from '../../../db.ts';
import { classResourceOf, LEGENDARY_RESISTANCE, syncLegendaryResistance } from '../../../rules/class-features.ts';
import { hasFeat } from '../../../../../../packages/domain/character/feats.ts';
import { classFeaturesFor } from '../../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../../packages/domain/character/classes.ts';
import type { TableContext } from '../../context.ts';
import { notifyCampaign } from '../../live/notify.ts';
import { rollDie } from '../dice.ts';

export async function luckyDefense(ctx: TableContext, q: Queryable, campaignId: string, targetId: string): Promise<{ die: number; left: number } | null> {
  const row = (await q.query('SELECT id, sheet_extra, auto_reactions FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0];
  if (!row || !(row.auto_reactions ?? []).includes('lucky')) return null;
  const left = await spendLuckPoint(ctx, q, campaignId, row);
  return left === null ? null : { die: rollDie(20), left };
}

export async function spendLuckPoint(ctx: TableContext, q: Queryable, campaignId: string, actor: any): Promise<number | null> {
  if (!hasFeat(actor.sheet_extra, 'lucky')) return null;
  let points = (
    await q.query(`SELECT id, current FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name='Очки удачи' FOR UPDATE`, [campaignId, actor.id])
  ).rows[0] as { id: string; current: number } | undefined;
  if (!points) {
    points = (
      await q.query(`INSERT INTO character_resources (campaign_id, character_id, name, current, max, recharge) VALUES ($1,$2,'Очки удачи',3,3,'long') RETURNING id, current`, [campaignId, actor.id])
    ).rows[0] as { id: string; current: number };
  }
  if (Number(points.current) <= 0) return null;
  await q.query('UPDATE character_resources SET current=current-1 WHERE id=$1', [points.id]);
  void notifyCampaign(ctx, campaignId, { type: 'character', characterId: actor.id });
  return Number(points.current) - 1;
}

export async function darkOnesOwnLuck(q: Queryable, campaignId: string, actor: any): Promise<number | null> {
  if (!classFeaturesFor(characterClassLevels(actor).classes).some(feature => feature.id === 'dark-ones-own-luck')) return null;
  const resource = await classResourceOf(q, campaignId, actor, 'Удача тёмного', true);
  if (!resource || resource.current <= 0) return null;
  await q.query('UPDATE character_resources SET current=current-1 WHERE id=$1', [resource.id]);
  return rollDie(10);
}

export async function useLegendaryResistance(q: Queryable, campaignId: string, actor: any): Promise<number | null> {
  const rule = (await q.query(`SELECT value FROM campaign_rules WHERE campaign_id=$1 AND key='legendary_resistance' AND kind='text'`, [campaignId])).rows[0]?.value;
  if (rule === 'manual') return null;
  const find = async () => (
    await q.query(`SELECT id, current FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name=$3 FOR UPDATE`, [campaignId, actor.id, LEGENDARY_RESISTANCE])
  ).rows[0] as { id: string; current: number } | undefined;
  let resource = await find();
  if (!resource) {
    await syncLegendaryResistance(q, campaignId, actor.id, Number(actor.legendary_resistances));
    resource = await find();
  }
  if (!resource || Number(resource.current) <= 0) return null;
  await q.query('UPDATE character_resources SET current=current-1 WHERE id=$1', [resource.id]);
  return Number(resource.current) - 1;
}
