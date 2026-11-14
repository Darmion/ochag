import type { Queryable } from '../db.ts';
import { reject, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { vanishSummon } from './summons.ts';
import { concentrationDc, damageAtZero, deathSaveOutcome } from '../../../../packages/domain/combat/conditions.ts';
import { classFeaturesFor, rageEndsEarly, survivorHeal } from '../../../../packages/domain/character/class-features.ts';
import { abilityModifier, parseFormula, rollDice } from '../../../../packages/domain/dice/dice.ts';
import { characterClassLevels } from '../../../../packages/domain/character/classes.ts';
import { ABILITIES, ABILITY_GENITIVE, ABILITY_SHORT, addCondition, addExhaustion, hasFeature, incapacitates, loadConditionState, loadEffects, lowerExhaustion, type Notice, releaseGrapples, releaseNotices, removeCondition, resumeAfterRage, spellsEnded } from './conditions.ts';
import { campaignConditionRules, conditionName } from './condition-rules.ts';
import { describeStage, repeatSaveOf, stageIndex, type ConditionRule, type RepeatSave } from '../../../../packages/domain/combat/condition-rules.ts';
import { DAMAGE_TYPES } from '../../../../packages/domain/spells/template/options.ts';

type InsertRoll = (
  q: Queryable, campaignId: string, userId: string, characterId: string | null, label: string | null,
  formula: string, results: number[], modifier: number, total: number, hidden: boolean,
  breakdown?: unknown[] | null, outcome?: Record<string, unknown> | null,
) => Promise<any>;

export type SaveRoll = { total: number; roll: any; autoFail: boolean; success: boolean };

export type ConditionContext = SceneFeatureContext & {
  insertRoll: InsertRoll;
  rollDie: (sides: number) => number;
  canManageCharacter: (q: Queryable, member: any, userId: string, ownerUserId: string | null, characterId?: string | null) => Promise<boolean>;
  rollSaveAgainst: (
    q: Queryable, campaignId: string, userId: string, characterId: string, ability: string, dc: number, label: string, hidden: boolean,
    bonus?: { value: number; reason: string } | null, disadvantages?: string[],
    against?: { condition?: string | null; magic?: boolean; damageType?: string | null; concentration?: boolean } | null,
  ) => Promise<SaveRoll>;
  // Damage a course deals on a failed save (a poison that keeps burning); resistances and immunities apply.
  hurt?: (q: Queryable, campaignId: string, userId: string, characterId: string, amount: number, damageType: string) => Promise<{ applied: number; blocked: string | null }>;
};

type Course = Notice & { short: string };

function courseDamage(formula: string, rollDie: (sides: number) => number): { total: number; text: string } | null {
  const clean = formula.replace(/\s+/g, '').replace(/к/gi, 'd');
  if (/^\d{1,3}$/.test(clean)) return { total: Number(clean), text: clean };
  const parsed = parseFormula(clean);
  if (!parsed) return null;
  const rolled = rollDice(parsed, rollDie);
  return { total: Math.max(0, rolled.total), text: `${clean}: ${rolled.total}` };
}

type Creature = { id: string; name: string; kind: string; owner_user_id: string | null; hp_max: number };

export function createConditionEngine(ctx: ConditionContext) {
  const { insertRoll, rollDie, rollSaveAgainst } = ctx;

  async function creature(q: Queryable, campaignId: string, characterId: string): Promise<Creature & { hp_current: number; death_successes: number; death_failures: number }> {
    const row = (
      await q.query(
        `SELECT id, name, kind, owner_user_id, hp_current, hp_max, death_successes, death_failures
         FROM characters WHERE campaign_id=$1 AND id=$2`,
        [campaignId, characterId],
      )
    ).rows[0] as any;
    if (!row) reject(404, 'Существо не найдено.');
    return row;
  }

  async function setDeathSaves(q: Queryable, campaignId: string, characterId: string, successes: number, failures: number) {
    await q.query(
      'UPDATE characters SET death_successes=$3, death_failures=$4, revision=revision+1 WHERE campaign_id=$1 AND id=$2',
      [campaignId, characterId, successes, failures],
    );
  }

  async function die(q: Queryable, campaignId: string, characterId: string) {
    for (const code of ['unconscious', 'stable', 'concentration', 'raging']) await removeCondition(q, campaignId, characterId, code);
    await addCondition(q, campaignId, characterId, 'dead', { source: 'hp' });
  }

  async function afterHpChange(
    q: Queryable,
    campaignId: string,
    userId: string,
    target: Creature,
    change: { mode: 'damage' | 'heal'; before: number; after: number; amount: number; toHp: number; critical: boolean; concentrationDisadvantages?: string[] },
  ): Promise<Notice[]> {
    if (target.kind === 'object') return [];
    const notices: Notice[] = [];
    const state = await loadConditionState(q, campaignId, target.id);
    if (state.codes.has('dead')) return notices;

    if (change.mode === 'heal') {
      if (change.before === 0 && change.after > 0) {
        const woke = await removeCondition(q, campaignId, target.id, 'unconscious', 'hp');
        await removeCondition(q, campaignId, target.id, 'stable');
        await setDeathSaves(q, campaignId, target.id, 0, 0);
        if (woke) notices.push({ title: `${target.name} приходит в себя`, detail: `${change.after} хит. — всё ещё лежит ничком.`, characterId: target.id });
      }
      return notices;
    }

    if (change.amount <= 0) return notices;

    const broken = (
      await q.query(
        `DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND parameters->>'endsOnDamage' = 'true'
         RETURNING effect_code, parameters->>'sourceName' AS source_name`,
        [campaignId, target.id],
      )
    ).rows as Array<{ effect_code: string; source_name: string | null }>;
    for (const effect of broken) {
      const label = await conditionName(q, campaignId, effect.effect_code);
      notices.push({
        title: `${target.name}: «${label}» снято`,
        detail: `Урон обрывает${effect.source_name ? ` «${effect.source_name}»` : ''}.`,
        characterId: target.id,
      });
    }

    if (change.before > 0 && change.after === 0) {
      const overflow = change.toHp - change.before;
      notices.push(...releaseNotices(target.name, await releaseGrapples(q, campaignId, target.id), 'падает'));
      if (target.kind !== 'character' && state.codes.has('summoned')) {
        await die(q, campaignId, target.id);
        await vanishSummon(q, campaignId, target.id);
        notices.push({ title: `${target.name} исчезает`, detail: 'Призванное существо при 0 хитов пропадает.', characterId: target.id });
      } else if (target.kind !== 'character') {
        await die(q, campaignId, target.id);
        notices.push({ title: `${target.name} повержен`, detail: 'Хиты упали до 0.', characterId: target.id });
      } else if (overflow >= target.hp_max) {
        await die(q, campaignId, target.id);
        notices.push({ title: `${target.name} погибает`, detail: `Урон сверх 0 хитов (${overflow}) не меньше максимума хитов — мгновенная смерть.`, characterId: target.id });
      } else {
        await addCondition(q, campaignId, target.id, 'unconscious', { source: 'hp' });
        await addCondition(q, campaignId, target.id, 'prone', { source: 'hp' });
        await removeCondition(q, campaignId, target.id, 'concentration');
        await removeCondition(q, campaignId, target.id, 'raging');
        await setDeathSaves(q, campaignId, target.id, 0, 0);
        notices.push({ title: `${target.name} без сознания`, detail: 'Хиты упали до 0: в начале своих ходов — спасброски от смерти.', characterId: target.id });
      }
      return notices;
    }

    if (change.before === 0 && target.kind === 'character' && state.codes.has('unconscious')) {
      const row = await creature(q, campaignId, target.id);
      const next = damageAtZero({ successes: row.death_successes, failures: row.death_failures }, change.toHp, change.critical, target.hp_max);
      await removeCondition(q, campaignId, target.id, 'stable');
      if (next.dead) {
        await setDeathSaves(q, campaignId, target.id, next.successes, 3);
        await die(q, campaignId, target.id);
        notices.push({ title: `${target.name} погибает`, detail: change.toHp >= target.hp_max ? 'Урон не меньше максимума хитов.' : 'Третий провал спасбросков от смерти.', characterId: target.id });
      } else {
        await setDeathSaves(q, campaignId, target.id, next.successes, next.failures);
        notices.push({ title: `${target.name}: провал спасброска от смерти`, detail: `Урон по лежащему без сознания${change.critical ? ' (крит — два провала)' : ''}: провалов ${next.failures} из 3.`, characterId: target.id });
      }
      return notices;
    }

    if (change.after > 0 && state.codes.has('concentration')) {
      const dc = concentrationDc(change.amount);
      const save = await rollSaveAgainst(q, campaignId, userId, target.id, 'constitution', dc, `Концентрация (СЛ ${dc}) — ${target.name}`, false, null, change.concentrationDisadvantages ?? [], { concentration: true });
      if (!save.success) {
        await removeCondition(q, campaignId, target.id, 'concentration');
        notices.push({ title: `${target.name} теряет концентрацию`, detail: `Спасбросок Телосложения ${save.total} против СЛ ${dc}.`, characterId: target.id });
      } else {
        notices.push({ title: `${target.name} удерживает концентрацию`, detail: `Спасбросок Телосложения ${save.total} против СЛ ${dc}.`, characterId: target.id });
      }
    }
    return notices;
  }

  async function deathSave(
    q: Queryable, campaignId: string, userId: string, characterId: string, auto = false, inspiration = false, free = false,
    entryId: string | null = null, sceneId: string | null = null,
  ) {
    const row = await creature(q, campaignId, characterId);
    const state = await loadConditionState(q, campaignId, characterId);
    if (row.kind !== 'character') reject(400, 'Спасброски от смерти бросают персонажи игроков.');
    if (state.codes.has('dead')) reject(400, `${row.name} мёртв.`);
    if (row.hp_current > 0 || !state.codes.has('unconscious')) reject(400, `${row.name} не при смерти: спасброски от смерти — только с 0 хитов.`);
    if (state.codes.has('stable')) reject(400, `${row.name} стабилен — спасброски от смерти больше не нужны.`);
    const turn = (
      await q.query(
        `SELECT ie.id, ie.is_current, ie.turn_flags FROM initiative_entries ie
         WHERE ie.campaign_id=$1 AND ie.character_id=$2
           -- The fight where the figure stands (an old entry on another scene does not count); no figure anywhere: any entry.
           AND (COALESCE(ie.id = $3::uuid, false)
                OR ($4::uuid IS NOT NULL AND ie.scene_id = $4::uuid)
                OR ($4::uuid IS NULL AND (
                  EXISTS (SELECT 1 FROM scene_objects so WHERE so.campaign_id = ie.campaign_id AND so.scene_id = ie.scene_id AND so.character_id = ie.character_id)
                  OR NOT EXISTS (SELECT 1 FROM scene_objects so WHERE so.campaign_id = ie.campaign_id AND so.character_id = ie.character_id))))
         ORDER BY COALESCE(ie.id = $3::uuid, false) DESC, ie.is_current DESC
         LIMIT 1`,
        [campaignId, characterId, entryId, sceneId],
      )
    ).rows[0] as { id: string; is_current: boolean; turn_flags: string[] | null } | undefined;
    if (turn && !auto && !free) {
      if (!turn.is_current) reject(400, `${row.name}: в бою спасбросок от смерти — в начале своего хода, его бросает приложение само.`);
      if ((turn.turn_flags ?? []).includes('death-save')) reject(400, `${row.name} уже бросил спасбросок от смерти в этом ходу — следующий в начале следующего хода.`);
    }
    if (turn) {
      await q.query(`UPDATE initiative_entries SET turn_flags = array_append(turn_flags, 'death-save') WHERE id=$1 AND NOT ('death-save' = ANY(turn_flags))`, [turn.id]);
    }
    if (inspiration) {
      const spent = (
        await q.query('UPDATE characters SET inspiration=false, revision=revision+1 WHERE campaign_id=$1 AND id=$2 AND inspiration RETURNING id', [campaignId, characterId])
      ).rows[0];
      if (!spent) reject(400, `У «${row.name}» нет вдохновения.`);
    }

    const hope = (await loadConditionState(q, campaignId, characterId)).codes.has('beacon_of_hope');
    const dice = inspiration || hope ? [rollDie(20), rollDie(20)] : [rollDie(20)];
    const natural = Math.max(...dice);
    const next = deathSaveOutcome(natural, { successes: row.death_successes, failures: row.death_failures });
    let result: 'success' | 'failure' | 'stable' | 'dead' | 'revived';
    let detail: string;

    if (next.regained) {
      await q.query('UPDATE characters SET hp_current=1, death_successes=0, death_failures=0, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, characterId]);
      await removeCondition(q, campaignId, characterId, 'unconscious', 'hp');
      result = 'revived';
      detail = 'Натуральная 20 — приходит в себя с 1 хитом.';
    } else if (next.dead) {
      await setDeathSaves(q, campaignId, characterId, next.successes, 3);
      await die(q, campaignId, characterId);
      result = 'dead';
      detail = 'Третий провал — смерть.';
    } else if (next.stable) {
      await setDeathSaves(q, campaignId, characterId, 3, next.failures);
      await addCondition(q, campaignId, characterId, 'stable', { source: 'hp' });
      result = 'stable';
      detail = 'Третий успех — стабилен, без сознания, но больше не умирает.';
    } else {
      await setDeathSaves(q, campaignId, characterId, next.successes, next.failures);
      result = natural >= 10 ? 'success' : 'failure';
      detail = `${natural === 1 ? 'Натуральная 1 — два провала. ' : ''}Успехов ${next.successes}, провалов ${next.failures} из 3.`;
    }

    const roll = await insertRoll(
      q, campaignId, userId, characterId, `Спасбросок от смерти — ${row.name}`, inspiration ? '2d20adv' : '1d20', dice, 0, natural, false, null,
      {
        kind: 'death', result, successes: next.regained ? 0 : next.successes, failures: next.regained ? 0 : next.failures, auto,
        ...(inspiration ? { advantage: 'adv', reasons: ['преимущество: вдохновение'] } : {}),
      },
    );
    return { roll, result, notice: { title: `${row.name}: спасбросок от смерти — ${natural}`, detail, characterId } as Notice };
  }

  async function dyingWithoutSave(q: Queryable, campaignId: string, characterId: string) {
    const row = await creature(q, campaignId, characterId);
    const state = await loadConditionState(q, campaignId, characterId);
    return row.kind === 'character' && row.hp_current === 0 && state.codes.has('unconscious') && !state.codes.has('stable') && !state.codes.has('dead');
  }

  async function rollsForItself(q: Queryable, campaignId: string, characterId: string) {
    return (await q.query('SELECT auto_death_saves FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0]?.auto_death_saves !== false;
  }

  async function endOfTurn(q: Queryable, campaignId: string, userId: string, characterId: string, entryId: string | null = null): Promise<Notice[]> {
    const notices = [
      ...await expireAt(q, campaignId, characterId, 'end'), ...await turnBoundary(q, campaignId, userId, characterId, 'end'),
      ...await ruledSaves(q, campaignId, userId, characterId, 'turn-end'),
    ];
    if (entryId && !(await rollsForItself(q, campaignId, characterId)) && await dyingWithoutSave(q, campaignId, characterId)) {
      const rolled = (await q.query(`SELECT 1 FROM initiative_entries WHERE id=$1 AND 'death-save' = ANY(turn_flags)`, [entryId])).rows[0];
      if (!rolled) {
        const save = await deathSave(q, campaignId, userId, characterId, true, false, false, entryId);
        notices.push({ ...save.notice, detail: `${save.notice.detail} Ход передан без броска — приложение бросило само.` });
      }
    }
    return notices;
  }

  async function expireAt(q: Queryable, campaignId: string, characterId: string, at: 'start' | 'end'): Promise<Notice[]> {
    const gone = (
      await q.query(
        `DELETE FROM character_effects e USING characters c
         WHERE e.campaign_id=$1 AND e.active AND e.parameters->'expires'->>'of' = $2 AND e.parameters->'expires'->>'at' = $3
           AND COALESCE((e.parameters->'expires'->>'skip')::int, 0) <= 0
           AND c.campaign_id = e.campaign_id AND c.id = e.character_id
         RETURNING c.id, c.name, e.effect_code, e.parameters->>'sourceName' AS source_name, e.parameters`,
        [campaignId, characterId, at],
      )
    ).rows as Array<{ id: string; name: string; effect_code: string; source_name: string | null; parameters: any }>;
    await spellsEnded(q, campaignId, gone.filter(entry => entry.effect_code === 'spell_cast').map(entry => ({ character_id: entry.id, parameters: entry.parameters })));
    await q.query(
      `UPDATE character_effects SET parameters = jsonb_set(parameters, '{expires,skip}', to_jsonb((parameters->'expires'->>'skip')::int - 1))
       WHERE campaign_id=$1 AND active AND parameters->'expires'->>'of' = $2 AND parameters->'expires'->>'at' = $3
         AND COALESCE((parameters->'expires'->>'skip')::int, 0) > 0`,
      [campaignId, characterId, at],
    );
    const notices: Notice[] = [];
    for (const entry of gone) {
      const label = await conditionName(q, campaignId, entry.effect_code);
      notices.push({
        title: `${entry.name}: «${label}» закончилось`,
        detail: entry.source_name ? `«${entry.source_name}» больше не действует.` : 'Длительность вышла.',
        characterId: entry.id,
      });
    }
    return notices;
  }

  // A clause «repeat save» of the campaign's rules: the creature tries to shake the condition off; the GM decides what a success
  // and a failure do — end it after N wins, ease its stage or its DC, add exhaustion, worsen the stage, deal damage.
  async function ruledSave(
    q: Queryable, campaignId: string, userId: string, row: { name: string }, characterId: string,
    effect: { id: string; effect_code: string; parameters: any }, save: RepeatSave, rule: ConditionRule | undefined,
  ): Promise<Course[]> {
    const label = await conditionName(q, campaignId, effect.effect_code);
    const stages = rule?.stages ?? [];
    const stage = stageIndex(rule, effect.parameters?.stage);
    const dc = save.onWin === 'easier' && Number(effect.parameters?.courseDc) > 0 ? Number(effect.parameters.courseDc) : save.dc;
    let success = false;
    let throwText = 'Без спасброска: болезнь идёт своим ходом.';
    if (save.ability !== 'none') {
      const ability = ABILITIES.find(entry => entry === save.ability) ?? 'constitution';
      const rolled = await rollSaveAgainst(
        q, campaignId, userId, characterId, ability, dc,
        `Спасбросок ${ABILITY_SHORT[ability]} (СЛ ${dc}) против «${label}» — ${row.name}`, false, null, [], { condition: effect.effect_code },
      );
      success = rolled.success;
      throwText = `Спасбросок ${ABILITY_GENITIVE[ability]} ${rolled.total} против СЛ ${dc}${rolled.autoFail ? ' — автопровал' : ''}.`;
    }
    const merge = (patch: Record<string, unknown>) =>
      q.query(`UPDATE character_effects SET parameters = COALESCE(parameters, '{}'::jsonb) || $2::jsonb WHERE id=$1`, [effect.id, JSON.stringify(patch)]);
    const one = (title: string, detail: string, short: string): Course[] => [{ title, detail, characterId, short }];
    const gone = async (): Promise<Course[]> => {
      await removeCondition(q, campaignId, characterId, effect.effect_code);
      return one(`${row.name}: «${label}» снято`, throwText, `«${label}» прошло`);
    };

    if (success) {
      if (save.onWin === 'better') {
        if (!stages.length || stage === 0) return gone();
        await merge({ stage: stage - 1 });
        return one(`${row.name}: «${label}» — легче, стадия ${stage}`, `${throwText} ${describeStage(stages[stage - 1]!, stage - 1)}`, `«${label}»: стадия ${stage}`);
      }
      if (save.onWin === 'easier') {
        const ease = rollDie(save.ease);
        const next = dc - ease;
        if (next <= 0) return gone();
        await merge({ courseDc: next });
        return one(`${row.name}: «${label}» — СЛ ${next}`, `${throwText} СЛ ниже на ${ease}.`, `«${label}»: СЛ ${next}`);
      }
      if (save.onWin === 'exhaustion-down') {
        const level = await lowerExhaustion(q, campaignId, characterId);
        if (level <= 0) return gone();
        return one(`${row.name}: «${label}» отступает, истощение ${level}`, throwText, `«${label}» отступает, истощение ${level}`);
      }
      const wins = Number(effect.parameters?.saveWins ?? 0) + 1;
      const need = save.wins;
      if (wins >= need) return gone();
      await merge({ saveWins: wins });
      return one(`${row.name}: «${label}» — успех ${wins} из ${need}`, throwText, `«${label}»: успех ${wins} из ${need}`);
    }
    if (save.onFail === 'exhaustion') {
      const level = await addExhaustion(q, campaignId, characterId);
      return one(`${row.name}: «${label}» держится, истощение ${level}`, throwText, `«${label}» держится, истощение ${level}`);
    }
    if (save.onFail === 'worse' && stages.length && stage < stages.length - 1) {
      await merge({ stage: stage + 1 });
      const out = one(`${row.name}: «${label}» — тяжелее, стадия ${stage + 2}`, `${throwText} ${describeStage(stages[stage + 1]!, stage + 1)}`, `«${label}»: стадия ${stage + 2}`);
      if (incapacitates(effect.effect_code, await campaignConditionRules(q, campaignId), stage + 1)) {
        out.push(...releaseNotices(row.name, await releaseGrapples(q, campaignId, characterId), `«${label}»`).map(notice => ({ ...notice, short: notice.title })));
      }
      return out;
    }
    if (save.onFail === 'damage') {
      const damage = courseDamage(save.damage, rollDie);
      if (!damage || !ctx.hurt) return one(`${row.name}: «${label}» держится`, `${throwText} Урон «${save.damage}» бросает мастер.`, `«${label}» держится`);
      const type = DAMAGE_TYPES.find(([value]) => value === save.damageType)?.[1] ?? save.damageType;
      const dealt = await ctx.hurt(q, campaignId, userId, characterId, damage.total, save.damageType);
      const taken = dealt.blocked === 'immune' ? 'иммунитет' : `${dealt.applied} урона, ${type}`;
      return one(`${row.name}: «${label}» — ${taken}`, `${throwText} Урон ${damage.text}.`, `«${label}»: ${taken}`);
    }
    return one(`${row.name}: «${label}» держится`, throwText, `«${label}» держится`);
  }

  async function ruledSaves(q: Queryable, campaignId: string, userId: string, characterId: string, when: RepeatSave['when']) {
    const rules = await campaignConditionRules(q, campaignId);
    const row = await creature(q, campaignId, characterId);
    const out: Course[] = [];
    for (const effect of await loadEffects(q, campaignId, characterId)) {
      if (effect.parameters?.save) continue;
      const rule = rules.get(effect.effect_code);
      const save = repeatSaveOf(rule, effect.parameters?.stage);
      if (save?.when === when) out.push(...await ruledSave(q, campaignId, userId, row, characterId, effect, save, rule));
    }
    return out;
  }

  // The campaign clock moved: lasting conditions run out, and hourly and daily courses roll once per hour or day boundary crossed.
  async function timePassed(q: Queryable, campaignId: string, userId: string, before: number, after: number): Promise<Notice[]> {
    if (after <= before) return [];
    const notices: Notice[] = [];
    const expired = (await q.query(
      `SELECT e.character_id, e.effect_code, c.name FROM character_effects e JOIN characters c ON c.campaign_id=e.campaign_id AND c.id=e.character_id
       WHERE e.campaign_id=$1 AND e.active AND e.parameters ? 'untilMinute' AND (e.parameters->>'untilMinute')::numeric <= $2`,
      [campaignId, after],
    )).rows as Array<{ character_id: string; effect_code: string; name: string }>;
    for (const row of expired) {
      if (!(await removeCondition(q, campaignId, row.character_id, row.effect_code))) continue;
      notices.push({ title: `${row.name}: «${await conditionName(q, campaignId, row.effect_code)}» прошло`, detail: 'Время вышло по часам кампании.', characterId: row.character_id });
    }
    const hours = Math.min(48, Math.floor(after / 60) - Math.floor(before / 60));
    const days = Math.min(30, Math.floor(after / 1440) - Math.floor(before / 1440));
    if (hours <= 0 && days <= 0) return notices;
    const rules = await campaignConditionRules(q, campaignId);
    const held = (await q.query(
      'SELECT id, character_id, effect_code, parameters FROM character_effects WHERE campaign_id=$1 AND active ORDER BY character_id, effect_code, id',
      [campaignId],
    )).rows as Array<{ id: string; character_id: string; effect_code: string; parameters: any }>;
    for (const effect of held) {
      const rule = rules.get(effect.effect_code);
      const when = repeatSaveOf(rule, effect.parameters?.stage)?.when;
      if ((when !== 'hour' && when !== 'day') || effect.parameters?.save) continue;
      const row = await creature(q, campaignId, effect.character_id);
      for (let tick = 0; tick < (when === 'hour' ? hours : days); tick += 1) {
        const fresh = (await q.query('SELECT id, effect_code, parameters FROM character_effects WHERE id=$1 AND active', [effect.id])).rows[0] as typeof effect | undefined;
        const save = fresh ? repeatSaveOf(rule, fresh.parameters?.stage) : null;
        if (!fresh || save?.when !== when) break;
        notices.push(...await ruledSave(q, campaignId, userId, row, effect.character_id, fresh, save, rule));
      }
    }
    return notices;
  }

  async function startOfTurn(q: Queryable, campaignId: string, userId: string, characterId: string, entryId: string | null = null): Promise<Notice[]> {
    await q.query(`UPDATE character_effects SET active=false WHERE campaign_id=$1 AND character_id=$2 AND effect_code='shield_spell' AND active`, [campaignId, characterId]);
    const notices = [
      ...await expireAt(q, campaignId, characterId, 'start'), ...await turnBoundary(q, campaignId, userId, characterId, 'start'),
      ...await ruledSaves(q, campaignId, userId, characterId, 'turn-start'),
    ];
    await q.query(
      `UPDATE characters c SET hp_temp = GREATEST(c.hp_temp, (e.parameters->>'temp')::int), revision = c.revision + 1
       FROM character_effects e
       WHERE c.campaign_id=$1 AND c.id=$2 AND e.campaign_id=c.campaign_id AND e.character_id=c.id AND e.effect_code='heroism' AND e.active
         AND (e.parameters->>'temp')::int > c.hp_temp`,
      [campaignId, characterId],
    );
    const champion = (
      await q.query('SELECT name, level, class_name, hp_current, hp_max, constitution FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])
    ).rows[0] as any;
    if (champion && classFeaturesFor(characterClassLevels(champion).classes).some(feature => feature.id === 'survivor')) {
      const amount = survivorHeal(Number(champion.hp_current), Number(champion.hp_max), abilityModifier(Number(champion.constitution ?? 10)));
      if (amount > 0) {
        await q.query('UPDATE characters SET hp_current = LEAST(hp_max, hp_current + $3), revision = revision + 1 WHERE campaign_id=$1 AND id=$2', [campaignId, characterId, amount]);
        notices.push({ title: `${champion.name}: «Выживший»`, detail: `+${amount} хит. в начале хода (хитов было не больше половины).`, characterId });
      }
    }
    if (await dyingWithoutSave(q, campaignId, characterId)) {
      if (await rollsForItself(q, campaignId, characterId)) notices.push((await deathSave(q, campaignId, userId, characterId, true, false, false, entryId)).notice);
      else {
        const name = (await creature(q, campaignId, characterId)).name;
        notices.push({ title: `${name}: спасбросок от смерти`, detail: 'Бросьте сами — кнопка «Не умереть» на панели. Передадите ход без броска — приложение бросит за вас.', characterId });
      }
    }
    return notices;
  }

  async function turnBoundary(q: Queryable, campaignId: string, userId: string, characterId: string, moment: 'start' | 'end') {
    const notices: Notice[] = [];
    const row = await creature(q, campaignId, characterId);

    const rageOver = async (effect: { id: string; parameters: any }, title: string, detail: string) => {
      await q.query('DELETE FROM character_effects WHERE id=$1', [effect.id]);
      notices.push({ title, detail, characterId });
      if (effect.parameters?.frenzy === true) {
        const level = await addExhaustion(q, campaignId, characterId);
        notices.push({ title: `${row.name}: истощение ${level}`, detail: '«Бешенство» кончилось вместе с яростью.', characterId });
      }
      const back = await resumeAfterRage(q, campaignId, characterId);
      if (back.length) notices.push({ title: `${row.name}: снова ${back.join(', ')}`, detail: 'Ярость кончилась — приостановленное ею снова действует.', characterId });
    };

    for (const effect of await loadEffects(q, campaignId, characterId)) {
      const parameters = effect.parameters ?? {};
      const label = await conditionName(q, campaignId, effect.effect_code);

      if (parameters.repeatSave === moment && parameters.save && ABILITIES.includes(parameters.save.ability)) {
        const { ability, dc } = parameters.save;
        const save = await rollSaveAgainst(
          q, campaignId, userId, characterId, ability, Number(dc),
          `Спасбросок ${ABILITY_SHORT[ability]} (СЛ ${dc}) против «${label}» — ${row.name}`, false,
          null, [], { condition: effect.effect_code, magic: parameters.source === 'spell' || parameters.spellLevel !== undefined },
        );
        if (save.success) {
          await q.query('DELETE FROM character_effects WHERE id=$1', [effect.id]);
          notices.push({ title: `${row.name}: «${label}» снято`, detail: `Спасбросок ${ABILITY_GENITIVE[ability]} ${save.total} против СЛ ${dc}.`, characterId });
          continue;
        }
        notices.push({ title: `${row.name}: «${label}» держится`, detail: `Спасбросок ${ABILITY_GENITIVE[ability]} ${save.total} против СЛ ${dc}${save.autoFail ? ' — автопровал' : ''}.`, characterId });
      }

      if (moment === 'end' && effect.effect_code === 'raging'
        && rageEndsEarly(parameters.kept, await hasFeature(q, campaignId, characterId, 'persistent-rage'))) {
        await rageOver(effect, `${row.name}: ярость утихла`, 'С прошлого хода не атаковал и не получал урона.');
        continue;
      }

      if (moment === 'end' && typeof parameters.remainingRounds === 'number') {
        const remaining = parameters.remainingRounds - 1;
        if (remaining <= 0) {
          if (effect.effect_code === 'raging') await rageOver(effect, `${row.name}: «${label}» закончилось`, 'Длительность вышла.');
          else {
            await q.query('DELETE FROM character_effects WHERE id=$1', [effect.id]);
            notices.push({ title: `${row.name}: «${label}» закончилось`, detail: 'Длительность вышла.', characterId });
            if (effect.effect_code === 'spell_cast') await spellsEnded(q, campaignId, [{ character_id: characterId, parameters }]);
          }
        } else {
          const next = { ...parameters, remainingRounds: remaining, ...(effect.effect_code === 'raging' ? { kept: false } : {}) };
          await q.query('UPDATE character_effects SET parameters=$2::jsonb WHERE id=$1', [effect.id, JSON.stringify(next)]);
        }
      }
    }
    return notices;
  }

  return { afterHpChange, deathSave, endOfTurn, startOfTurn, dyingWithoutSave, ruledSaves, timePassed };
}

export type ConditionEngine = ReturnType<typeof createConditionEngine>;
