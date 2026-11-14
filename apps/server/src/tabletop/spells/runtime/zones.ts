import type { Queryable } from '../../../db.ts';
import type { Action } from '../../../../../../packages/domain/spells/spell-template.ts';
import type { ZonePlan } from '../../../../../../packages/domain/spells/spell-template-engine.ts';
import { relationsFor } from '../../../campaign/factions.ts';
import type { TableContext } from '../../context.ts';
import { emptyReport, runAction, type SpellRun } from './run.ts';
import type { StoredRun } from './timed.ts';

export type ZoneMoment = 'enter' | 'start' | 'end';
export type ZoneSpell = {
  run: StoredRun; actions: Action[]; difficult: boolean; follows?: boolean; spares?: boolean; drift?: number; templateId?: string;
  lastHit?: Record<string, string>;
};

const WHEN_AT: Record<ZoneMoment, readonly string[]> = {
  enter: ['zone-enter', 'zone-enter-or-start'], start: ['zone-start', 'zone-enter-or-start'], end: ['zone-end'],
};
const ONCE_A_TURN = new Set(['zone-enter', 'zone-enter-or-start']);

export function zoneSpellOf(run: SpellRun, zone: ZonePlan, templateId?: string): ZoneSpell {
  const { userId: _user, campaignId: _campaign, ...stored } = run;
  return {
    run: stored, actions: zone.actions, difficult: zone.difficult,
    ...(zone.follows ? { follows: true } : {}), ...(zone.spares ? { spares: true } : {}), ...(zone.drift > 0 ? { drift: zone.drift } : {}),
    ...(templateId ? { templateId } : {}),
  };
}

export const zoneFiresAt = (spell: ZoneSpell, moment: ZoneMoment) => spell.actions.some(action => WHEN_AT[moment].includes(action.when));

async function turnStamp(q: Queryable, campaignId: string, sceneId: string) {
  const current = (await q.query(
    `SELECT s.combat_round, string_agg(ie.id::text, ',' ORDER BY ie.id) AS current
     FROM scenes s LEFT JOIN initiative_entries ie ON ie.campaign_id=s.campaign_id AND ie.scene_id=s.id AND ie.is_current
     WHERE s.campaign_id=$1 AND s.id=$2 GROUP BY s.combat_round`,
    [campaignId, sceneId],
  )).rows[0];
  return current?.current ? `${current.combat_round}:${current.current}` : null;
}

export async function runZone(
  ctx: TableContext, q: Queryable, campaignId: string, userId: string,
  trigger: { id: string; scene_id?: string; spell: ZoneSpell }, sceneId: string, actor: { characterId: string; name: string }, moment: ZoneMoment,
) {
  const spell = trigger.spell;
  const actions = spell.actions.filter(action => WHEN_AT[moment].includes(action.when));
  if (!actions.length) return null;
  const casterId = spell.run.casterId;
  if (spell.spares && (actor.characterId === casterId || (await relationsFor(q, campaignId, [casterId, actor.characterId])).allies(casterId, actor.characterId))) return null;
  const stamp = await turnStamp(q, campaignId, sceneId);
  const lastHit = { ...(spell.lastHit ?? {}) };
  const report = emptyReport();
  const run: SpellRun = { ...spell.run, campaignId, userId, sceneId };
  for (const action of actions) {
    if (ONCE_A_TURN.has(action.when) && stamp && lastHit[`${action.id}:${actor.characterId}`] === stamp) continue;
    await runAction(ctx, q, run, action, [{ id: actor.characterId, name: actor.name }], report);
    if (ONCE_A_TURN.has(action.when) && stamp) lastHit[`${action.id}:${actor.characterId}`] = stamp;
  }
  await q.query('UPDATE scene_triggers SET spell=$2::jsonb WHERE id=$1', [trigger.id, JSON.stringify({ ...spell, lastHit })]);
  return { parts: [...report.lines.map(line => `${line.name}: ${line.text}.`), ...report.manual.map(text => `Вручную: ${text}.`)], report };
}
