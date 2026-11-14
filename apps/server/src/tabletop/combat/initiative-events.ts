import type { Queryable } from '../../db.ts';
import { insertChatMessage } from '../../campaign/chat-routes.ts';
import { loadConditionState } from '../../rules/conditions.ts';
import { incapacitatedReason } from '../../../../../packages/domain/combat/conditions.ts';
import {
  EVENT_KINDS, EVENT_LABELS, eventEntryName, eventOf, freeOptions, type EventKind, type TurnEvent,
} from '../../../../../packages/domain/combat/initiative-events.ts';

import { deadCreatures } from './loot-routes.ts';
import type { TableContext } from '../context.ts';
import { notifyCampaign } from '../live/notify.ts';
import { rollDie } from '../rolls/dice.ts';
import { getScene } from '../scene/board.ts';
import { canManage, initiativeParams, type InitiativeParams, objectSchema, reject } from '../shared.ts';

// Keeps the initiative slots of a creature's events (a lair) in step with its sheet in one scene.
export async function syncTurnEvents(q: Queryable, campaignId: string, sceneId: string, characterId: string) {
  const main = (
    await q.query(
      `SELECT ie.created_by, c.name, c.turn_events FROM initiative_entries ie
         JOIN characters c ON c.campaign_id = ie.campaign_id AND c.id = ie.character_id
        WHERE ie.campaign_id=$1 AND ie.scene_id=$2 AND ie.character_id=$3`,
      [campaignId, sceneId, characterId],
    )
  ).rows[0] as { created_by: string; name: string; turn_events: unknown } | undefined;
  const existing = (
    await q.query('SELECT id, event_kind, is_current FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND event_of=$3', [campaignId, sceneId, characterId])
  ).rows as Array<{ id: string; event_kind: string; is_current: boolean }>;
  for (const kind of EVENT_KINDS) {
    const event = main ? eventOf(main.turn_events, kind) : null;
    const wanted = Boolean(event?.active && event.options.length);
    const entry = existing.find(row => row.event_kind === kind);
    if (wanted && event && main) {
      const name = eventEntryName(main.name, kind);
      if (entry) {
        await q.query('UPDATE initiative_entries SET name=$2, score=$3, tie_rank=$4 WHERE id=$1', [entry.id, name, event.rules.score, event.rules.tieRank]);
      } else {
        await q.query(
          `INSERT INTO initiative_entries (campaign_id, scene_id, character_id, name, score, created_by, event_of, event_kind, tie_rank)
           VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8)`,
          [campaignId, sceneId, name, event.rules.score, main.created_by, characterId, kind, event.rules.tieRank],
        );
      }
    } else if (entry && !entry.is_current) {
      await q.query('DELETE FROM initiative_entries WHERE id=$1', [entry.id]);
    }
  }
}

export async function syncTurnEventsEverywhere(q: Queryable, campaignId: string, characterId: string) {
  const scenes = (
    await q.query('SELECT DISTINCT scene_id FROM initiative_entries WHERE campaign_id=$1 AND (character_id=$2 OR event_of=$2)', [campaignId, characterId])
  ).rows.map(row => row.scene_id as string);
  for (const sceneId of scenes) await syncTurnEvents(q, campaignId, sceneId, characterId);
  return scenes;
}

type EventEntry = { id: string; is_current: boolean; event_of: string; event_kind: EventKind; event_last: string | null; owner: string; turn_events: unknown };

async function eventEntry(q: Queryable, campaignId: string, sceneId: string, entryId: string | null) {
  return (
    await q.query(
      `SELECT ie.id, ie.is_current, ie.event_of, ie.event_kind, ie.event_last, c.name AS owner, c.turn_events
         FROM initiative_entries ie JOIN characters c ON c.campaign_id = ie.campaign_id AND c.id = ie.event_of
        WHERE ie.campaign_id=$1 AND ie.scene_id=$2 AND ${entryId ? 'ie.id=$3' : 'ie.is_current'} AND ie.event_of IS NOT NULL
        FOR UPDATE OF ie`,
      entryId ? [campaignId, sceneId, entryId] : [campaignId, sceneId],
    )
  ).rows[0] as EventEntry | undefined;
}

async function silenceReason(q: Queryable, campaignId: string, ownerId: string) {
  const row = (await q.query('SELECT hp_current FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, ownerId])).rows[0];
  if ((await deadCreatures(q, campaignId, [ownerId])).has(ownerId) || Number(row?.hp_current ?? 0) <= 0) return 'хозяин повержен';
  return incapacitatedReason(await loadConditionState(q, campaignId, ownerId));
}

// Uses one option of the current event slot: no repeat when the rules say so, a line in the chat, the slot remembers it.
export async function useEventOption(q: Queryable, campaignId: string, userId: string, entry: EventEntry, index: number) {
  const event = eventOf(entry.turn_events, entry.event_kind) as TurnEvent | null;
  if (!event || !event.options.length) reject(400, `У «${entry.owner}» нет вариантов для этого хода — их задают в окне «Босс».`);
  if (!entry.is_current) reject(400, 'Это действие совершается в свой ход очереди инициативы.');
  const silent = await silenceReason(q, campaignId, entry.event_of);
  if (silent) reject(400, `${EVENT_LABELS[entry.event_kind]} молчит: ${entry.owner} — ${silent}.`);
  const option = event.options[index];
  if (!option) reject(400, 'Такого варианта нет.');
  if (!freeOptions(event, entry.event_last).includes(index)) reject(400, `«${option.name}» было в прошлом раунде — выберите другое действие.`);
  await q.query('UPDATE initiative_entries SET event_last=$2 WHERE id=$1', [entry.id, option.name]);
  const message = await insertChatMessage(q, campaignId, userId, {
    characterId: entry.event_of, body: `${EVENT_LABELS[entry.event_kind]} «${entry.owner}»: ${option.name}${option.text ? ` — ${option.text}` : ''}`,
  });
  return { option, message };
}

function announce(ctx: TableContext, campaignId: string, sceneId: string, entry: EventEntry, used: { option: { name: string; text: string }; message: unknown }) {
  void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
  void notifyCampaign(ctx, campaignId, { type: 'chat', message: used.message });
  void notifyCampaign(ctx, campaignId, { type: 'float', characterId: entry.event_of, text: used.option.name, tone: 'crit' });
}

// «Авто-ход» on an event slot: a random option among the allowed ones; a silent owner just passes the slot.
export async function autoEvent(ctx: TableContext, campaignId: string, sceneId: string, userId: string) {
  const { db, membership } = ctx;
  const result = await db.transaction(async q => {
    const entry = await eventEntry(q, campaignId, sceneId, null);
    if (!entry) return null;
    const member = await membership(q, campaignId, userId, true);
    if (!(await canManage(q, member, userId))) reject(403, 'Ход логова ведёт мастер.');
    const label = EVENT_LABELS[entry.event_kind];
    const silent = await silenceReason(q, campaignId, entry.event_of);
    if (silent) return { entry, used: null, summary: `${label} молчит: ${entry.owner} — ${silent}` };
    const event = eventOf(entry.turn_events, entry.event_kind);
    const free = event ? freeOptions(event, entry.event_last) : [];
    if (!free.length) return { entry, used: null, summary: `${label}: вариантов нет` };
    const used = await useEventOption(q, campaignId, userId, entry, free[rollDie(free.length) - 1]!);
    return { entry, used, summary: `${used.option.name}${used.option.text ? ` — ${used.option.text}` : ''}` };
  });
  if (result?.used) announce(ctx, campaignId, sceneId, result.entry, result.used);
  return result ? { entryId: result.entry.id, owner: { id: result.entry.event_of, name: result.entry.owner }, option: result.used?.option ?? null, summary: result.summary } : null;
}

export function registerInitiativeEventRoutes(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.post<{ Params: InitiativeParams; Body: { option: number } }>(
    '/campaigns/:campaignId/scenes/:sceneId/initiative/:entryId/event',
    { schema: { params: initiativeParams, body: objectSchema({ option: { type: 'integer', minimum: 0, maximum: 9 } }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId, entryId } = request.params;
      const { entry, used } = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Ход логова ведёт мастер.');
        await getScene(q, campaignId, sceneId);
        const entry = await eventEntry(q, campaignId, sceneId, entryId);
        if (!entry) reject(404, 'Такого хода события в инициативе нет.');
        return { entry, used: await useEventOption(q, campaignId, userId, entry, request.body.option) };
      });
      announce(ctx, campaignId, sceneId, entry, used);
      return { option: used.option, summary: `${used.option.name}${used.option.text ? ` — ${used.option.text}` : ''}` };
    },
  );
}
