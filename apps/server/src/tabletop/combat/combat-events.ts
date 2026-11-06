import type { Queryable } from '../../db.ts';

export type CombatEvent = {
  targetId: string;
  actorId?: string | null;
  kind: 'damage' | 'heal';
  amount: number;
  dropped?: boolean;
  source: 'trap' | 'zone' | 'hazard' | 'manual';
};

export async function recordCombatEvent(q: Queryable, campaignId: string, event: CombatEvent) {
  if (!(event.amount > 0)) return;
  const fight = (
    await q.query(
      `SELECT ie.scene_id FROM initiative_entries ie JOIN scenes s ON s.id = ie.scene_id
       WHERE ie.campaign_id=$1 AND ie.character_id=$2 AND s.combat_started_at IS NOT NULL LIMIT 1`,
      [campaignId, event.targetId],
    )
  ).rows[0] as { scene_id: string } | undefined;
  if (!fight) return;
  await q.query(
    `INSERT INTO combat_events (campaign_id, scene_id, actor_id, target_id, kind, amount, dropped, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [campaignId, fight.scene_id, event.actorId ?? null, event.targetId, event.kind, Math.round(event.amount), event.dropped === true, event.source],
  );
}
