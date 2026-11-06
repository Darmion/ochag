import { type MetamagicId, METAMAGIC, overchannelSelfDice } from '../../../../../packages/domain/character/class-features.ts';
import { spellShape, spellSummon } from '../../../../../packages/domain/spells/summons.ts';
import { removeCondition, addCondition } from '../../rules/conditions.ts';
import { rollDice } from '../../../../../packages/domain/dice/dice.ts';

import { announceHpChange, applyHpChange } from '../combat/hp.ts';
import { reactionAttackers, settleOpportunities } from '../combat/opportunity.ts';
import { offerRebukes, tryRetaliation } from '../combat/reactions.ts';
import { announceVisible } from '../combat/sight.ts';
import { announceRevealed } from '../combat/stealth.ts';
import type { TableContext } from '../context.ts';
import { notify, notifyCampaign, notifyUsers } from '../live/notify.ts';
import { insertRoll, rollDie } from '../rolls/dice.ts';
import { type FreeCast } from '../rolls/modifiers.ts';
import { getScene } from '../scene/board.ts';
import { campaignManagerIds, loadPlacements } from '../scene/placements.ts';
import { castSpellParams, type CastSpellParams, objectSchema, reject, uuid } from '../shared.ts';
import { castAfterCounter, type CounterResult, probeCast, startCounter } from './counterspell.ts';
import { mistyStep, SPELL_EFFECTS } from './rules.ts';
import { prepareCast } from './prepare.ts';
import { castAid, castShape, castSpellEffect, castSummon, castZone, type CastOutcome } from './outcomes.ts';
import { castDice } from './cast-dice.ts';
import { aimCast } from './aim.ts';
import { castEffects, type CastLog } from './effects.ts';
import { resolveHealing, resolveHitPointPool, resolveSavingThrow, resolveSpellAttack, resolveSureDamage, rollUntargetedDamage, type CastRun } from './resolve.ts';

export type CastBody = {
  hidden?: boolean; slotLevel?: number; targetIds?: string[]; templateId?: string; sceneId?: string; pact?: boolean; inspiration?: boolean;
  mode?: string;
  warnFriendly?: boolean;
  shots?: string[];
  metamagic?: MetamagicId;
  empowered?: boolean;
  heightenedTargetId?: string;
  racial?: boolean;
  ritual?: boolean;
  free?: FreeCast;
  overchannel?: boolean;
  beast?: string;
  conjureOption?: number;
  place?: { x: number; z: number };
  element?: string;
};

export async function castWithCounters(ctx: TableContext, userId: string, params: CastSpellParams, body: CastBody): Promise<{ status: number; body: any }> {
  const probe = body.metamagic === 'subtle' ? null : await probeCast(ctx, userId, params, body);
  if (!probe) return { status: 201, body: await performCast(ctx, userId, params, body) };
  let result: any = null;
  const pending = await startCounter(ctx, {
    campaignId: params.campaignId, sceneId: probe.sceneId, userId,
    casterId: params.characterId, casterName: probe.casterName, spellName: probe.spellName, spellLevel: probe.spellLevel,
    resume: async countered => { result = await castAfterCounter(ctx, userId, params, body, probe.spellName, probe.casterName, countered); },
  }, probe.reactors);
  if (pending) return { status: 202, body: { pending } };
  return { status: 201, body: result };
}

export async function performCast(ctx: TableContext, userId: string, params: CastSpellParams, body: CastBody, countered: CounterResult | null = null) {
  const { db, membership } = ctx;
  const { campaignId, characterId } = params;
  const { hidden, targetIds, templateId, sceneId } = body;
  let casterRevealed = false;
  let becameVisible: string | null = null;
  let inspirationSpent = false;
  const guarded: string[] = [];
  const tempGiven: string[] = [];
  if (templateId && !sceneId) reject(400, 'Для области нужна сцена (sceneId).');
  let castEconomyScene: string | null = null;
  const hpChanges: Array<{ characterId: string; mode: 'damage' | 'heal'; change: any }> = [];
  const misses: string[] = [];
  const spellBlessings: Array<{ characterId: string; name: string; value: number }> = [];
  const log: CastLog = { tempGiven, hpChanges, spellBlessings, pushed: false };

  const result = await db.transaction(async q => {
    const member = await membership(q, campaignId, userId, true);
    const setup = await prepareCast(ctx, q, member, userId, params, body);
    casterRevealed = setup.casterRevealed;
    becameVisible = setup.becameVisible;
    castEconomyScene = setup.castEconomyScene;
    const {
      character, known, spellName, spellRange, concentration, mechanics, castPlan,
      templateSpell, riders, pool, freeCast,
      freeLeft, effectiveLevel, metamagicSpent, slot,
    } = setup;

    if (countered) {
      return { slot, damageRoll: null, healingRoll: null, concentrating: null, targets: [], dc: null, attackBonus: null, mechanics, countered };
    }
    if (body.inspiration) {
      if (!mechanics.attack) reject(400, `Вдохновение тратится на бросок: у «${spellName}» нет броска атаки (спасбросок бросает цель).`);
      if (!(targetIds ?? []).length && !templateId) reject(400, 'Вдохновение — на атаку по цели: выберите цель.');
      const spent = (
        await q.query('UPDATE characters SET inspiration=false, revision=revision+1 WHERE campaign_id=$1 AND id=$2 AND inspiration RETURNING id', [campaignId, characterId])
      ).rows[0];
      if (!spent) reject(400, `У «${character.name}» нет вдохновения.`);
      inspirationSpent = true;
    }
    const dice = await castDice(ctx, q, params, body, setup);
    const {
      castingAbility, resolvedDamage, resolvedHealing, overchannel, affinityBonus, evocationBonus, adept, factionDamage,
    } = dice;
    const aim = await aimCast(ctx, q, userId, params, body, setup, dice);
    const {
      targets, zoneTemplate, areaBlocked,
    } = aim;
    let damageRoll = null;
    let healingRoll = null;
    const effects = await castEffects(ctx, q, userId, params, body, setup, dice, aim, log);
    const {
      dc, attackBonus, results, previousConcentration, held, lightRider, selfLight, shedLight,
      darknessRider, dawnRider, putCondition, applyRiders,
    } = effects;

    let hurlAfter: { rollId: string; targetName: string; left: number } | null = null;
    const run: CastRun = { ctx, q, userId, params, body, setup, dice, aim, effects, log, guarded, misses, inspirationSpent };
    if (targets.length && mechanics.attack) ({ damageRoll, hurlAfter } = await resolveSpellAttack(run));
    else if (pool && targets.length) ({ damageRoll, hurlAfter } = await resolveHitPointPool(run));
    else if (targets.length && mechanics.save) ({ damageRoll, hurlAfter } = await resolveSavingThrow(run));
    else if (targets.length && resolvedDamage) ({ damageRoll, hurlAfter } = await resolveSureDamage(run));
    else if (resolvedDamage) ({ damageRoll, hurlAfter } = await rollUntargetedDamage(run));

    if (resolvedHealing) healingRoll = (await resolveHealing(run)).healingRoll;

    if (targets.length && !mechanics.attack && !mechanics.save && !resolvedDamage && !resolvedHealing && mechanics.condition) {
      for (const target of targets) results.push({ characterId: target.id, name: target.name, condition: await putCondition(target.id) });
    }
    const riderTargets = targets.length ? targets
      : /^(self|на себя)/i.test((spellRange ?? '').trim()) || lightRider || darknessRider ? [{ id: characterId, name: character.name as string, kind: 'character', armor_class: 0 }] : [];
    const templateEffects = Boolean(castPlan && (castPlan.mods.length || castPlan.conditions.length || castPlan.codes.length || castPlan.removals.length || castPlan.weapon));
    if (riderTargets.length && !mechanics.attack && !mechanics.save && !resolvedDamage && !pool && (riders.length || templateEffects)) {
      for (const target of riderTargets) {
        const effects = await applyRiders(target);
        if (!effects.length) continue;
        const existing = results.find(entry => entry.characterId === target.id);
        if (existing) existing.effects = effects;
        else results.push({ characterId: target.id, name: target.name, effects, condition: true });
      }
    }

    if (selfLight) {
      await shedLight(characterId);
      const existing = results.find(entry => entry.characterId === characterId);
      if (existing) existing.effects = [...((existing.effects as string[] | undefined) ?? []), 'светится'];
      else results.push({ characterId, name: character.name, effects: ['светится'], condition: true });
    }
    if (sceneId && ((darknessRider && darknessRider.dispelsLight > 0) || (dawnRider && lightRider))) {
      const scene = await getScene(q, campaignId, sceneId, false);
      const placements = await loadPlacements(q, campaignId, sceneId);
      const mine = (await q.query(
        `SELECT character_id FROM character_effects WHERE campaign_id=$1 AND active AND effect_code=$2 AND parameters->>'sourceCharacterId'=$3 AND parameters->>'sourceName'=$4`,
        [campaignId, darknessRider ? 'spell_darkness' : 'spell_light', characterId, spellName],
      )).rows.map(row => row.character_id as string);
      const myRadius = darknessRider ? darknessRider.radius : lightRider!.bright;
      const upTo = darknessRider ? darknessRider.dispelsLight : dawnRider!.upTo;
      const others = (await q.query(
        `SELECT id, character_id, parameters FROM character_effects WHERE campaign_id=$1 AND active AND effect_code=$2`,
        [campaignId, darknessRider ? 'spell_light' : 'spell_darkness'],
      )).rows as Array<{ id: string; character_id: string; parameters: any }>;
      const spots = (id: string) => placements.filter(placement => placement.character_id === id);
      const dispelled: string[] = [];
      for (const other of others) {
        if (Number(other.parameters?.spellLevel ?? 0) > upTo) continue;
        const theirRadius = darknessRider ? Number(other.parameters?.bright ?? 0) + Number(other.parameters?.dim ?? 0) : Number(other.parameters?.radius ?? 0);
        const touched = mine.some(holder => spots(holder).some(a => spots(other.character_id).some(b =>
          Math.hypot(a.world_x - b.world_x, a.world_z - b.world_z) * scene.feet_per_unit < myRadius + theirRadius - 1e-9)));
        if (!touched) continue;
        await q.query('DELETE FROM character_effects WHERE id=$1', [other.id]);
        const concentrating = typeof other.parameters?.concentrationOf === 'string' ? other.parameters.concentrationOf : null;
        if (concentrating) await removeCondition(q, campaignId, concentrating, 'concentration');
        const what = `рассеяно: «${other.parameters?.sourceName ?? (darknessRider ? 'свет' : 'тьма')}»`;
        if (!dispelled.includes(what)) dispelled.push(what);
      }
      if (dispelled.length) {
        const existing = results.find(entry => entry.characterId === characterId);
        if (existing) existing.effects = [...((existing.effects as string[] | undefined) ?? []), ...dispelled];
        else results.push({ characterId, name: character.name, effects: dispelled, condition: true });
      }
    }

    const outcome: CastOutcome = { userId, campaignId, characterId, sceneId, body, setup, targets, results, held, castingAbility, zoneTemplate, dc };
    const effect = known.source === 'srd' && !castPlan ? SPELL_EFFECTS[known.srd_index as string] : undefined;
    if (effect) {
      await castSpellEffect(q, outcome, effect);
    }

    const aid = known.source === 'srd' && !castPlan ? known.srd_index as string : '';
    if (aid === 'spare-the-dying' || aid === 'revivify' || aid === 'raise-dead' || aid === 'greater-restoration') {
      await castAid(q, outcome, aid);
    }

    if (aid === 'misty-step' || castPlan?.teleportFeet) {
      if (!sceneId || !body.place) reject(400, `«${spellName}»: куда шагнуть — щелчок по карте.`);
      const feet = await mistyStep(q, campaignId, sceneId!, characterId, body.place!, spellName, castPlan?.teleportFeet ?? 30);
      results.push({ characterId, name: character.name, notes: [`перенёсся на ${feet} фт.`] });
    }

    const summonRule = known.source === 'srd' && !castPlan ? spellSummon(known.srd_index) : null;
    if (summonRule) {
      await castSummon(q, outcome, summonRule);
    }

    const shapeRule = known.source === 'srd' && !castPlan ? spellShape(known.srd_index) : null;
    if (shapeRule) {
      await castShape(q, outcome, shapeRule);
    }

    let overchannelUsed: { uses: number; damage: number } | null = null;
    if (overchannel) {
      const strain = (await q.query(
        `SELECT id, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='overchannel' AND active LIMIT 1`, [campaignId, characterId],
      )).rows[0] as { id: string; parameters: any } | undefined;
      const usesBefore = Number(strain?.parameters?.uses ?? 0);
      if (strain) await q.query('UPDATE character_effects SET parameters=$2::jsonb WHERE id=$1', [strain.id, JSON.stringify({ ...strain.parameters, uses: usesBefore + 1 })]);
      else await addCondition(q, campaignId, characterId, 'overchannel', { source: 'feature', sourceName: 'Сверхзаряд', uses: 1 });
      const dice = overchannelSelfDice(usesBefore, effectiveLevel);
      let selfDamage = 0;
      if (dice) {
        const rolled = rollDice({ count: dice, sides: 12, modifier: 0 }, rollDie);
        const change = await applyHpChange(ctx, q, campaignId, userId, characterId, {
          mode: 'damage', amount: rolled.total, damageType: 'necrotic', critical: false, ignoreResistance: true, ignoreImmunity: true,
        });
        hpChanges.push({ characterId, mode: 'damage', change });
        selfDamage = change.applied;
        await insertRoll(
          q, campaignId, userId, characterId, `Сверхзаряд: некротический урон себе — ${character.name}`.slice(0, 100),
          `${dice}d12`, rolled.results, 0, rolled.total, hidden ?? false, null,
          { kind: 'damage', target: { id: characterId, name: character.name }, damageType: 'necrotic', applied: change.applied, dropped: change.dropped, reasons: [`сверхзаряд ${usesBefore + 1}-й раз с долгого отдыха`] },
        );
      }
      overchannelUsed = { uses: usesBefore + 1, damage: selfDamage };
    }

    let concentrating: { spellName: string; replaced: string | null } | null = null;
    if (concentration) {
      await addCondition(q, campaignId, characterId, 'concentration', { source: 'spell', spellName });
      concentrating = { spellName, replaced: previousConcentration };
    }

    if (zoneTemplate && mechanics.createsZone) {
      await castZone(q, outcome);
    }

    return {
      slot, damageRoll, healingRoll, concentrating, targets: results, dc, attackBonus, mechanics, ...(inspirationSpent ? { inspiration: true } : {}),
      ...(metamagicSpent ? { metamagic: { ...metamagicSpent, ...(dice.empowerRerolled ? { rerolled: dice.empowerRerolled } : {}) } } : {}),
      ...(dice.affinityAdded && affinityBonus ? { affinity: { bonus: affinityBonus, damageType: mechanics.damageType } } : {}),
      ...(dice.affinityAdded && evocationBonus ? { empoweredEvocation: evocationBonus } : {}),
      ...(factionDamage.value && resolvedDamage ? { factionDamage: { value: factionDamage.value, reasons: factionDamage.reasons } } : {}),
      ...(adept && damageRoll ? { elementalAdept: { damageType: mechanics.damageType, raised: dice.adeptRaised } } : {}),
      ...(freeCast ? { free: { kind: body.free, label: freeCast.label, ...(freeLeft !== null ? { left: freeLeft } : {}) } } : {}),
      ...(zoneTemplate ? { areaShape: zoneTemplate.shape } : {}),
      ...(areaBlocked ? { areaBlocked } : {}),
      ...(overchannelUsed ? { overchannel: overchannelUsed } : {}),
      ...(hurlAfter ? { hurl: hurlAfter } : {}),
      ...(castPlan && templateSpell ? { template: { spellId: templateSpell.id, spellName, casterName: character.name as string, notify: templateSpell.notify, manual: castPlan.manual, messages: castPlan.messages } } : {}),
    };
  });
  const templated = (result as any).template as { spellId: string; spellName: string; casterName: string; notify: boolean; manual: string[]; messages: Array<{ audience: string; text: string }> } | undefined;
  if (templated) {
    const managers = await campaignManagerIds(ctx, campaignId);
    if (templated.notify && templated.manual.length) {
      void notifyUsers(ctx, campaignId, managers, { type: 'spell-special', spellId: templated.spellId, spellName: templated.spellName, casterName: templated.casterName, items: templated.manual });
    }
    for (const message of templated.messages.filter(entry => entry.text.trim())) {
      const notice = { type: 'notice', title: `«${templated.spellName}»`, detail: message.text, tone: 'info' };
      if (message.audience === 'gm') void notifyUsers(ctx, campaignId, managers, notice);
      else if (message.audience === 'target') {
        const ids = result.targets.map((entry: any) => entry.characterId).filter(Boolean);
        const owners = ids.length ? (await db.query('SELECT DISTINCT owner_user_id FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[]) AND owner_user_id IS NOT NULL', [campaignId, ids])).rows.map(row => row.owner_user_id as string) : [];
        void notifyUsers(ctx, campaignId, [...new Set([...owners, ...managers])], notice);
      } else void notifyCampaign(ctx, campaignId, notice);
    }
  }
  if ((result as any).free) {
    void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
    void notifyCampaign(ctx, campaignId, { type: 'float', characterId, text: (result as any).free.label, tone: 'info' });
  }
  if ((result as any).metamagic) {
    void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
    void notifyCampaign(ctx, campaignId, { type: 'float', characterId, text: (result as any).metamagic.name.split(' ')[0].toLowerCase(), tone: 'info' });
  }

  if (result.damageRoll || result.healingRoll || result.targets.length) void notifyCampaign(ctx, campaignId, { type: 'rolls' });
  if (log.pushed && sceneId) void notify(ctx, campaignId, sceneId);
  if ((result as any).areaBlocked && sceneId) {
    void notify(ctx, campaignId, sceneId);
    void notifyCampaign(ctx, campaignId, { type: 'float', characterId, text: 'точка — у преграды', tone: 'info' });
  }
  for (const id of tempGiven) {
    void notifyCampaign(ctx, campaignId, { type: 'character', characterId: id });
    void notifyCampaign(ctx, campaignId, { type: 'changed' });
  }
  if (guarded.length && sceneId) void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
  if (result.targets.some(entry => entry.effects)) {
    void notifyCampaign(ctx, campaignId, { type: 'changed' });
    for (const entry of result.targets) if (entry.effects) void notifyCampaign(ctx, campaignId, { type: 'character', characterId: entry.characterId as string });
  }
  if (inspirationSpent) {
    void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
    void notifyCampaign(ctx, campaignId, { type: 'float', characterId, text: 'вдохновение', tone: 'xp' });
  }
  for (const entry of hpChanges) announceHpChange(ctx, campaignId, entry.characterId, entry.mode, entry.change);
  for (const blessing of spellBlessings) {
    void notifyCampaign(ctx, campaignId, { type: 'character', characterId: blessing.characterId });
    void notifyCampaign(ctx, campaignId, { type: 'float', characterId: blessing.characterId, text: `+${blessing.value} врем. хитов`, tone: 'info' });
  }
  if (castEconomyScene) void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId: castEconomyScene });
  if (casterRevealed) announceRevealed(ctx, campaignId, characterId, sceneId ?? null);
  if (becameVisible) announceVisible(ctx, campaignId, characterId, becameVisible);
  if (sceneId) {
    for (const entry of result.targets as Array<Record<string, any>>) {
      if (entry.characterId === characterId) continue;
      const effect = entry.attack ? (entry.attack.critical ? 'crit' : entry.attack.hit ? 'hit' : 'miss')
        : entry.save ? (entry.save.success ? 'miss' : 'hit') : entry.damage ? 'hit' : entry.healed ? 'heal' : null;
      if (effect) {
        void notifyCampaign(ctx, campaignId, {
          type: 'attack', sceneId, attackerId: characterId, targetId: entry.characterId, source: 'spell', effect, ranged: true,
          damageType: (result as any).mechanics?.damageType ?? null, area: (result as any).areaShape ?? null,
        });
      }
    }
  }
  for (const id of misses) void notifyCampaign(ctx, campaignId, { type: 'hp', characterId: id, mode: 'miss', amount: 0, blocked: null, modified: null, critical: false });
  if (result.targets.some(entry => entry.condition)) {
    void notifyCampaign(ctx, campaignId, { type: 'changed' });
    for (const entry of result.targets) if (entry.condition) void notifyCampaign(ctx, campaignId, { type: 'character', characterId: entry.characterId });
  }
  if (result.concentrating) {
    void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
    void notifyCampaign(ctx, campaignId, { type: 'changed' });
  }
  const wounded = hpChanges.filter(entry => entry.mode === 'damage' && Number(entry.change?.applied ?? 0) > 0).map(entry => entry.characterId);
  if (wounded.length) void offerRebukes(ctx, campaignId, sceneId ?? null, characterId, wounded);
  if (wounded.length && sceneId) for (const id of new Set(wounded)) await tryRetaliation(ctx, campaignId, sceneId, id, characterId);
  try {
    const castScene = sceneId ?? (
      await db.query(`SELECT scene_id FROM initiative_entries WHERE campaign_id=$1 AND character_id=$2 ORDER BY is_current DESC, created_at LIMIT 1`, [campaignId, characterId])
    ).rows[0]?.scene_id ?? null;
    if (castScene) {
      const attacked = (result.targets as Array<Record<string, any>>).filter(entry => entry.attack && entry.characterId !== characterId).map(entry => String(entry.characterId));
      if (attacked.length) await settleOpportunities(ctx, campaignId, await db.transaction(q => reactionAttackers(q, campaignId, castScene, characterId, 'sentinel', attacked)));
      await settleOpportunities(ctx, campaignId, await db.transaction(q => reactionAttackers(q, campaignId, castScene, characterId, 'mage-slayer')));
    }
  } catch {
  }

  return result;
}

export function registerCastRoutes(ctx: TableContext) {
  const { app, auth } = ctx;

  app.post<{ Params: CastSpellParams; Body: CastBody }>(
    '/campaigns/:campaignId/characters/:characterId/spells/:characterSpellId/cast',
    {
      schema: {
        params: castSpellParams,
        body: {
          type: 'object', additionalProperties: false,
          properties: {
            hidden: { type: 'boolean' },
            slotLevel: { type: 'integer', minimum: 1, maximum: 9 },
            targetIds: { type: 'array', maxItems: 30, uniqueItems: true, items: uuid },
            templateId: uuid,
            sceneId: uuid,
            pact: { type: 'boolean' },
            inspiration: { type: 'boolean' },
            warnFriendly: { type: 'boolean' },
            shots: { type: 'array', maxItems: 12, items: uuid },
            metamagic: { type: 'string', enum: METAMAGIC.map(entry => entry.id) },
            empowered: { type: 'boolean' },
            heightenedTargetId: uuid,
            racial: { type: 'boolean' },
            ritual: { type: 'boolean' },
            free: { type: 'string', enum: ['arcanum', 'mastery', 'signature'] },
            overchannel: { type: 'boolean' },
            beast: { type: 'string', minLength: 1, maxLength: 64 },
            conjureOption: { type: 'integer', minimum: 0, maximum: 3 },
            element: { type: 'string', enum: ['acid', 'cold', 'fire', 'lightning', 'thunder'] },
            place: objectSchema({ x: { type: 'number', minimum: -1000, maximum: 1000 }, z: { type: 'number', minimum: -1000, maximum: 1000 } }, ['x', 'z']),
            mode: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const done = await castWithCounters(ctx, userId, request.params, request.body ?? {});
      return reply.code(done.status).send(done.body);
    },
  );
}
