import type { Queryable } from '../../db.ts';

import type { TableContext } from '../context.ts';
import { notifyCampaign } from '../live/notify.ts';

export async function restInterruptionRule(q: Queryable, campaignId: string) {
  const value = (
    await q.query(`SELECT value FROM campaign_rules WHERE campaign_id=$1 AND key='rest_interruption' AND kind='text'`, [campaignId])
  ).rows[0]?.value;
  return value === 'any' ? 'any' : 'raw';
}

export async function interruptRest(q: Queryable, campaignId: string, sceneId: string, why: string) {
  await q.query(
    `UPDATE scenes SET rest = jsonb_set(rest, '{interrupted}', to_jsonb($3::text)), revision=revision+1 WHERE campaign_id=$1 AND id=$2 AND rest IS NOT NULL`,
    [campaignId, sceneId, why],
  );
}

export async function restMeetsCombat(ctx: TableContext, q: Queryable, campaignId: string, sceneId: string) {
  const rest = (await q.query('SELECT rest FROM scenes WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId])).rows[0]?.rest as any;
  if (!rest || rest.interrupted) return;
  if (rest.kind === 'short' || (await restInterruptionRule(q, campaignId)) === 'any') {
    await interruptRest(q, campaignId, sceneId, 'бой');
    void notifyCampaign(ctx, campaignId, {
      type: 'notice', title: 'Привал сорван', tone: 'info',
      detail: `Бой прервал ${rest.kind === 'short' ? 'короткий' : 'долгий'} отдых — пользы не будет; встаньте на привал заново.`,
    });
  } else {
    void notifyCampaign(ctx, campaignId, {
      type: 'notice', title: 'Бой посреди долгого отдыха', tone: 'info',
      detail: 'Меньше часа боя долгий отдых не прерывает — после боя его можно продолжить.',
    });
  }
}

export async function restAfterCombat(q: Queryable, campaignId: string, sceneId: string, minutes: number) {
  const rest = (await q.query('SELECT rest FROM scenes WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId])).rows[0]?.rest as any;
  if (!rest || rest.interrupted || rest.kind !== 'long') return;
  const strenuous = Number(rest.strenuousMinutes ?? 0) + minutes;
  await q.query(
    `UPDATE scenes SET rest = jsonb_set(rest, '{strenuousMinutes}', to_jsonb($3::int)) WHERE campaign_id=$1 AND id=$2`,
    [campaignId, sceneId, strenuous],
  );
  if (strenuous >= 60) await interruptRest(q, campaignId, sceneId, 'больше часа боя');
}
