import type { Queryable } from '../../../db.ts';
import type { Action } from '../../../../../../packages/domain/spells/spell-template.ts';
import type { Notice } from '../../../rules/conditions.ts';
import type { TableContext } from '../../context.ts';
import { emptyReport, runAction, type RunReport, type SpellRun } from './run.ts';

export type StoredRun = Omit<SpellRun, 'userId' | 'campaignId'>;

const stored = (run: SpellRun): StoredRun => {
  const { userId: _user, campaignId: _campaign, ...rest } = run;
  return rest;
};

export async function storeTimed(q: Queryable, run: SpellRun, actions: Action[], targetIds: string[]) {
  let count = 0;
  for (const action of actions) {
    const moment = action.when === 'target-turn-end' ? 'end' : 'start';
    const holders = action.when === 'caster-turn-start' ? [run.casterId] : targetIds;
    const left = action.times === 'count' ? Math.max(1, action.timesCount) : action.times === 'spell' ? 1 : null;
    const until = run.concentration ? { concentrationOf: run.casterId } : run.durationRounds ? { remainingRounds: run.durationRounds, durationRounds: run.durationRounds } : {};
    for (const holder of holders) {
      await q.query(
        `INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'spell_action',$3::jsonb)`,
        [run.campaignId, holder, JSON.stringify({
          source: 'spell', sourceCharacterId: run.casterId, sourceName: run.spellName, spellName: run.spellName, spellLevel: run.slotLevel,
          moment, run: stored(run), action, ...(action.when === 'caster-turn-start' ? { targets: targetIds } : {}), left, ...until,
        })],
      );
      count += 1;
    }
  }
  return count;
}

export async function runTimed(ctx: TableContext, q: Queryable, campaignId: string, userId: string, characterId: string, moment: 'start' | 'end') {
  const rows = (await q.query(
    `SELECT id, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='spell_action' AND active AND parameters->>'moment'=$3 ORDER BY id`,
    [campaignId, characterId, moment],
  )).rows as Array<{ id: string; parameters: any }>;
  const report: RunReport = emptyReport();
  const notices: Notice[] = [];
  for (const row of rows) {
    const p = row.parameters ?? {};
    if (!p.run || !p.action) continue;
    const run: SpellRun = { ...p.run, campaignId, userId };
    const ids = Array.isArray(p.targets) ? p.targets.filter((id: unknown): id is string => typeof id === 'string') : [characterId];
    const targets = ids.length
      ? (await q.query('SELECT id, name FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, ids])).rows as Array<{ id: string; name: string }>
      : [];
    const before = report.lines.length;
    await runAction(ctx, q, run, p.action as Action, targets, report);
    for (const line of report.lines.slice(before)) {
      notices.push({ title: `«${run.spellName}»: ${line.name}`, detail: line.text, characterId: line.characterId });
    }
    if (typeof p.left === 'number') {
      if (p.left <= 1) await q.query('DELETE FROM character_effects WHERE id=$1', [row.id]);
      else await q.query('UPDATE character_effects SET parameters=$2::jsonb WHERE id=$1', [row.id, JSON.stringify({ ...p, left: p.left - 1 })]);
    }
  }
  for (const text of report.manual) notices.push({ title: 'Примените вручную', detail: text });
  return { notices, report };
}
