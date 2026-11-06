import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db.ts';
import { classFeaturesFor } from '../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { placementsHostile } from '../../campaign/factions.ts';
import { type EffectiveSpellMechanics, mergeSpellMechanics, deriveSpellMechanics } from '../../../../../packages/domain/spells/spell-mechanics.ts';
import { loadConditionState } from '../../rules/conditions.ts';
import { reactionBlocked, type Ability as ConditionAbility, d20Ruling, incapacitatedReason, castingUse } from '../../../../../packages/domain/combat/conditions.ts';
import { infernalLegacySpell } from '../../../../../packages/domain/character/races.ts';
import { abilityModifier, rollCheck } from '../../../../../packages/domain/dice/dice.ts';
import { findSrdSpell, srdSpellName } from '../../rules/srd-data.ts';

import { askControllers, type ReactionCandidate, reactionCandidates } from '../combat/reactions.ts';
import type { TableContext } from '../context.ts';
import { notifyCampaign, notifyUsers } from '../live/notify.ts';
import { insertRoll, rollDie } from '../rolls/dice.ts';
import { d20Formula, freeCastRule, ownRollState, rulingOutcome } from '../rolls/modifiers.ts';
import { canManageCharacter } from '../scene/placements.ts';
import { type CampaignParams, canManage, type CastSpellParams, objectSchema, reject, uuid } from '../shared.ts';
import { type CastBody, performCast } from './cast.ts';
import { assertSpellTargets } from './rules.ts';

export const counterParams = objectSchema({ campaignId: uuid, windowId: uuid });

export type CounterResult = { byId: string; byName: string; slotLevel: number; auto: boolean; check: { total: number; dc: number } | null };
export type CounterReason = 'countered' | 'declined' | 'timeout' | 'answered';
export type CounterWindow = {
  id: string; campaignId: string; sceneId: string; userId: string;
  casterId: string; casterName: string; spellName: string; spellLevel: number;
  reactors: Map<string, { name: string; ownerUserId: string | null; declined: boolean }>;
  claimed: boolean; expiresAt: number; timer: ReturnType<typeof setTimeout> | null;
  resume: (countered: CounterResult | null) => Promise<void>;
  reacted?: Set<string>;
};

export type ProbeResult = { sceneId: string; casterName: string; spellName: string; spellLevel: number; reactors: ReactionCandidate[] } | null;
export class CastProbe extends Error {
  readonly value: ProbeResult;
  constructor(value: ProbeResult) {
    super('probe');
    this.value = value;
  }
}

export function armCounterWindow(ctx: TableContext, window: CounterWindow, ms: number) {
  if (window.timer) clearTimeout(window.timer);
  window.expiresAt = Date.now() + ms;
  window.timer = setTimeout(() => {
    if (window.claimed) return;
    window.claimed = true;
    void settleCounterWindow(ctx, window, null, 'timeout');
  }, ms);
  window.timer.unref?.();
}

export function counterCandidates(q: Queryable, campaignId: string, sceneId: string, casterId: string) {
  return reactionCandidates(q, campaignId, sceneId, casterId, 'counterspell', 3, (reactor, caster) => placementsHostile(reactor, caster));
}

export async function autoReady(q: Queryable, campaignId: string, candidates: ReactionCandidate[]) {
  if (!candidates.length) return new Set<string>();
  return new Set(
    (await q.query(`SELECT id FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[]) AND 'counterspell' = ANY(auto_reactions)`, [campaignId, candidates.map(entry => entry.characterId)]))
      .rows.map(row => row.id as string),
  );
}

export async function autoCounterer(q: Queryable, campaignId: string, candidates: ReactionCandidate[], spellLevel: number) {
  if (spellLevel < 1) return null;
  const ready = await autoReady(q, campaignId, candidates);
  return candidates.find(entry => ready.has(entry.characterId)) ?? null;
}

export async function spendCounter(
  ctx: TableContext, q: Queryable, campaignId: string, characterId: string, sceneId: string,
  choice: { slotLevel?: number; pact?: boolean; enforce: boolean; prefer?: number },
): Promise<{ byId: string; byName: string; slotLevel: number }> {
  const { actionEconomy } = ctx;
  const character = (
    await q.query('SELECT id, name, pact_slots_current, pact_slot_level FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, characterId])
  ).rows[0];
  if (!character) reject(404, 'Персонаж не найден.');
  const unable = reactionBlocked(await loadConditionState(q, campaignId, characterId));
  if (unable) reject(400, `${character.name} не может ответить: ${unable}.`);
  await actionEconomy.spend(q, campaignId, characterId, 'reaction', { kind: 'spell', spellLevel: 3 }, { enforce: choice.enforce, sceneId });
  const pactLevel = Number(character.pact_slot_level ?? 0);
  const usePact = async () => {
    await q.query('UPDATE characters SET pact_slots_current = pact_slots_current - 1 WHERE campaign_id=$1 AND id=$2', [campaignId, characterId]);
    return { byId: characterId, byName: character.name as string, slotLevel: pactLevel };
  };
  if (choice.pact) {
    if (!character.pact_slots_current || pactLevel < 3) reject(400, 'Для «Контрзаклинания» нужна ячейка договора 3 уровня или выше.');
    return usePact();
  }
  const lowest = async (from: number, exact = false) => (
    await q.query(
      `SELECT level FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 AND current > 0
           AND ${exact ? 'level = $3' : 'level >= $3'} ORDER BY level LIMIT 1 FOR UPDATE`,
      [campaignId, characterId, from],
    )
  ).rows[0];
  const row = choice.slotLevel !== undefined
    ? await lowest(choice.slotLevel, true)
    : (choice.prefer ? await lowest(Math.max(3, choice.prefer)) : null) ?? await lowest(3);
  if (!row) {
    if (choice.slotLevel === undefined && character.pact_slots_current > 0 && pactLevel >= 3) return usePact();
    reject(400, choice.slotLevel !== undefined ? `Нет свободных ячеек ${choice.slotLevel} уровня — выберите другой уровень.` : 'Для «Контрзаклинания» нужна свободная ячейка 3 уровня или выше.');
  }
  await q.query('UPDATE character_spell_slots SET current = current - 1 WHERE campaign_id=$1 AND character_id=$2 AND level=$3', [campaignId, characterId, row.level]);
  return { byId: characterId, byName: character.name as string, slotLevel: Number(row.level) };
}

export async function counterCheck(
  q: Queryable, campaignId: string, userId: string, spent: { byId: string; byName: string; slotLevel: number }, spellLevel: number, spellName: string,
): Promise<CounterResult & { success: boolean }> {
  if (spellLevel <= spent.slotLevel) return { ...spent, auto: true, check: null, success: true };
  const character = (
    await q.query('SELECT spellcasting_ability, strength, dexterity, constitution, intelligence, wisdom, charisma FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, spent.byId])
  ).rows[0] as any;
  const ability = (character.spellcasting_ability ??
    (['intelligence', 'wisdom', 'charisma'] as const).reduce((best, key) => (character[key] > character[best] ? key : best), 'intelligence' as string)) as ConditionAbility;
  const modifier = abilityModifier(character[ability]);
  const dc = 10 + spellLevel;
  const ruling = d20Ruling({ kind: 'ability', ability, own: await ownRollState(q, campaignId, spent.byId) });
  const { results, total } = rollCheck(modifier, ruling.advantage, rollDie);
  const success = !ruling.autoFail && total >= dc;
  const short = ({ strength: 'СИЛ', dexterity: 'ЛОВ', constitution: 'ТЕЛ', intelligence: 'ИНТ', wisdom: 'МДР', charisma: 'ХАР' } as Record<string, string>)[ability];
  await insertRoll(
    q, campaignId, userId, spent.byId, `Контрзаклинание: ${short} (СЛ ${dc}) против «${spellName}»`.slice(0, 100),
    d20Formula(modifier, ruling.advantage), results, modifier, total, false, null, rulingOutcome('ability', ruling, { dc, success }),
  );
  return { ...spent, auto: false, check: { total, dc }, success };
}

export type CounterTarget = {
  campaignId: string; sceneId: string; userId: string;
  casterId: string; casterName: string; spellName: string; spellLevel: number;
  resume: (countered: CounterResult | null) => Promise<void>;
  reacted?: Set<string>;
};

export async function startCounter(ctx: TableContext, target: CounterTarget, known?: ReactionCandidate[]): Promise<{ windowId: string; spellName: string; expiresInMs: number } | null> {
  const { counterWindows, db, reactionWindowMs } = ctx;
  const all = (known ?? await counterCandidates(db, target.campaignId, target.sceneId, target.casterId))
    .filter(entry => !target.reacted?.has(entry.characterId));
  const auto = await autoCounterer(db, target.campaignId, all, target.spellLevel);
  if (auto) {
    const spent = await db.transaction(q => spendCounter(ctx, q, target.campaignId, auto.characterId, target.sceneId, { enforce: false, prefer: target.spellLevel }));
    announceCounterSpent(ctx, target.campaignId, target.sceneId, spent.byId);
    return (await answerCounter(ctx, target, spent, target.resume)).pending;
  }
  const ready = await autoReady(db, target.campaignId, all);
  const candidates = all.filter(entry => !ready.has(entry.characterId));
  if (!candidates.length) {
    await target.resume(null);
    return null;
  }
  const window: CounterWindow = {
    id: randomUUID(), campaignId: target.campaignId, sceneId: target.sceneId, userId: target.userId,
    casterId: target.casterId, casterName: target.casterName, spellName: target.spellName, spellLevel: target.spellLevel,
    reactors: new Map(candidates.map(entry => [entry.characterId, { name: entry.name, ownerUserId: entry.ownerUserId, declined: false }])),
    claimed: false, expiresAt: 0, timer: null, resume: target.resume, reacted: target.reacted,
  };
  counterWindows.set(window.id, window);
  armCounterWindow(ctx, window, reactionWindowMs);
  await askControllers(ctx, target.campaignId, candidates.map(entry => entry.ownerUserId), {
    type: 'counterspell', windowId: window.id, sceneId: window.sceneId, casterId: target.casterId, casterName: window.casterName,
    spellName: window.spellName, spellLevel: window.spellLevel, expiresInMs: reactionWindowMs,
    reactors: candidates.map(entry => ({ characterId: entry.characterId, name: entry.name, slots: entry.slots, pact: entry.pact })),
  });
  return { windowId: window.id, spellName: window.spellName, expiresInMs: reactionWindowMs };
}

export function announceCounterSpent(ctx: TableContext, campaignId: string, sceneId: string, characterId: string) {
  void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
  void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
}

export async function answerCounter(
  ctx: TableContext, target: CounterTarget, spent: { byId: string; byName: string; slotLevel: number }, resumeTarget: (countered: CounterResult | null) => Promise<void>,
) {
  const { db } = ctx;
  let result: (CounterResult & { success: boolean }) | null = null;
  let counteredBack = false;
  const pending = await startCounter(ctx, {
    campaignId: target.campaignId, sceneId: target.sceneId, userId: target.userId,
    casterId: spent.byId, casterName: spent.byName, spellName: 'Контрзаклинание', spellLevel: spent.slotLevel,
    reacted: new Set([...(target.reacted ?? []), spent.byId]),
    resume: async countered => {
      if (countered) {
        counteredBack = true;
        void notifyCampaign(ctx, target.campaignId, {
          type: 'notice', title: `«Контрзаклинание» ${spent.byName} прервано`, tone: 'info',
          detail: `${countered.byName} ответил своим (ячейка ${countered.slotLevel} ур.) — «${target.spellName}» сотворяется.`,
        });
        await resumeTarget(null);
        return;
      }
      result = await db.transaction(q => counterCheck(q, target.campaignId, target.userId, spent, target.spellLevel, target.spellName));
      void notifyCampaign(ctx, target.campaignId, { type: 'rolls' });
      if (!result.success) {
        void notifyCampaign(ctx, target.campaignId, {
          type: 'notice', title: `${spent.byName}: «Контрзаклинание» не удалось`, tone: 'info',
          detail: `Проверка ${result.check?.total} против СЛ ${result.check?.dc} — «${target.spellName}» сотворяется.`,
        });
      }
      const { success, ...counter } = result;
      await resumeTarget(success ? counter : null);
    },
  });
  return { pending, get result() { return result; }, get counteredBack() { return counteredBack; } };
}

export async function settleCounterWindow(ctx: TableContext, window: CounterWindow, countered: CounterResult | null, reason: CounterReason) {
  const { counterWindows } = ctx;
  counterWindows.delete(window.id);
  if (window.timer) clearTimeout(window.timer);
  void notifyCampaign(ctx, window.campaignId, {
    type: 'counterspell-closed', windowId: window.id, sceneId: window.sceneId, casterId: window.casterId, casterName: window.casterName,
    spellName: window.spellName, countered: Boolean(countered), byName: countered?.byName ?? null, reason,
  });
  await safeResume(ctx, window, countered);
}

export async function safeResume(ctx: TableContext, window: { campaignId: string; userId: string; spellName: string; resume: (countered: CounterResult | null) => Promise<void> }, countered: CounterResult | null) {
  try {
    await window.resume(countered);
  } catch (error) {
    void notifyUsers(ctx, window.campaignId, [window.userId], {
      type: 'notice', title: `«${window.spellName}» не сотворено`, detail: error instanceof Error ? error.message : 'Не удалось сотворить. Попробуйте ещё раз.', tone: 'error',
    });
  }
}

export async function castAfterCounter(ctx: TableContext, userId: string, params: CastSpellParams, body: CastBody, spellName: string, casterName: string, countered: CounterResult | null) {
  if (countered) {
    void notifyCampaign(ctx, params.campaignId, {
      type: 'notice', title: `«${spellName}» прервано`, tone: 'info',
      detail: `${countered.byName} — «Контрзаклинание» (ячейка ${countered.slotLevel} ур.)${countered.check ? `: проверка ${countered.check.total} против СЛ ${countered.check.dc}` : ''}. Заклинание «${casterName}» не действует.`,
    });
  }
  const result = await performCast(ctx, userId, params, body, countered);
  void notifyCampaign(ctx, params.campaignId, { type: 'character', characterId: params.characterId });
  return result;
}

export async function probeCast(ctx: TableContext, userId: string, params: CastSpellParams, body: CastBody): Promise<ProbeResult> {
  const { actionEconomy, db, membership } = ctx;
  const { campaignId, characterId, characterSpellId } = params;
  const { slotLevel, pact } = body;
  let probe: ProbeResult = null;
  try {
    await db.transaction(async q => {
      const member = await membership(q, campaignId, userId, true);
      const character = (
        await q.query('SELECT id, name, owner_user_id, level, class_name, sheet_extra, pact_slots_current, pact_slots_max, pact_slot_level, inspiration FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])
      ).rows[0];
      if (!character) reject(404, 'Персонаж не найден.');
      if (!(await canManageCharacter(q, member, userId, character.owner_user_id, character.id))) reject(403, 'Сотворить заклинание может только владелец персонажа или мастер.');
      const state = await loadConditionState(q, campaignId, characterId);
      const unable = incapacitatedReason(state);
      if (unable) reject(400, `${character.name} не может сотворить заклинание: ${unable}.`);
      if (state.codes.has('raging')) reject(400, `${character.name} в ярости — в ярости нельзя сотворять заклинания.`);
      if (state.codes.has('turned')) reject(400, `${character.name} изгнан — может только бежать (Рывок) или вырываться.`);
      if (state.codes.has('wild_shape') && !classFeaturesFor(characterClassLevels(character).classes).some(feature => feature.id === 'beast-spells')) {
        reject(400, `${character.name} в зверином облике — колдовать нельзя.`);
      }
      const known = (
        await q.query('SELECT source, srd_index, custom_spell_id, slotless FROM character_spells WHERE campaign_id=$1 AND character_id=$2 AND id=$3', [campaignId, characterId, characterSpellId])
      ).rows[0];
      if (!known) reject(404, 'Заклинание не найдено у этого персонажа.');
      let spellName: string;
      let level: number;
      let castingTime: string | null;
      let desc: string;
      let mechanics: EffectiveSpellMechanics;
      if (known.source === 'srd') {
        const srdSpell = findSrdSpell(known.srd_index);
        if (!srdSpell) reject(404, 'Заклинание SRD не найдено.');
        level = srdSpell.level;
        castingTime = srdSpell.castingTime ?? null;
        desc = srdSpell.desc ?? '';
        spellName = srdSpellName(known.srd_index);
        const overlay = (await q.query('SELECT * FROM srd_spell_mechanics WHERE srd_index=$1', [known.srd_index])).rows[0] as any;
        mechanics = mergeSpellMechanics(deriveSpellMechanics(srdSpell), overlay ?? null);
      } else {
        const custom = (await q.query('SELECT * FROM campaign_spells WHERE campaign_id=$1 AND id=$2', [campaignId, known.custom_spell_id])).rows[0];
        if (!custom) reject(404, 'Заклинание кампании не найдено.');
        spellName = custom.name;
        level = custom.level;
        castingTime = custom.casting_time ?? null;
        desc = custom.description ?? '';
        mechanics = mergeSpellMechanics(null, custom as any);
      }
      if (body.inspiration) {
        if (!mechanics.attack) reject(400, `Вдохновение тратится на бросок: у «${spellName}» нет броска атаки (спасбросок бросает цель).`);
        if (!character.inspiration) reject(400, `У «${character.name}» нет вдохновения.`);
      }
      await assertSpellTargets(q, campaignId, characterId, body.sceneId ?? null, body.targetIds ?? [], spellName, desc);
      if (body.metamagic === 'quickened' && castingUse(castingTime) !== 'action') reject(400, '«Ускоренное заклинание» — для заклинаний, что творятся действием.');
      await actionEconomy.spend(q, campaignId, characterId, body.metamagic === 'quickened' ? 'bonus' : castingUse(castingTime), { kind: 'spell', spellLevel: level }, {
        enforce: await actionEconomy.enforceFor(q, campaignId, await canManage(q, member, userId)), sceneId: body.sceneId ?? null,
      });
      if (known.slotless && (slotLevel !== undefined || pact)) reject(400, `«${spellName}» сотворяется без ячейки.`);
      const legacyRow = body.racial
        ? (await q.query('SELECT level, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any
        : null;
      const legacy = body.racial ? infernalLegacySpell(legacyRow ?? {}, known.source === 'srd' ? known.srd_index : null) : null;
      if (body.racial && !legacy) reject(400, `«${spellName}» не из «Дьявольского наследия» тифлинга (или ещё не по уровню).`);
      if (legacy && (slotLevel !== undefined || pact)) reject(400, `«${spellName}» по наследию — без ячейки.`);
      if (legacy?.resource) {
        const charge = (await q.query(`SELECT current FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name=$3`, [campaignId, characterId, legacy.resource])).rows[0];
        if (charge && Number(charge.current) <= 0) reject(400, `«${spellName}» по наследию уже сотворено — снова после долгого отдыха.`);
      }
      const freeProbe = body.free ? freeCastRule(character, characterSpellId, spellName, level, body.free) : null;
      if (freeProbe && (slotLevel !== undefined || pact || body.racial || body.ritual || known.slotless)) reject(400, `«${spellName}» (${freeProbe.label}) — без ячейки и своим уровнем.`);
      if (freeProbe?.resource) {
        const charge = (await q.query(`SELECT current FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name=$3`, [campaignId, characterId, freeProbe.resource])).rows[0];
        if (charge && Number(charge.current) <= 0) reject(400, `«${spellName}» (${freeProbe.label}) уже сотворено — снова после ${freeProbe.recharge === 'long' ? 'долгого' : 'короткого'} отдыха.`);
      }
      if (slotLevel !== undefined && level === 0) reject(400, 'Заговоры не тратят ячейки — повысить нечего.');
      if (slotLevel !== undefined && slotLevel < level) reject(400, 'Ячейка не может быть ниже уровня заклинания.');
      let effectiveLevel = legacy && legacy.castAt > level ? legacy.castAt : slotLevel ?? level;
      const ritualProbe = body.ritual === true;
      if (pact) {
        if (level === 0) reject(400, 'Заговоры не тратят ячейки.');
        if (!character.pact_slots_max) reject(400, 'Отдельных ячеек договора нет: они ведутся только у колдуна-мультикласса при правиле «Ячейки договора — отдельно».');
        if (level > character.pact_slot_level) reject(400, `Ячейки договора — ${character.pact_slot_level} уровня, заклинание выше.`);
        if (slotLevel !== undefined && slotLevel !== character.pact_slot_level) reject(400, `Ячейка договора тратится только на своём уровне — ${character.pact_slot_level}.`);
        if (character.pact_slots_current <= 0) reject(400, 'Ячейки договора потрачены — вернутся после короткого отдыха.');
        effectiveLevel = Number(character.pact_slot_level);
      } else if (effectiveLevel > 0 && !known.slotless && !legacy && !ritualProbe && !freeProbe) {
        const free = (
          await q.query('SELECT current FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 AND level=$3', [campaignId, characterId, effectiveLevel])
        ).rows[0];
        if (!free || free.current <= 0) reject(400, `Нет свободных ячеек ${effectiveLevel} уровня — выберите другой уровень или восстановите ячейки отдыхом.`);
      }
      const sceneId = body.sceneId ?? (
        await q.query(
          `SELECT scene_id FROM initiative_entries WHERE campaign_id=$1 AND character_id=$2 ORDER BY is_current DESC, created_at LIMIT 1`,
          [campaignId, characterId],
        )
      ).rows[0]?.scene_id ?? (
        await q.query('SELECT scene_id FROM scene_objects WHERE campaign_id=$1 AND character_id=$2 AND parent_object_id IS NULL LIMIT 1', [campaignId, characterId])
      ).rows[0]?.scene_id ?? null;
      if (!sceneId) throw new CastProbe(null);
      const reactors = await counterCandidates(q, campaignId, sceneId, characterId);
      throw new CastProbe({ sceneId, casterName: character.name, spellName, spellLevel: effectiveLevel, reactors });
    });
  } catch (error) {
    if (!(error instanceof CastProbe)) throw error;
    probe = error.value;
  }
  return probe;
}

export function registerCounterspellRoutes(ctx: TableContext) {
  const { actionEconomy, app, auth, counterWindows, db, membership } = ctx;

  app.post<{ Params: CampaignParams & { windowId: string }; Body: { characterId: string; slotLevel?: number; pact?: boolean } }>(
    '/campaigns/:campaignId/counterspell/:windowId',
    {
      schema: {
        params: counterParams,
        body: {
          type: 'object', required: ['characterId'], additionalProperties: false,
          properties: { characterId: uuid, slotLevel: { type: 'integer', minimum: 3, maximum: 9 }, pact: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, windowId } = request.params;
      const { characterId, slotLevel, pact } = request.body;
      const window = counterWindows.get(windowId);
      if (!window || window.campaignId !== campaignId || window.claimed) reject(409, 'Поздно: заклинание уже сотворено или прервано.');
      const reactor = window.reactors.get(characterId);
      if (!reactor || reactor.declined) reject(400, 'Это существо не может ответить на это заклинание.');
      window.claimed = true;
      if (window.timer) clearTimeout(window.timer);
      let spent: { byId: string; byName: string; slotLevel: number };
      try {
        spent = await db.transaction(async q => {
          const member = await membership(q, campaignId, userId, true);
          const owner = (await q.query('SELECT owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0];
          if (!owner) reject(404, 'Персонаж не найден.');
          if (!(await canManageCharacter(q, member, userId, owner.owner_user_id, characterId))) reject(403, 'Ответить реакцией может только владелец существа или мастер.');
          return spendCounter(ctx, q, campaignId, characterId, window.sceneId, { slotLevel, pact, enforce: await actionEconomy.enforceFor(q, campaignId, await canManage(q, member, userId)) });
        });
      } catch (error) {
        window.claimed = false;
        armCounterWindow(ctx, window, Math.max(3000, window.expiresAt - Date.now()));
        throw error;
      }
      counterWindows.delete(window.id);
      void notifyCampaign(ctx, campaignId, {
        type: 'counterspell-closed', windowId: window.id, sceneId: window.sceneId, casterId: window.casterId, casterName: window.casterName,
        spellName: window.spellName, countered: false, byName: spent.byName, reason: 'answered',
      });
      announceCounterSpent(ctx, campaignId, window.sceneId, characterId);
      const answer = await answerCounter(ctx, window, spent, countered => safeResume(ctx, window, countered));
      if (answer.pending) return reply.code(202).send({ pending: answer.pending, slotLevel: spent.slotLevel });
      const result = answer.result;
      return { countered: Boolean(result?.success), slotLevel: spent.slotLevel, auto: result?.auto ?? false, check: result?.check ?? null, counteredBack: answer.counteredBack };
    },
  );

  app.post<{ Params: CampaignParams & { windowId: string }; Body: { characterId: string } }>(
    '/campaigns/:campaignId/counterspell/:windowId/decline',
    {
      schema: {
        params: counterParams,
        body: { type: 'object', required: ['characterId'], additionalProperties: false, properties: { characterId: uuid } },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, windowId } = request.params;
      const { characterId } = request.body;
      const window = counterWindows.get(windowId);
      if (!window || window.campaignId !== campaignId || window.claimed) return reply.code(204).send();
      const reactor = window.reactors.get(characterId);
      if (!reactor) reject(400, 'Это существо не может ответить на это заклинание.');
      const member = await membership(db, campaignId, userId);
      if (!(await canManageCharacter(db, member, userId, reactor.ownerUserId))) reject(403, 'Отказаться может только владелец существа или мастер.');
      reactor.declined = true;
      if ([...window.reactors.values()].every(entry => entry.declined)) {
        window.claimed = true;
        await settleCounterWindow(ctx, window, null, 'declined');
      }
      return reply.code(204).send();
    },
  );
  app.addHook('onClose', async () => {
    for (const window of counterWindows.values()) if (window.timer) clearTimeout(window.timer);
    counterWindows.clear();
  });
}
