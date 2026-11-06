import { feralSenses, featSituation, alertTarget, unseenDisadvantages, unseenAdvantages, elusiveTarget, d20Traits, rollRiders, luckyDefense, d20Formula, rulingOutcome } from '../rolls/modifiers.ts';
import { hasFeat } from '../../../../../packages/domain/character/feats.ts';
import { attackSituation, attackMarks, mirrorStrike } from '../combat/attack.ts';
import { stealthAttack } from '../combat/stealth.ts';
import { invisibilitySeen } from '../combat/sight.ts';
import { loadConditionState, addCondition } from '../../rules/conditions.ts';
import { protectionStyle, shieldBonus, tryAutoShield, uncannyDodge } from '../combat/reactions.ts';
import { d20Ruling, type Ability as ConditionAbility, attackOutcome } from '../../../../../packages/domain/combat/conditions.ts';
import { withinFeet } from '../scene/movement.ts';
import { coverReason, areaCoverBonus } from '../combat/cover.ts';
import { factionBonusOf, relationsFor } from '../../campaign/factions.ts';
import { rollCheck, parseFormula, rollDice, abilityModifier } from '../../../../../packages/domain/dice/dice.ts';
import { rollDie, insertRoll } from '../rolls/dice.ts';
import { multiattackGuard, applyHpChange } from '../combat/hp.ts';
import { notifyCampaign } from '../live/notify.ts';
import { hurlOffer, shieldMasterBonus, hasEvasion, shieldMasterDodge } from '../../rules/class-features.ts';
import { findMonster } from '../../../../../packages/domain/world/bestiary.ts';
import { creatureTypeOf } from './rules.ts';
import { hasRaceTrait, characterRace } from '../../../../../packages/domain/character/races.ts';
import { sleepers } from '../../../../../packages/domain/spells/spell-riders.ts';
import { spellShape } from '../../../../../packages/domain/spells/summons.ts';
import { classFeaturesFor, discipleOfLifeBonus } from '../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { rollSaveAgainst } from '../rolls/checks.ts';
import type { TableContext } from '../context.ts';
import type { Queryable } from '../../db.ts';
import type { CastSpellParams } from '../shared.ts';
import type { CastBody } from './cast.ts';
import type { CastSetup } from './prepare.ts';
import type { CastDice } from './cast-dice.ts';
import type { CastAim } from './aim.ts';
import type { CastEffects, CastLog } from './effects.ts';

export type CastRun = {
  ctx: TableContext;
  q: Queryable;
  userId: string;
  params: CastSpellParams;
  body: CastBody;
  setup: CastSetup;
  dice: CastDice;
  aim: CastAim;
  effects: CastEffects;
  log: CastLog;
  guarded: string[];
  misses: string[];
  inspirationSpent: boolean;
};

export async function resolveSpellAttack(run: CastRun) {
  const { inspirationSpent, q, guarded, ctx, userId, misses } = run;
  const { campaignId, characterId } = run.params;
  const { sceneId, hidden } = run.body;
  const { character, spellName, mechanics, casterStealth } = run.setup;
  const { castingAbility, resolvedDamage, rollDamageDice } = run.dice;
  const { volley, rangeFeet } = run.aim;
  const { own, attackBonus, hurt, putCondition, applyRiders, results } = run.effects;
  let damageRoll: any = null;
  let hurlAfter: { rollId: string; targetName: string; left: number } | null = null;
  let inspired = inspirationSpent;
  const casterFeral = await feralSenses(q, campaignId, characterId);
  for (const target of volley) {
    const sniperRange = rangeFeet !== null && hasFeat(character.sheet_extra, 'spell-sniper') ? rangeFeet * 2 : rangeFeet;
    const spellSituation = sceneId && target.id !== characterId
      ? await attackSituation(q, campaignId, sceneId, characterId, target.id, { kind: 'spell', name: spellName, ranged: mechanics.attack === 'ranged', rangeFeet: sniperRange })
      : null;
    const spellNotes = featSituation(character, null, spellSituation, true);
    const spellAlerted = target.id !== characterId && await alertTarget(q, campaignId, target.id);
    const spellStealth = sceneId && target.id !== characterId ? await stealthAttack(q, campaignId, sceneId, characterId, target.id, casterStealth) : null;
    const seenStates = await invisibilitySeen(q, campaignId, sceneId ?? null, characterId, target.id, own, await loadConditionState(q, campaignId, target.id));
    const marks = await attackMarks(q, campaignId, characterId, target.id, seenStates.target);
    const guard = await protectionStyle(q, campaignId, sceneId ?? null, characterId, target.id);
    if (guard) {
      marks.disadvantages.push(`«Защита»: ${guard.name}`);
      guarded.push(guard.id);
    }
    const ruling = d20Ruling({
      kind: 'attack', ability: castingAbility as ConditionAbility, own: seenStates.own, target: marks.target,
      targetWithin5ft: sceneId ? await withinFeet(q, campaignId, sceneId, characterId, target.id, 5) : null,
      extraDisadvantages: [...(spellSituation?.disadvantages ?? []), ...unseenDisadvantages(spellStealth?.disadvantages ?? [], casterFeral), ...marks.disadvantages],
      extraAdvantages: [...unseenAdvantages(spellStealth?.advantages ?? [], spellAlerted), ...marks.advantages],
      inspiration: inspired,
      noAdvantage: await elusiveTarget(q, campaignId, target.id, marks.target),
      unseenNoAdvantage: spellAlerted,
      ignoreUnseen: casterFeral,
    });
    ruling.reasons.push(...spellNotes);
    inspired = false;
    await marks.consume();
    if (spellSituation && spellSituation.cover !== 'none') ruling.reasons.push(coverReason(spellSituation.cover));
    const factionAttack = await factionBonusOf(q, campaignId, characterId, 'attack');
    const targetFaction = await factionBonusOf(q, campaignId, target.id, 'ac');
    ruling.reasons.push(...factionAttack.reasons, ...targetFaction.reasons.map(reason => `КД цели: ${reason}`));
    const spellAttackBonus = attackBonus + factionAttack.value;
    const rawSpell = rollCheck(spellAttackBonus, ruling.advantage, rollDie);
    const spellTraits = d20Traits(character, 'attack', rawSpell.results, ruling.advantage, false);
    ruling.reasons.push(...spellTraits.notes);
    const rolled = { results: spellTraits.results, kept: spellTraits.kept, total: spellTraits.kept + spellAttackBonus };
    const spellRiderDice = await rollRiders(q, campaignId, characterId, 'attack', false);
    ruling.reasons.push(...spellRiderDice.reasons);
    const roll = { ...rolled, total: rolled.total + spellRiderDice.value };
    const spellAc = target.armor_class + (spellSituation?.acBonus ?? 0) + await shieldBonus(q, campaignId, target.id) + await multiattackGuard(q, campaignId, target.id, characterId) + targetFaction.value;
    let outcome = attackOutcome(roll.kept, roll.total, spellAc, ruling.autoCritOnHit);
    const mirrored = target.id !== characterId ? await mirrorStrike(q, campaignId, target.id, characterId, roll.kept, roll.total, 20) : null;
    if (mirrored) {
      ruling.reasons.push(mirrored.reason);
      if (mirrored.redirected) outcome = { hit: false, critical: false };
    }
    if (outcome.hit) {
      const luck = await luckyDefense(ctx, q, campaignId, target.id);
      if (luck) {
        const lower = luck.die < roll.kept;
        if (lower) {
          roll.total = roll.total - roll.kept + luck.die;
          roll.kept = luck.die;
          roll.results = [...roll.results, luck.die];
          outcome = attackOutcome(roll.kept, roll.total, spellAc, ruling.autoCritOnHit);
        }
        ruling.reasons.push(`везунчик цели (${target.name}, осталось ${luck.left}): к20 — ${luck.die}${lower ? `, берётся: ${outcome.hit ? 'всё равно попадание' : 'промах'}` : ' — не меньше'}`);
      }
    }
    if (outcome.hit && roll.kept !== 20) {
      const shield = await tryAutoShield(ctx, q, campaignId, userId, sceneId ?? null, target, roll.total, spellAc);
      if (shield?.counteredBy) {
        void notifyCampaign(ctx, campaignId, { type: 'notice', title: `${target.name}: «Щит» прерван`, detail: `${shield.counteredBy} — «Контрзаклинание» наготове; ${shield.spent} потрачена, удар проходит.`, tone: 'info' });
      } else if (shield) {
        outcome = attackOutcome(roll.kept, roll.total, spellAc + 5, ruling.autoCritOnHit);
        void notifyCampaign(ctx, campaignId, { type: 'notice', title: `${target.name}: «Щит»`, detail: `Реакцией — КД ${spellAc + 5} до начала своего хода (${shield.spent}): ${roll.total} не попадает.`, tone: 'info' });
      }
    }
    const spellAttackRow = await insertRoll(
      q, campaignId, userId, characterId, `Заклинание: ${spellName} → ${target.name}`.slice(0, 100),
      `${d20Formula(spellAttackBonus, ruling.advantage)}${spellRiderDice.formula}`.slice(0, 20), roll.results, spellAttackBonus, roll.total, hidden ?? false, null,
      rulingOutcome('attack', ruling, {
        target: { id: target.id, name: target.name }, hit: outcome.hit, critical: outcome.critical,
        ...(spellRiderDice.list.length ? { riders: spellRiderDice.list } : {}),
      }),
    );
    hurlAfter = null;
    if (outcome.hit && target.kind !== 'object') {
      const offer = await hurlOffer(q, campaignId, character as any);
      if (offer) hurlAfter = { rollId: spellAttackRow.id, targetName: target.name, left: offer.left };
    }
    const entry: Record<string, unknown> = { characterId: target.id, name: target.name, attack: { total: roll.total, hit: outcome.hit, critical: outcome.critical } };
    if (outcome.hit && resolvedDamage) {
      const dealt = rollDamageDice(resolvedDamage, outcome.critical);
      const dodge = await uncannyDodge(q, campaignId, sceneId ?? null, characterId, target.id);
      if (dodge) {
        dealt.total = Math.floor(Math.max(0, dealt.total) / 2);
        void notifyCampaign(ctx, campaignId, { type: 'notice', title: `${dodge.name}: «Невероятное уклонение»`, detail: 'Реакцией — урон этой атаки вдвое меньше.', tone: 'info' });
      }
      const change = await hurt(target, Math.max(0, dealt.total), outcome.critical);
      damageRoll = await insertRoll(
        q, campaignId, userId, characterId, `Урон: ${spellName} → ${target.name}`.slice(0, 100),
        dealt.formula, dealt.results, dealt.modifier, dealt.total, hidden ?? false, null,
        { kind: 'damage', target: { id: target.id, name: target.name }, critical: outcome.critical, damageType: mechanics.damageType, applied: change.applied, blocked: change.blocked, modified: change.modified, dropped: change.dropped },
      );
      entry.damage = change.applied;
    }
    if (outcome.hit) {
      entry.condition = await putCondition(target.id);
      const effects = await applyRiders(target);
      if (effects.length) entry.effects = effects;
    } else misses.push(target.id);
    results.push(entry);
  }
  return { damageRoll, hurlAfter };
}

export async function resolveHitPointPool(run: CastRun) {
  const { q, userId } = run;
  const { campaignId, characterId } = run.params;
  const { hidden } = run.body;
  const { pool, extraLevels, spellName, effectiveLevel, character } = run.setup;
  const { targets } = run.aim;
  const { results } = run.effects;
  let damageRoll: any = null;
  let hurlAfter: { rollId: string; targetName: string; left: number } | null = null;
  if (!pool) return { damageRoll, hurlAfter };
  const poolText = pool.perSlot && extraLevels > 0
    ? (() => {
      const base = parseFormula(pool.dice)!;
      const more = parseFormula(pool.perSlot!)!;
      return `${base.count + more.count * extraLevels}d${base.sides}`;
    })()
    : pool.dice;
  const parsedPool = parseFormula(poolText)!;
  const rolledPool = rollDice(parsedPool, rollDie);
  const candidates: Array<{ id: string; name: string; hp: number; immune: boolean }> = [];
  for (const target of targets.filter(entry => entry.kind !== 'object')) {
    const state = await loadConditionState(q, campaignId, target.id);
    if (state.codes.has('unconscious') || state.codes.has('dead')) continue;
    const row = (await q.query('SELECT hp_current, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, target.id])).rows[0] as any;
    const monster = typeof row?.sheet_extra?.srdMonster === 'string' ? findMonster(row.sheet_extra.srdMonster) : undefined;
    const immune = (await creatureTypeOf(q, campaignId, target.id)) === 'undead' || /очаров|charm/i.test(`${monster?.conditionImmunities ?? ''} ${row?.sheet_extra?.conditionImmunities ?? ''}`)
      || hasRaceTrait(characterRace(row ?? {}), 'fey-ancestry');
    candidates.push({ id: target.id, name: target.name, hp: Number(row?.hp_current ?? 0), immune });
  }
  const asleep = new Set(sleepers(rolledPool.total, candidates).map(entry => entry.id));
  for (const candidate of candidates) {
    if (asleep.has(candidate.id)) {
      await addCondition(q, campaignId, candidate.id, 'unconscious', {
        source: 'spell', sourceCharacterId: characterId, sourceName: spellName, spellLevel: effectiveLevel, endsOnDamage: true, remainingRounds: 10, durationRounds: 10,
      });
    }
    results.push({ characterId: candidate.id, name: candidate.name, condition: asleep.has(candidate.id), sleep: { hp: candidate.hp, immune: candidate.immune } });
  }
  await insertRoll(
    q, campaignId, userId, characterId, `Заклинание: ${spellName} (запас хитов) — ${character.name}`.slice(0, 100),
    poolText, rolledPool.results, 0, rolledPool.total, hidden ?? false, null,
    { kind: 'pool', asleep: candidates.filter(entry => asleep.has(entry.id)).map(entry => entry.name) },
  );
  return { damageRoll, hurlAfter };
}

export async function resolveSavingThrow(run: CastRun) {
  const { q, body, ctx, userId } = run;
  const { campaignId, characterId } = run.params;
  const { templateId, sceneId, hidden } = run.body;
  const { mechanics, metamagic, character, known, castPlan, spellSchool, effectiveLevel, level, spellName } = run.setup;
  const { resolvedDamage, rollDamageDice } = run.dice;
  const { targets, areaCover } = run.aim;
  const { dc, hurt, putCondition, applyRiders, results, sharedTargets } = run.effects;
  let damageRoll: any = null;
  let hurlAfter: { rollId: string; targetName: string; left: number } | null = null;
  if (!mechanics.save) return { damageRoll, hurlAfter };
  const dealt = resolvedDamage ? rollDamageDice(resolvedDamage) : null;
  const abilityName = ({ strength: 'СИЛ', dexterity: 'ЛОВ', constitution: 'ТЕЛ', intelligence: 'ИНТ', wisdom: 'МДР', charisma: 'ХАР' } as Record<string, string>)[mechanics.save]!;
  const sides = await relationsFor(q, campaignId, [characterId, ...targets.map(target => target.id)]);
  const ally = (id: string) => id === characterId || (sides.factionsOf(characterId).length > 0 && sides.allies(characterId, id));
  const careful = new Set(metamagic === 'careful' ? targets.filter(target => ally(target.id)).slice(0, Math.max(1, abilityModifier(character.charisma))).map(target => target.id) : []);
  const willing = new Set(known.source === 'srd' && !castPlan && spellShape(known.srd_index) ? targets.filter(target => ally(target.id)).map(target => target.id) : []);
  const sculptor = /evocation|воплощени/i.test(spellSchool) && classFeaturesFor(characterClassLevels(character).classes).some(feature => feature.id === 'sculpt-spells');
  const sculpted = new Set(sculptor ? targets.filter(target => target.id !== characterId && ally(target.id)).slice(0, 1 + effectiveLevel).map(target => target.id) : []);
  const heightened = metamagic === 'heightened'
    ? (body.heightenedTargetId && targets.some(target => target.id === body.heightenedTargetId) ? body.heightenedTargetId : targets.find(target => !ally(target.id))?.id ?? null)
    : null;
  const lone = targets.length === 1 && !templateId && mechanics.save === 'dexterity';
  const potentCantrip = level === 0 && classFeaturesFor(characterClassLevels(character).classes).some(feature => feature.id === 'potent-cantrip');
  for (const target of targets) {
    const coverBonus = areaCoverBonus(areaCover.get(target.id), mechanics.save);
    const saveBonus = coverBonus ?? (lone && target.id !== characterId ? await shieldMasterBonus(q, campaignId, target.id) : null);
    const nearCaster = Boolean(sceneId) && target.id !== characterId && (await withinFeet(q, campaignId, sceneId!, target.id, characterId, 5)) === true;
    const save = careful.has(target.id) || sculpted.has(target.id)
      ? { total: dc, success: true, autoFail: false }
      : willing.has(target.id) ? { total: 0, success: false, autoFail: false }
      : await rollSaveAgainst(
        ctx, q, campaignId, userId, target.id, mechanics.save, dc, `Спасбросок ${abilityName} (СЛ ${dc}) против «${spellName}» — ${target.name}`.slice(0, 100),
        hidden ?? false, saveBonus, heightened === target.id ? ['«Повышенное заклинание»'] : [],
        { condition: mechanics.condition ?? null, magic: true, damageType: mechanics.damageType ?? null, nearCaster, casterId: characterId },
      );
    const entry: Record<string, unknown> = { characterId: target.id, name: target.name, save: { total: save.total, success: save.success, autoFail: save.autoFail } };
    if (careful.has(target.id)) entry.careful = true;
    if (willing.has(target.id)) { entry.willing = true; delete entry.save; }
    if (sculpted.has(target.id)) entry.sculpted = true;
    if (heightened === target.id) entry.heightened = true;
    if (coverBonus) entry.cover = areaCover.get(target.id);
    if (dealt) {
      const evades = mechanics.save === 'dexterity' && mechanics.halfOnSave && (await hasEvasion(q, campaignId, target.id));
      const full = Math.max(0, dealt.total);
      const shielded = !evades && !sculpted.has(target.id) && mechanics.save === 'dexterity' && mechanics.halfOnSave && save.success && full > 0
        && (await shieldMasterDodge(q, campaignId, target.id));
      if (shielded) entry.shieldMaster = true;
      const potent = level === 0 && !mechanics.halfOnSave && save.success && potentCantrip;
      const amount = sculpted.has(target.id) || shielded ? 0 : evades ? (save.success ? 0 : Math.floor(full / 2))
        : save.success ? (mechanics.halfOnSave || potent ? Math.floor(full / 2) : 0) : full;
      if (evades) entry.evasion = true;
      if (potent && amount > 0) entry.potent = true;
      if (amount > 0) entry.damage = (await hurt(target, amount, false)).applied;
      else entry.damage = 0;
    }
    if (!save.success) {
      entry.condition = await putCondition(target.id);
      const effects = await applyRiders(target);
      if (effects.length) entry.effects = effects;
    }
    results.push(entry);
  }
  if (dealt) {
    damageRoll = await insertRoll(
      q, campaignId, userId, characterId, `Заклинание: ${spellName} (урон) — ${character.name}`.slice(0, 100),
      dealt.formula, dealt.results, dealt.modifier, dealt.total, hidden ?? false, null,
      { kind: 'damage', damageType: mechanics.damageType, dc, targets: sharedTargets },
    );
  }
  return { damageRoll, hurlAfter };
}

export async function resolveSureDamage(run: CastRun) {
  const { q, userId } = run;
  const { campaignId, characterId } = run.params;
  const { hidden } = run.body;
  const { projectiles, spellName, character, mechanics } = run.setup;
  const { rollDamageDice, resolvedDamage } = run.dice;
  const { volley } = run.aim;
  const { hurt, results, putCondition, applyRiders, sharedTargets } = run.effects;
  let damageRoll: any = null;
  let hurlAfter: { rollId: string; targetName: string; left: number } | null = null;
  if (!resolvedDamage) return { damageRoll, hurlAfter };
  const dealt = rollDamageDice(resolvedDamage);
  for (const target of volley) {
    const applied = (await hurt(target, Math.max(0, dealt.total), false)).applied;
    const existing = results.find(entry => entry.characterId === target.id);
    if (existing) {
      existing.damage = Number(existing.damage ?? 0) + applied;
      existing.shots = Number(existing.shots ?? 1) + 1;
      continue;
    }
    results.push({ characterId: target.id, name: target.name, damage: applied, ...(projectiles ? { shots: 1 } : {}) });
    await putCondition(target.id);
    const effects = await applyRiders(target);
    if (effects.length) results[results.length - 1]!.effects = effects;
  }
  damageRoll = await insertRoll(
    q, campaignId, userId, characterId, `Заклинание: ${spellName} (урон) — ${character.name}`.slice(0, 100),
    dealt.formula, dealt.results, dealt.modifier, dealt.total, hidden ?? false, null,
    { kind: 'damage', damageType: mechanics.damageType, targets: sharedTargets },
  );
  return { damageRoll, hurlAfter };
}

export async function rollUntargetedDamage(run: CastRun) {
  const { q, userId } = run;
  const { campaignId, characterId } = run.params;
  const { hidden } = run.body;
  const { spellName, character } = run.setup;
  const { rollDamageDice, resolvedDamage } = run.dice;
  let damageRoll: any = null;
  let hurlAfter: { rollId: string; targetName: string; left: number } | null = null;
  if (!resolvedDamage) return { damageRoll, hurlAfter };
  const dealt = rollDamageDice(resolvedDamage);
  damageRoll = await insertRoll(
    q, campaignId, userId, characterId, `Заклинание: ${spellName} (урон) — ${character.name}`,
    dealt.formula, dealt.results, dealt.modifier, dealt.total, hidden ?? false,
  );
  return { damageRoll, hurlAfter };
}

export async function resolveHealing(run: CastRun) {
  const { q, ctx, userId } = run;
  const { campaignId, characterId } = run.params;
  const { hidden } = run.body;
  const { hpChanges } = run.log;
  const { character, effectiveLevel, mechanics, spellName } = run.setup;
  const { rollSpellDice, resolvedHealing, maxDie } = run.dice;
  const { targets } = run.aim;
  const { results } = run.effects;
  let healingRoll: any = null;
  if (!resolvedHealing) return { healingRoll };
  const supreme = classFeaturesFor(characterClassLevels(character).classes).some(feature => feature.id === 'supreme-healing');
  const healed = rollSpellDice(resolvedHealing, false, supreme ? maxDie : rollDie);
  const peak = rollSpellDice(resolvedHealing, false, maxDie).total;
  const life = effectiveLevel >= 1 && classFeaturesFor(characterClassLevels(character).classes).some(feature => feature.id === 'disciple-of-life')
    ? discipleOfLifeBonus(effectiveLevel) : 0;
  const healedTargets: Array<{ id: string; name: string; healed: number }> = [];
  if (targets.length && !mechanics.attack && !mechanics.save) {
    for (const target of targets) {
      const hopeful = (await loadConditionState(q, campaignId, target.id)).codes.has('beacon_of_hope');
      const change = await applyHpChange(ctx, q, campaignId, userId, target.id, { mode: 'heal', amount: Math.max(0, hopeful ? peak : healed.total) + life, damageType: null, critical: false });
      hpChanges.push({ characterId: target.id, mode: 'heal', change });
      healedTargets.push({ id: target.id, name: target.name, healed: change.applied });
      const existing = results.find(entry => entry.characterId === target.id);
      if (existing) existing.healed = change.applied;
      else results.push({ characterId: target.id, name: target.name, healed: change.applied });
    }
  }
  let selfHeal = 0;
  if (effectiveLevel >= 1 && healedTargets.some(entry => entry.id !== characterId) && classFeaturesFor(characterClassLevels(character).classes).some(feature => feature.id === 'blessed-healer')) {
    const change = await applyHpChange(ctx, q, campaignId, userId, characterId, { mode: 'heal', amount: discipleOfLifeBonus(effectiveLevel), damageType: null, critical: false });
    hpChanges.push({ characterId, mode: 'heal', change });
    selfHeal = change.applied;
  }
  healingRoll = await insertRoll(
    q, campaignId, userId, characterId, `Заклинание: ${spellName} (лечение) — ${character.name}`,
    healed.formula, healed.results, healed.modifier, healed.total, hidden ?? false, null,
    healedTargets.length ? {
      kind: 'heal', targets: healedTargets, ...(life ? { bonus: life } : {}),
      ...(life || selfHeal || supreme ? { reasons: [...(supreme ? ['высшее исцеление: кости наибольшие'] : []), ...(life ? [`последователь жизни +${life} каждому`] : []), ...(selfHeal ? [`благословенный целитель: сам +${selfHeal}`] : [])] } : {}),
      ...(selfHeal ? { selfHeal } : {}),
    } : null,
  );
  return { healingRoll };
}
