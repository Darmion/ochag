import type { Queryable } from '../../../db.ts';
import type { Action, Command } from '../../../../../../packages/domain/spells/spell-template.ts';
import { removeCondition, spellsEnded } from '../../../rules/conditions.ts';
import type { TableContext } from '../../context.ts';
import { announceHpChange } from '../../combat/hp.ts';
import { notify, notifyCampaign } from '../../live/notify.ts';
import { getScene } from '../../scene/board.ts';
import { controls, rightsOf } from '../../scene/placements.ts';
import { canManage, objectSchema, reject, uuid } from '../../shared.ts';
import { emptyReport, runAction, type RunReport, type SpellRun } from './run.ts';
import type { StoredRun } from './timed.ts';

export type SpellCast = {
  source: 'spell'; sourceCharacterId: string; sourceName: string; spellName: string;
  run: StoredRun; commands: Command[]; actions: Action[]; onEnd: Action[];
  targets: string[]; zoneIds: string[]; templateIds: string[]; wallIds?: string[]; castStamp: string | null;
  uses: Record<string, { stamp: string | null; round: number | null; count: number }>;
};

async function turnStamp(q: Queryable, campaignId: string, sceneId: string | null) {
  if (!sceneId) return { stamp: null as string | null, round: null as number | null, current: new Set<string>() };
  const rows = (await q.query(
    `SELECT s.combat_round, ie.id, ie.character_id FROM scenes s
     LEFT JOIN initiative_entries ie ON ie.campaign_id=s.campaign_id AND ie.scene_id=s.id AND ie.is_current
     WHERE s.campaign_id=$1 AND s.id=$2 ORDER BY ie.id`,
    [campaignId, sceneId],
  )).rows as Array<{ combat_round: number; id: string | null; character_id: string | null }>;
  const ids = rows.filter(row => row.id).map(row => row.id);
  return {
    stamp: ids.length ? `${rows[0]!.combat_round}:${ids.join(',')}` : null,
    round: ids.length ? Number(rows[0]!.combat_round) : null,
    current: new Set(rows.map(row => row.character_id).filter((id): id is string => Boolean(id))),
  };
}

export async function storeSpellCast(
  q: Queryable, run: SpellRun, template: { commands: Command[]; actions: Action[]; options: { modes: Array<{ actions: Action[] }> }; ending: { onEnd: Action[] } },
  links: { targets: string[]; zoneIds: string[]; templateIds: string[]; wallIds: string[] },
) {
  if (!template.commands.length && !template.ending.onEnd.length && !template.actions.some(action => action.when === 'spell-end') && !links.zoneIds.length && !links.wallIds.length) return null;
  const { userId: _user, campaignId: _campaign, ...stored } = run;
  const until = run.concentration ? { concentrationOf: run.casterId } : run.durationRounds ? { remainingRounds: run.durationRounds, durationRounds: run.durationRounds } : {};
  const cast: SpellCast = {
    source: 'spell', sourceCharacterId: run.casterId, sourceName: run.spellName, spellName: run.spellName,
    run: stored, commands: template.commands, actions: [...template.actions, ...template.options.modes.flatMap(mode => mode.actions)],
    onEnd: [...template.ending.onEnd, ...template.actions.filter(action => action.when === 'spell-end')], ...links,
    castStamp: (await turnStamp(q, run.campaignId, run.sceneId)).stamp, uses: {},
  };
  await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='spell_cast' AND parameters->>'spellName'=$3`, [run.campaignId, run.casterId, run.spellName]);
  return (await q.query(
    `INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'spell_cast',$3::jsonb) RETURNING id`,
    [run.campaignId, run.casterId, JSON.stringify({ ...cast, ...until })],
  )).rows[0].id as string;
}

async function targetsOf(q: Queryable, campaignId: string, ids: string[]) {
  return ids.length ? (await q.query('SELECT id, name FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, ids])).rows as Array<{ id: string; name: string }> : [];
}

export async function endSpellCast(ctx: TableContext, q: Queryable, campaignId: string, userId: string, row: { character_id: string; parameters: any }) {
  const cast = row.parameters as SpellCast;
  const report = emptyReport();
  if (cast.zoneIds?.length) await q.query('DELETE FROM scene_triggers WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, cast.zoneIds]);
  if (cast.templateIds?.length) await q.query('DELETE FROM scene_templates WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, cast.templateIds]);
  if (cast.wallIds?.length) {
    const scenes = (await q.query('DELETE FROM scene_walls WHERE campaign_id=$1 AND id = ANY($2::uuid[]) RETURNING scene_id', [campaignId, cast.wallIds])).rows;
    for (const sceneId of new Set(scenes.map(entry => entry.scene_id as string))) await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
  }
  if (cast.run && cast.onEnd?.length) {
    const run: SpellRun = { ...cast.run, campaignId, userId };
    for (const action of cast.onEnd) {
      const people = action.who === 'caster' ? [{ id: cast.sourceCharacterId, name: cast.run.casterName }] : await targetsOf(q, campaignId, cast.targets ?? []);
      await runAction(ctx, q, run, action, people, report);
    }
  }
  return report;
}

function announce(ctx: TableContext, campaignId: string, spellName: string, report: RunReport, sceneId: string | null) {
  for (const entry of report.hpChanges) announceHpChange(ctx, campaignId, entry.characterId, entry.mode, entry.change);
  for (const line of report.lines) void notifyCampaign(ctx, campaignId, { type: 'notice', title: `«${spellName}»: ${line.name}`, detail: line.text, tone: 'info' });
  for (const text of report.manual) void notifyCampaign(ctx, campaignId, { type: 'notice', title: `«${spellName}»: примените вручную`, detail: text, tone: 'info' });
  for (const message of report.messages) void notifyCampaign(ctx, campaignId, { type: 'notice', title: `«${spellName}»`, detail: message.text, tone: 'info' });
  if (report.lines.length || report.hpChanges.length) {
    void notifyCampaign(ctx, campaignId, { type: 'rolls' });
    void notifyCampaign(ctx, campaignId, { type: 'changed' });
    for (const id of new Set([...report.changed, ...report.hpChanges.map(entry => entry.characterId)])) void notifyCampaign(ctx, campaignId, { type: 'character', characterId: id });
  }
  if (sceneId) void notify(ctx, campaignId, sceneId);
}

export async function onSpellsEnded(ctx: TableContext, q: Queryable, campaignId: string, rows: Array<{ character_id: string; parameters: any }>) {
  const owner = (await q.query('SELECT owner_user_id FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.owner_user_id as string;
  for (const row of rows) {
    const report = await endSpellCast(ctx, q, campaignId, owner, row);
    announce(ctx, campaignId, String(row.parameters?.spellName ?? ''), report, row.parameters?.run?.sceneId ?? null);
  }
}

export function commandView(effectId: string, cast: SpellCast, stamp: { stamp: string | null; round: number | null; current: Set<string> }) {
  return {
    effectId, spellName: cast.spellName,
    commands: cast.commands.map(command => {
      const used = cast.uses?.[command.id];
      const reason = command.when === 'own-turn' && stamp.stamp && !stamp.current.has(cast.sourceCharacterId) ? 'не в свой ход'
        : command.when === 'after-cast' && stamp.stamp && cast.castStamp === stamp.stamp ? 'со следующего хода'
        : command.limit === 'turn' && used && used.stamp && used.stamp === stamp.stamp ? 'уже в этот ход'
        : command.limit === 'round' && used && used.round !== null && used.round === stamp.round ? 'уже в этот раунд'
        : command.limit === 'count' && used && used.count >= Math.max(1, command.limitCount) ? 'больше нельзя'
        : null;
      const action = command.does === 'run-action' ? cast.actions.find(entry => entry.id === command.actionId) : null;
      const aim = command.does === 'move-zone' ? 'place' : action && action.who !== 'caster' ? 'target' : 'none';
      return { id: command.id, name: command.name, cost: command.cost, does: command.does, feet: command.feet, aim, blocked: reason };
    }),
  };
}

export function registerSpellCommandRoutes(ctx: TableContext) {
  const { app, auth, db, membership, actionEconomy } = ctx;
  const params = objectSchema({ campaignId: uuid, characterId: uuid });

  app.get<{ Params: { campaignId: string; characterId: string }; Querystring: { sceneId?: string } }>(
    '/campaigns/:campaignId/characters/:characterId/spell-commands',
    { schema: { params, querystring: objectSchema({ sceneId: uuid }, []) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId);
        const rights = await rightsOf(q, member, userId);
        const owner = (await q.query('SELECT owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0];
        if (!owner) reject(404, 'Существо не найдено.');
        if (!controls(rights, userId, characterId, owner.owner_user_id)) reject(403, 'Недостаточно прав.');
        const rows = (await q.query(`SELECT id, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='spell_cast' AND active ORDER BY id`, [campaignId, characterId])).rows;
        const stamp = await turnStamp(q, campaignId, request.query.sceneId ?? null);
        return { spells: rows.filter(row => (row.parameters?.commands ?? []).length).map(row => commandView(row.id, row.parameters as SpellCast, stamp)) };
      });
    },
  );

  app.post<{ Params: { campaignId: string; characterId: string; effectId: string }; Body: { commandId: string; sceneId?: string; targetIds?: string[]; place?: { x: number; z: number } } }>(
    '/campaigns/:campaignId/characters/:characterId/spell-commands/:effectId',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, characterId: uuid, effectId: uuid }),
        body: objectSchema({
          commandId: { type: 'string', minLength: 1, maxLength: 80 }, sceneId: uuid,
          targetIds: { type: 'array', maxItems: 30, uniqueItems: true, items: uuid },
          place: objectSchema({ x: { type: 'number', minimum: -1000, maximum: 1000 }, z: { type: 'number', minimum: -1000, maximum: 1000 } }, ['x', 'z']),
        }, ['commandId']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId, effectId } = request.params;
      const body = request.body;
      let spellName = '';
      let report = emptyReport();
      let sceneTouched: string | null = null;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const rights = await rightsOf(q, member, userId);
        const owner = (await q.query('SELECT owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0];
        if (!owner) reject(404, 'Существо не найдено.');
        if (!controls(rights, userId, characterId, owner.owner_user_id)) reject(403, 'Недостаточно прав.');
        const row = (await q.query(`SELECT id, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND id=$3 AND effect_code='spell_cast' AND active FOR UPDATE`, [campaignId, characterId, effectId])).rows[0];
        if (!row) reject(404, 'Заклинание уже не действует.');
        const cast = row.parameters as SpellCast;
        spellName = cast.spellName;
        const command = cast.commands.find(entry => entry.id === body.commandId);
        if (!command) reject(404, 'Такой команды у заклинания нет.');
        const sceneId = body.sceneId ?? cast.run.sceneId ?? null;
        const stamp = await turnStamp(q, campaignId, sceneId);
        const blocked = commandView(effectId, cast, stamp).commands.find(entry => entry.id === command!.id)!.blocked;
        if (blocked) reject(400, `«${command!.name}»: ${blocked}.`);
        if (command!.cost === 'action' || command!.cost === 'bonus' || command!.cost === 'reaction') {
          await actionEconomy.spend(q, campaignId, characterId, command!.cost, { kind: 'other' }, {
            enforce: await actionEconomy.enforceFor(q, campaignId, await canManage(q, member, userId)), sceneId,
          });
        }
        const run: SpellRun = { ...cast.run, campaignId, userId, sceneId };
        let notes: string[] = [];
        if (command!.does === 'run-action') {
          const action = cast.actions.find(entry => entry.id === command!.actionId);
          if (!action) reject(400, `«${command!.name}»: действие не найдено в таблице.`);
          const people = action!.who === 'caster' ? [{ id: characterId, name: cast.run.casterName }] : await targetsOf(q, campaignId, body.targetIds?.length ? body.targetIds : cast.targets);
          if (!people.length) reject(400, `«${command!.name}»: выберите цель.`);
          report = await runAction(ctx, q, run, action!, people, report);
        } else if (command!.does === 'move-zone') {
          if (!body.place || !sceneId) reject(400, `«${command!.name}»: куда сдвинуть — щелчок по карте.`);
          const scene = await getScene(q, campaignId, sceneId!, false);
          const zones = (await q.query('SELECT id, x, z FROM scene_triggers WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, cast.zoneIds ?? []])).rows;
          if (!zones.length) reject(400, `«${command!.name}»: зоны на сцене нет.`);
          const feet = Math.hypot(body.place!.x - Number(zones[0].x), body.place!.z - Number(zones[0].z)) * Number(scene.feet_per_unit || 5);
          if (command!.feet > 0 && feet > command!.feet + 1e-6) reject(400, `«${command!.name}»: не дальше ${command!.feet} фт. (сейчас ${Math.round(feet)}).`);
          await q.query('UPDATE scene_triggers SET x=$3, z=$4 WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, cast.zoneIds, body.place!.x, body.place!.z]);
          if (cast.templateIds?.length) await q.query('UPDATE scene_templates SET x=$3, z=$4 WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, cast.templateIds, body.place!.x, body.place!.z]);
          await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
          sceneTouched = sceneId;
          notes = [`зона сдвинута на ${Math.round(feet)} фт.`];
        } else if (command!.does === 'end') {
          if (cast.run.concentration) await removeCondition(q, campaignId, characterId, 'concentration');
          else {
            await q.query('DELETE FROM character_effects WHERE id=$1', [effectId]);
            await spellsEnded(q, campaignId, [{ character_id: characterId, parameters: cast }]);
          }
          notes = ['заклинание окончено'];
        } else {
          report.manual.push(`«${command!.name}»: ${command!.does === 'switch-mode' ? 'смена режима' : command!.does === 'transfer' ? 'перенос на другую цель' : 'сдвиг призванного'} — вручную`);
        }
        if (command!.does !== 'end') {
          const uses = { ...(cast.uses ?? {}) };
          uses[command!.id] = { stamp: stamp.stamp, round: stamp.round, count: (uses[command!.id]?.count ?? 0) + 1 };
          await q.query('UPDATE character_effects SET parameters=$2::jsonb WHERE id=$1', [effectId, JSON.stringify({ ...row.parameters, uses })]);
        }
        return { command: command!.name, notes, lines: report.lines, manual: report.manual };
      });
      announce(ctx, campaignId, spellName, report, sceneTouched ?? (report.moved ? body.sceneId ?? null : null));
      void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
      return result;
    },
  );
}
