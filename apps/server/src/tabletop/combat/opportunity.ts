import type { Queryable } from '../../db.ts';
import { hasFeat, isPolearm } from '../../../../../packages/domain/character/feats.ts';
import { deadCreatures } from './loot-routes.ts';
import { placementFactions, placementsHostile, placementsRestricted } from '../../campaign/factions.ts';
import { loadConditionState } from '../../rules/conditions.ts';
import { reactionBlocked } from '../../../../../packages/domain/combat/conditions.ts';

import type { TableContext } from '../context.ts';
import { notifyCampaign } from '../live/notify.ts';
import { campaignFlag } from '../rolls/dice.ts';
import { rollCheckAs } from '../rolls/roll-check.ts';
import { feetBetween, getScene } from '../scene/board.ts';
import { loadPlacements } from '../scene/placements.ts';

export type OpportunityReason = 'leave' | 'sentinel' | 'mage-slayer';
export type Opportunity = { sceneId: string; moverId: string; moverName: string; reactorId: string; reactorName: string; weaponId: string | null; reason: OpportunityReason };

export async function clearOpportunities(q: Queryable, campaignId: string, sceneId: string) {
  await q.query('DELETE FROM scene_opportunities WHERE campaign_id=$1 AND scene_id=$2', [campaignId, sceneId]);
}

export async function takeOpportunity(q: Queryable, campaignId: string, sceneId: string, reactorId: string, moverId: string): Promise<Opportunity | undefined> {
  const row = (
    await q.query(
      `DELETE FROM scene_opportunities WHERE campaign_id=$1 AND scene_id=$2 AND reactor_id=$3 AND mover_id=$4
         RETURNING scene_id, mover_id, mover_name, reactor_id, reactor_name, weapon_id, reason`,
      [campaignId, sceneId, reactorId, moverId],
    )
  ).rows[0] as any;
  return row
    ? { sceneId: row.scene_id, moverId: row.mover_id, moverName: row.mover_name, reactorId: row.reactor_id, reactorName: row.reactor_name, weaponId: row.weapon_id, reason: row.reason }
    : undefined;
}

export async function detectOpportunities(
  q: Queryable, campaignId: string, scene: any, moverCharacterId: string,
  from: { x: number; z: number }, to: { x: number; z: number },
): Promise<Opportunity[]> {
  if (from.x === to.x && from.z === to.z) return [];
  if ((await campaignFlag(q, campaignId, 'opportunity_attacks')) === false) return [];
  const entries = (
    await q.query(
      'SELECT character_id, is_current, reaction_used, disengaged, turn_flags FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id IS NOT NULL',
      [campaignId, scene.id],
    )
  ).rows as Array<{ character_id: string; is_current: boolean; reaction_used: boolean; disengaged: boolean; turn_flags: string[] | null }>;
  const mine = entries.find(entry => entry.character_id === moverCharacterId);
  if (!mine?.is_current) return [];
  const disengaged = mine.disengaged;

  const placements = await loadPlacements(q, campaignId, scene.id);
  const mover = placements.find(entry => entry.character_id === moverCharacterId && !entry.parent_object_id);
  if (!mover || !placementFactions(mover).length) return [];
  const ready = new Map(entries.filter(entry => !entry.reaction_used).map(entry => [entry.character_id, entry]));
  const reactors = placements.filter(entry =>
    entry.id !== mover.id && !entry.parent_object_id && ready.has(entry.character_id) && placementsHostile(entry, mover) && !placementsRestricted(entry, mover, 'no-opportunity'));
  const fallen = await deadCreatures(q, campaignId, reactors.map(entry => entry.character_id));
  const found: Opportunity[] = [];
  for (const reactor of reactors) {
    if (fallen.has(reactor.character_id)) continue;
    if ((mine.turn_flags ?? []).includes(`mobile:${reactor.character_id}`)) continue;
    const reactorExtra = (await q.query('SELECT sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, reactor.character_id])).rows[0]?.sheet_extra;
    if (disengaged && !hasFeat(reactorExtra, 'sentinel')) continue;
    if (reactionBlocked(await loadConditionState(q, campaignId, reactor.character_id))) continue;
    const weapon = (
      await q.query(
        `SELECT id, range_feet FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND weapon_kind='melee'
           ORDER BY range_feet DESC, name LIMIT 1`,
        [campaignId, reactor.character_id],
      )
    ).rows[0] as { id: string; range_feet: number } | undefined;
    const reach = Number(weapon?.range_feet ?? 5);
    const before = feetBetween(scene, { ...mover, world_x: from.x, world_z: from.z }, reactor);
    const after = feetBetween(scene, { ...mover, world_x: to.x, world_z: to.z }, reactor);
    const polearm = hasFeat(reactorExtra, 'polearm-master')
      ? ((await q.query(`SELECT id, name, srd_index, range_feet FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND weapon_kind='melee' ORDER BY range_feet DESC, name`, [campaignId, reactor.character_id]))
        .rows as Array<{ id: string; name: string; srd_index: string | null; range_feet: number }>).find(item => isPolearm(item)) ?? null
      : null;
    const polearmReach = Number(polearm?.range_feet ?? 5);
    const entering = Boolean(polearm) && before > polearmReach && after <= polearmReach;
    if ((before <= reach && after > reach) || entering) {
      const weaponId = entering ? polearm!.id : weapon?.id ?? null;
      const entry = { sceneId: scene.id, moverId: mover.character_id, moverName: mover.name, reactorId: reactor.character_id, reactorName: reactor.name, weaponId, reason: 'leave' as const };
      await saveOpportunity(q, campaignId, entry);
      found.push(entry);
    }
  }
  return found;
}

export async function saveOpportunity(q: Queryable, campaignId: string, entry: Opportunity) {
  await q.query(
    `INSERT INTO scene_opportunities (campaign_id, scene_id, reactor_id, mover_id, reactor_name, mover_name, weapon_id, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (scene_id, reactor_id, mover_id)
       DO UPDATE SET reactor_name=EXCLUDED.reactor_name, mover_name=EXCLUDED.mover_name, weapon_id=EXCLUDED.weapon_id, reason=EXCLUDED.reason, created_at=now()`,
    [campaignId, entry.sceneId, entry.reactorId, entry.moverId, entry.reactorName, entry.moverName, entry.weaponId, entry.reason],
  );
}

export async function reactionAttackers(
  q: Queryable, campaignId: string, sceneId: string, actorId: string, reason: 'sentinel' | 'mage-slayer', targetIds: string[] = [],
): Promise<Opportunity[]> {
  if (reason === 'sentinel') {
    for (const id of targetIds) {
      if (hasFeat((await q.query('SELECT sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, id])).rows[0]?.sheet_extra, 'sentinel')) return [];
    }
  }
  const ready = new Set(
    (await q.query('SELECT character_id FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id IS NOT NULL AND NOT reaction_used', [campaignId, sceneId])).rows
      .map(entry => String(entry.character_id)),
  );
  if (!ready.size) return [];
  const scene = await getScene(q, campaignId, sceneId, false);
  const placements = await loadPlacements(q, campaignId, sceneId);
  const actor = placements.find(entry => entry.character_id === actorId && !entry.parent_object_id);
  if (!actor || !placementFactions(actor).length) return [];
  const near = placements.filter(entry =>
    entry.id !== actor.id && !entry.parent_object_id && ready.has(entry.character_id) && !targetIds.includes(entry.character_id)
    && placementsHostile(entry, actor) && feetBetween(scene, actor, entry) <= 5);
  const fallen = await deadCreatures(q, campaignId, near.map(entry => entry.character_id));
  const found: Opportunity[] = [];
  for (const reactor of near) {
    if (fallen.has(reactor.character_id)) continue;
    const extra = (await q.query('SELECT sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, reactor.character_id])).rows[0]?.sheet_extra;
    if (!hasFeat(extra, reason)) continue;
    if (reactionBlocked(await loadConditionState(q, campaignId, reactor.character_id))) continue;
    const weapon = (
      await q.query(`SELECT id FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND weapon_kind='melee' ORDER BY range_feet DESC, name LIMIT 1`, [campaignId, reactor.character_id])
    ).rows[0] as { id: string } | undefined;
    if (!weapon) continue;
    const entry: Opportunity = { sceneId, moverId: actor.character_id, moverName: actor.name, reactorId: reactor.character_id, reactorName: reactor.name, weaponId: weapon.id, reason };
    await saveOpportunity(q, campaignId, entry);
    found.push(entry);
  }
  return found;
}

export function announceOpportunities(ctx: TableContext, campaignId: string, found: Opportunity[]) {
  if (!found.length) return;
  void notifyCampaign(ctx, campaignId, {
    type: 'opportunity', sceneId: found[0]!.sceneId, moverId: found[0]!.moverId, moverName: found[0]!.moverName, reason: found[0]!.reason,
    reactors: found.map(entry => ({ characterId: entry.reactorId, name: entry.reactorName, weaponId: entry.weaponId })),
  });
}

export async function settleOpportunities(ctx: TableContext, campaignId: string, found: Opportunity[]) {
  const { db } = ctx;
  if (!found.length) return;
  const left: Opportunity[] = [];
  try {
    const auto = (await campaignFlag(db, campaignId, 'npc_opportunity')) !== false;
    const owner = (await db.query('SELECT owner_user_id FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.owner_user_id as string;
    for (const entry of found) {
      const kind = auto && entry.weaponId ? (await db.query('SELECT kind FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, entry.reactorId])).rows[0]?.kind : null;
      if (kind !== 'npc') {
        left.push(entry);
        continue;
      }
      try {
        const done: any = await rollCheckAs(ctx, owner, campaignId, {
          characterId: entry.reactorId, kind: 'attack', key: entry.weaponId!, targetCharacterId: entry.moverId, sceneId: entry.sceneId, opportunity: true,
        });
        const hit = done.outcome?.hit;
        const what = entry.reason === 'sentinel' ? ['«Часовой»', 'бьёт другого рядом'] : entry.reason === 'mage-slayer' ? ['«Убийца магов»', 'колдует рядом'] : ['атака при уходе', 'уходит из досягаемости'];
        void notifyCampaign(ctx, campaignId, {
          type: 'notice', title: `${entry.reactorName}: ${what[0]}`, tone: 'info',
          detail: `«${entry.moverName}» ${what[1]} — ${hit ? `попадание${done.damage ? `, ${done.damage.applied} урона` : ''}` : 'промах'}.`,
        });
      } catch {
        left.push(entry);
      }
    }
  } catch {
    left.push(...found.filter(entry => !left.includes(entry)));
  }
  announceOpportunities(ctx, campaignId, left);
}
