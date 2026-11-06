import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid } from '../tabletop/scene-feature.ts';
import { CONDITION_CODES, effectiveSpeed, incapacitatedReason } from '../../../../packages/domain/combat/conditions.ts';
import { ABILITIES, ABILITY_SHORT, addCondition, conditionImmunity, conditionLabel, incapacitates, loadConditionState, type Notice, releaseGrapples, releaseNotices, removeCondition } from './conditions.ts';
import type { ConditionContext, ConditionEngine } from './condition-engine.ts';

export function registerConditionRoutes(ctx: ConditionContext & {
  engine: ConditionEngine;
  spendStandUp: (q: Queryable, campaignId: string, characterId: string, speedFeet: number) => Promise<'free' | 'spent'>;
}) {
  const { app, db, auth, membership, canManage, notifyCampaign, canManageCharacter, rollSaveAgainst, engine, spendStandUp } = ctx;

  async function announce(campaignId: string, notices: Notice[], characterIds: Iterable<string>) {
    void notifyCampaign(campaignId, { type: 'rolls' });
    void notifyCampaign(campaignId, { type: 'changed' });
    for (const id of new Set(characterIds)) void notifyCampaign(campaignId, { type: 'character', characterId: id });
    for (const notice of notices) void notifyCampaign(campaignId, { type: 'notice', title: notice.title, detail: notice.detail });
  }

  const CODES = [...CONDITION_CODES, 'exhaustion'];

  app.post<{
    Params: { campaignId: string };
    Body: {
      targetIds: string[];
      code: string;
      level?: number;
      save?: { ability: string; dc: number };
      durationRounds?: number;
      repeatSave?: 'end' | 'start';
      sourceCharacterId?: string;
      sourceName?: string;
      hidden?: boolean;
    };
  }>(
    '/campaigns/:campaignId/conditions/apply',
    {
      schema: {
        params: objectSchema({ campaignId: uuid }),
        body: objectSchema({
          targetIds: { type: 'array', minItems: 1, maxItems: 30, uniqueItems: true, items: uuid },
          code: { type: 'string', enum: CODES },
          level: { type: 'integer', minimum: 1, maximum: 6 },
          save: objectSchema({
            ability: { type: 'string', enum: [...ABILITIES] },
            dc: { type: 'integer', minimum: 1, maximum: 40 },
          }),
          durationRounds: { type: 'integer', minimum: 1, maximum: 1000 },
          repeatSave: { type: 'string', enum: ['end', 'start'] },
          sourceCharacterId: uuid,
          sourceName: { type: 'string', minLength: 1, maxLength: 60 },
          hidden: { type: 'boolean' },
        }, ['targetIds', 'code']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { targetIds, code, level, save, durationRounds, repeatSave, sourceCharacterId, sourceName, hidden } = request.body;
      if (repeatSave && !save) reject(400, 'Повторный спасбросок — только вместе со спасброском (характеристика и СЛ).');
      if (code === 'exhaustion' && !level) reject(400, 'Укажите уровень истощения (1–6).');
      const effectCode = code === 'exhaustion' ? `exhaustion_${level}` : code;

      const notices: Notice[] = [];
      const results = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        let source: { id: string; name: string } | null = null;
        if (sourceCharacterId) {
          const row = (await q.query('SELECT id, name, owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, sourceCharacterId])).rows[0] as any;
          if (!row) reject(404, 'Источник не найден.');
          source = row;
          if (!(await canManage(q, member, userId)) && !(await canManageCharacter(q, member, userId, row.owner_user_id, row.id))) {
            reject(403, 'Накладывать состояние можно своим существом или мастеру.');
          }
        } else if (!(await canManage(q, member, userId)) && !(await canManageCharacter(q, member, userId, null))) {
          reject(403, 'Состояние без источника накладывает мастер.');
        }
        if (source && effectCode === 'grappled') {
          const unable = incapacitatedReason(await loadConditionState(q, campaignId, source.id));
          if (unable) reject(400, `${source.name} не может схватить: ${unable}.`);
        }

        const list: Array<{ characterId: string; name: string; applied: boolean; total: number | null; autoFail: boolean; immune?: string }> = [];
        const label = conditionLabel(effectCode);
        const released: Notice[] = [];
        for (const targetId of targetIds) {
          const target = (await q.query('SELECT id, name, kind FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0];
          if (!target) reject(404, 'Цель не найдена.');
          if (target.kind === 'object') reject(400, `«${target.name}» — предмет: состояния бывают у существ.`);
          const immune = await conditionImmunity(q, campaignId, target.id, effectCode, source?.id ?? null);
          if (immune) {
            list.push({ characterId: target.id, name: target.name, applied: false, total: null, autoFail: false, immune });
            continue;
          }

          let total: number | null = null;
          let autoFail = false;
          if (save) {
            const rolled = await rollSaveAgainst(
              q, campaignId, userId, target.id, save.ability, save.dc,
              `Спасбросок ${ABILITY_SHORT[save.ability]} (СЛ ${save.dc}) против «${label}»${sourceName ? `, ${sourceName}` : ''} — ${target.name}`,
              hidden ?? false, null, [], { condition: effectCode },
            );
            total = rolled.total;
            autoFail = rolled.autoFail;
            if (rolled.success) {
              list.push({ characterId: target.id, name: target.name, applied: false, total, autoFail });
              continue;
            }
          }

          if (effectCode.startsWith('exhaustion_')) {
            await q.query(
              `DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code LIKE 'exhaustion\\_%'`,
              [campaignId, target.id],
            );
          }
          if (incapacitates(effectCode)) {
            released.push(...releaseNotices(target.name, await releaseGrapples(q, campaignId, target.id), `«${label}»`));
          }
          await addCondition(q, campaignId, target.id, effectCode, {
            source: 'apply',
            ...(source ? { sourceCharacterId: source.id } : {}),
            ...(sourceName ? { sourceName } : source ? { sourceName: source.name } : {}),
            ...(durationRounds ? { remainingRounds: durationRounds, durationRounds } : {}),
            ...(save ? { save } : {}),
            ...(repeatSave ? { repeatSave } : {}),
          });
          list.push({ characterId: target.id, name: target.name, applied: true, total, autoFail });
        }

        const applied = list.filter(entry => entry.applied).map(entry => entry.name);
        const resisted = list.filter(entry => !entry.applied && !entry.immune).map(entry => entry.name);
        const immune = list.filter(entry => entry.immune).map(entry => `${entry.name} (${entry.immune})`);
        notices.push({
          title: `«${label}»${sourceName ? ` — ${sourceName}` : ''}`,
          detail: [
            applied.length ? `Наложено: ${applied.join(', ')}.` : '',
            resisted.length ? `Устояли: ${resisted.join(', ')}.` : '',
            immune.length ? `Иммунитет: ${immune.join(', ')}.` : '',
            durationRounds ? `Длительность: ${durationRounds} ход.` : '',
          ].filter(Boolean).join(' '),
        });
        notices.push(...released);
        return list;
      });

      await announce(campaignId, notices, [...results.map(entry => entry.characterId), ...notices.flatMap(notice => notice.characterId ? [notice.characterId] : [])]);
      return { results };
    },
  );

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { inspiration?: boolean; sceneId?: string } | undefined }>(
    '/campaigns/:campaignId/characters/:characterId/death-save',
    { schema: { params: objectSchema({ campaignId: uuid, characterId: uuid }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const inspiration = request.body?.inspiration;
      if (inspiration !== undefined && typeof inspiration !== 'boolean') reject(400, 'inspiration — да или нет.');
      const sceneId = request.body?.sceneId;
      if (sceneId !== undefined && (typeof sceneId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sceneId))) reject(400, 'sceneId — идентификатор сцены.');
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const owner = (await q.query('SELECT owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, characterId])).rows[0];
        if (!owner) reject(404, 'Персонаж не найден.');
        if (!(await canManageCharacter(q, member, userId, owner.owner_user_id, characterId))) reject(403, 'Спасбросок от смерти бросает владелец персонажа или мастер.');
        const free = (await canManage(q, member, userId))
          && (await q.query(`SELECT value FROM campaign_rules WHERE campaign_id=$1 AND key='gm_free_move' AND kind='flag'`, [campaignId])).rows[0]?.value === true;
        return engine.deathSave(q, campaignId, userId, characterId, false, inspiration === true, free, null, sceneId ?? null);
      });
      await announce(campaignId, [result.notice], [characterId]);
      if (inspiration) void notifyCampaign(campaignId, { type: 'float', characterId, text: 'вдохновение', tone: 'xp' });
      return { roll: result.roll, result: result.result };
    },
  );

  app.post<{
    Params: { campaignId: string };
    Body: { characterIds: string[]; hp: 'one' | 'half' | 'full'; clearExhaustion?: boolean; clearConditions?: boolean };
  }>(
    '/campaigns/:campaignId/characters/revive',
    {
      schema: {
        params: objectSchema({ campaignId: uuid }),
        body: objectSchema({
          characterIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: uuid },
          hp: { type: 'string', enum: ['one', 'half', 'full'] },
          clearExhaustion: { type: 'boolean' },
          clearConditions: { type: 'boolean' },
        }, ['characterIds', 'hp']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { characterIds, hp, clearExhaustion, clearConditions } = request.body;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Воскрешать может мастер.');
        const rows = (
          await q.query(
            'SELECT id, name, kind, hp_current, hp_max FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[]) ORDER BY name FOR UPDATE',
            [campaignId, characterIds],
          )
        ).rows as Array<{ id: string; name: string; kind: string; hp_current: number; hp_max: number }>;
        if (!rows.length) reject(404, 'Существа не найдены.');
        const revived: Array<{ id: string; name: string; hp: number }> = [];
        const skipped: Array<{ id: string; name: string; reason: string }> = [];
        for (const row of rows) {
          if (row.kind === 'object') {
            skipped.push({ id: row.id, name: row.name, reason: 'предмет' });
            continue;
          }
          const state = await loadConditionState(q, campaignId, row.id);
          if (!state.codes.has('dead') && row.hp_current > 0) {
            skipped.push({ id: row.id, name: row.name, reason: 'жив' });
            continue;
          }
          const max = Math.max(1, row.hp_max);
          const target = hp === 'one' ? 1 : hp === 'half' ? Math.max(1, Math.ceil(max / 2)) : max;
          await removeCondition(q, campaignId, row.id, 'dead');
          await removeCondition(q, campaignId, row.id, 'unconscious', 'hp');
          await removeCondition(q, campaignId, row.id, 'stable');
          if (clearExhaustion) {
            await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code LIKE 'exhaustion\\_%'`, [campaignId, row.id]);
          }
          if (clearConditions) {
            for (const code of CONDITION_CODES) await removeCondition(q, campaignId, row.id, code);
          }
          await q.query(
            'UPDATE characters SET hp_current=$3, hp_temp=0, death_successes=0, death_failures=0, revision=revision+1 WHERE campaign_id=$1 AND id=$2',
            [campaignId, row.id, target],
          );
          revived.push({ id: row.id, name: row.name, hp: target });
        }
        return { revived, skipped };
      });
      if (result.revived.length) {
        const names = result.revived.map(entry => `${entry.name} (${entry.hp})`).join(', ');
        await announce(campaignId, [{ title: result.revived.length === 1 ? `${result.revived[0]!.name} встаёт` : 'Воскрешение', detail: `Снова в строю: ${names}.` }], result.revived.map(entry => entry.id));
      }
      return result;
    },
  );

  app.post<{ Params: { campaignId: string; characterId: string } }>(
    '/campaigns/:campaignId/characters/:characterId/stand',
    { schema: { params: objectSchema({ campaignId: uuid, characterId: uuid }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const outcome = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const row = (await q.query('SELECT name, owner_user_id, speed_feet::float8 AS speed_feet FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, characterId])).rows[0];
        if (!row) reject(404, 'Персонаж не найден.');
        if (!(await canManageCharacter(q, member, userId, row.owner_user_id, characterId))) reject(403, 'Поднять можно своё существо.');
        const state = await loadConditionState(q, campaignId, characterId);
        if (!state.codes.has('prone')) reject(400, `${row.name} не лежит.`);
        const unable = incapacitatedReason(state);
        if (unable) reject(400, `${row.name} не может встать: ${unable}.`);
        const speed = effectiveSpeed(Number(row.speed_feet ?? 0), state).feet;
        if (speed <= 0) reject(400, `${row.name} не может встать: скорость 0.`);
        const spent = await spendStandUp(q, campaignId, characterId, Math.floor(Number(row.speed_feet ?? 0) / 2));
        await removeCondition(q, campaignId, characterId, 'prone');
        return { name: row.name, spent };
      });
      await announce(campaignId, [{ title: `${outcome.name} встаёт`, detail: outcome.spent === 'spent' ? 'Ушла половина скорости этого хода.' : 'Вне боя — без затрат движения.' }], [characterId]);
      return { standing: true, spentMovement: outcome.spent === 'spent' };
    },
  );

  return { rollSaveAgainst };
}
