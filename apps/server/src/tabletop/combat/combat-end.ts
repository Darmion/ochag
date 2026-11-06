import type { Queryable } from '../../db.ts';
import { endCombatMusic } from '../../campaign/audio-routes.ts';
import { relationsFor } from '../../campaign/factions.ts';
import { summarizeCombat } from '../../../../../packages/domain/combat/combat-summary.ts';
import { advanceWorldTime, announceTime } from '../../campaign/world-time.ts';

import { clearOpportunities } from './opportunity.ts';
import type { TableContext } from '../context.ts';
import { notifyCampaign } from '../live/notify.ts';
import { getScene } from '../scene/board.ts';
import { canManage, reject, sceneParams, type SceneParams } from '../shared.ts';
import { INITIATIVE_ORDER } from './initiative.ts';
import { restAfterCombat } from './combat-rest.ts';

export async function combatSummary(q: Queryable, campaignId: string, sceneId: string) {
  const scene = (
    await q.query('SELECT combat_started_at, combat_xp_start, combat_round FROM scenes WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId])
  ).rows[0] as any;
  if (!scene?.combat_started_at) return null;
  const entries = (
    await q.query(
      `SELECT ie.character_id, ie.name, c.kind, c.disposition, c.experience
         FROM initiative_entries ie LEFT JOIN characters c ON c.campaign_id=ie.campaign_id AND c.id=ie.character_id
         WHERE ie.campaign_id=$1 AND ie.scene_id=$2 AND ie.character_id IS NOT NULL
         ORDER BY ${INITIATIVE_ORDER}`,
      [campaignId, sceneId],
    )
  ).rows as any[];
  const rows = (
    await q.query(
      'SELECT character_id, outcome FROM roll_log WHERE campaign_id=$1 AND created_at >= $2 AND outcome IS NOT NULL',
      [campaignId, scene.combat_started_at],
    )
  ).rows as any[];
  const applications = (
    await q.query(
      `SELECT r.character_id, a.character_id AS target_id, a.mode, a.applied, a.dropped
         FROM roll_applications a JOIN roll_log r ON r.id = a.roll_id
         WHERE a.campaign_id=$1 AND a.applied_at >= $2 AND a.applied IS NOT NULL`,
      [campaignId, scene.combat_started_at],
    )
  ).rows as any[];
  for (const row of applications) {
    rows.push({
      character_id: row.character_id,
      outcome: row.mode === 'heal'
        ? { kind: 'heal', targets: [{ id: row.target_id, healed: row.applied }] }
        : { kind: 'damage', target: { id: row.target_id }, applied: row.applied, dropped: row.dropped === true },
    });
  }
  const events = (
    await q.query(
      `SELECT actor_id, target_id, kind, amount, dropped, source FROM combat_events
         WHERE campaign_id=$1 AND scene_id=$2 AND created_at >= $3`,
      [campaignId, sceneId, scene.combat_started_at],
    )
  ).rows as Array<{ actor_id: string | null; target_id: string; kind: 'damage' | 'heal'; amount: number; dropped: boolean; source: string }>;
  const sources: Record<string, number> = { trap: 0, zone: 0, hazard: 0, manual: 0 };
  for (const event of events) {
    rows.push({
      character_id: event.actor_id,
      outcome: event.kind === 'heal'
        ? { kind: 'heal', targets: [{ id: event.target_id, healed: event.amount }] }
        : { kind: 'damage', target: { id: event.target_id }, applied: event.amount, dropped: event.dropped },
    });
    if (event.kind === 'damage') sources[event.source] = (sources[event.source] ?? 0) + event.amount;
  }
  const stats = summarizeCombat(rows);
  const xpStart = scene.combat_xp_start ?? {};
  const sides = await relationsFor(q, campaignId, entries.map(entry => entry.character_id));
  const participants = entries.map(entry => {
    const line = stats.get(entry.character_id) ?? { damageDealt: 0, damageTaken: 0, hits: 0, misses: 0, crits: 0, kills: 0, healing: 0 };
    const withParty = sides.withParty(entry.character_id);
    const side = withParty === 'ally' ? 'party' : withParty === 'enemy' ? 'enemy' : 'neutral';
    const experience = entry.kind === 'character' && typeof xpStart[entry.character_id] === 'number'
      ? Math.max(0, Number(entry.experience ?? 0) - xpStart[entry.character_id]) : null;
    return { ...line, characterId: entry.character_id, name: entry.name, side, experience };
  });
  return {
    sceneId, rounds: scene.combat_round, startedAt: scene.combat_started_at, endedAt: new Date().toISOString(), participants,
    unrolled: sources,
  };
}

export function registerCombatEndRoutes(ctx: TableContext) {
  const { app, auth, db, feature, membership } = ctx;

  app.get<{ Params: SceneParams }>(
    '/campaigns/:campaignId/scenes/:sceneId/combat-summary',
    { schema: { params: sceneParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      await membership(db, campaignId, userId);
      await getScene(db, campaignId, sceneId, false);
      const row = (await db.query('SELECT last_combat_summary FROM scenes WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId])).rows[0] as any;
      return { summary: row?.last_combat_summary ?? null };
    },
  );

  app.delete<{ Params: SceneParams }>(
    '/campaigns/:campaignId/scenes/:sceneId/initiative',
    { schema: { params: sceneParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;

      let clock: number | null = null;
      let musicBack = false;
      const ended = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        if (!(await canManage(q, member, userId))) {
          reject(403, 'Завершить бой может только мастер.');
        }

        const scene = await getScene(q, campaignId, sceneId);
        const summary = await combatSummary(q, campaignId, sceneId);
        if (await endCombatMusic(q, campaignId, userId)) musicBack = true;
        if (summary) {
          const minutes = Math.ceil(Number(summary.rounds ?? scene.combat_round ?? 1) / 10);
          clock = await advanceWorldTime(q, campaignId, minutes);
          await restAfterCombat(q, campaignId, sceneId, minutes);
        }

        await q.query(
          'DELETE FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2',
          [campaignId, sceneId],
        );
        await q.query(
          `UPDATE scenes SET combat_round=1, combat_started_at=NULL, combat_xp_start=NULL,
             last_combat_summary = COALESCE($2::jsonb, last_combat_summary)
           WHERE id=$1`,
          [sceneId, summary ? JSON.stringify(summary) : null],
        );
        if (summary) {
          await q.query('INSERT INTO combat_records (campaign_id, scene_id, summary) VALUES ($1,$2,$3::jsonb)', [campaignId, sceneId, JSON.stringify(summary)]);
        }
        await clearOpportunities(q, campaignId, sceneId);
        return summary;
      });

      void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
      if (ended) void notifyCampaign(ctx, campaignId, { type: 'combatSummary', sceneId, summary: ended });
      if (clock !== null) announceTime(feature, campaignId, clock);
      if (musicBack) void notifyCampaign(ctx, campaignId, { type: 'audio' });

      return reply.code(204).send();
    },
  );
}
