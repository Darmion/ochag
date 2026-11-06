import { rollMods } from '../../../../../packages/domain/spells/spell-mods.ts';
import { spellModsFor } from '../spells/rules.ts';
import { d20Ruling, type Ability as ConditionAbility } from '../../../../../packages/domain/combat/conditions.ts';
import { unseenDisadvantages, unseenAdvantages, elusiveTarget, breakCamouflage, d20Traits, spendLuckPoint, rollRiders, mightFloor } from './modifiers.ts';
import { supremeSneak } from '../combat/attack.ts';
import { revealHidden } from '../combat/stealth.ts';
import { coverReason } from '../combat/cover.ts';
import { factionBonusOf } from '../../campaign/factions.ts';
import { rollCheck } from '../../../../../packages/domain/dice/dice.ts';
import { rollDie } from './dice.ts';
import { classFeaturesFor, bardicDie, classLevelOf } from '../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { classResourceOf, spendClassResource } from '../../rules/class-features.ts';
import { notifyCampaign } from '../live/notify.ts';
import { reject } from '../shared.ts';
import { keepRage } from '../combat/hp.ts';
import type { TableContext } from '../context.ts';
import type { Queryable } from '../../db.ts';
import type { CheckBody } from './roll-check.ts';
import type { CheckPrep } from './check-prepare.ts';

export async function rollD20(ctx: TableContext, q: Queryable, campaignId: string, body: CheckBody, prep: CheckPrep) {
  const { characterId, kind, key, advantage, inspiration, sense, lucky, strokeOfLuck, bardic } = body;
  const { extraGuard, check, own, situation, target, styles, character, targetState, within5ft, sightReasons, stealth, alerted, checkHelp, sightBlocked, situationNotes, seenStates, marks, feral, horde, reckless, aids } = prep;
  let modifier = prep.modifier;
  let revealed = false;

  const templatedRuling = kind === 'attack' ? null : rollMods(await spellModsFor(q, campaignId, characterId), kind === 'save' ? 'save' : 'check', check.ability, kind === 'skill' ? key : null);
  if (templatedRuling?.spentRuling.length) await q.query('DELETE FROM character_effects WHERE id = ANY($1::uuid[])', [templatedRuling.spentRuling]);
  const ruling = d20Ruling({
    kind, ability: check.ability as ConditionAbility, own: seenStates?.own ?? own, target: marks ? marks.target : seenStates ? seenStates.target : targetState, targetWithin5ft: within5ft, requested: advantage ?? 'none',
    inspiration: inspiration === true, extraDisadvantages: [...(situation?.disadvantages ?? []), ...(feral ? [] : sightReasons), ...unseenDisadvantages(stealth?.disadvantages ?? [], feral), ...(marks?.disadvantages ?? []), ...(horde ? ['уйти от толпы'] : []), ...(templatedRuling?.disadvantages ?? [])],
    extraAdvantages: [...(templatedRuling?.advantages ?? []),
      ...unseenAdvantages(stealth?.advantages ?? [], alerted), ...(situation?.advantages ?? []), ...(marks?.advantages ?? []), ...(reckless ? ['безрассудная атака'] : []),
      ...(aids?.advantages ?? []), ...(checkHelp ? [checkHelp] : []),
      ...(kind === 'skill' && key === 'stealth' && await supremeSneak(q, campaignId, characterId) ? ['превосходная скрытность'] : []),
    ],
    sense: sense ?? null, sightBlocked,
    noAdvantage: kind === 'attack' && target ? await elusiveTarget(q, campaignId, target.id, targetState) : null,
    unseenNoAdvantage: alerted,
    ignoreUnseen: feral,
  });
  const unseen = targetState?.codes.has('invisible') || own.codes.has('blinded') || sightReasons.length > 0 || (stealth?.disadvantages ?? []).includes('цель скрыта');
  if (feral && unseen) ruling.reasons.push('дикие чувства: невидимое — без помехи');
  ruling.reasons.push(...check.notes, ...(styles?.reasons ?? []), ...situationNotes);
  if (aids?.bonus) {
    modifier += aids.bonus.value;
    ruling.reasons.push(aids.bonus.reason);
  }
  await marks?.consume();
  if (stealth?.revealAttacker) revealed = await revealHidden(q, campaignId, characterId);
  if (kind === 'attack') await breakCamouflage(ctx, q, campaignId, characterId);
  if (stealth?.sensed) ruling.reasons.push('слепое чувство: спрятавшийся рядом — без помехи');
  if (situation && situation.cover !== 'none') ruling.reasons.push(coverReason(situation.cover));
  if (kind === 'attack' && own.codes.has('sacred_weapon')) {
    const bonus = Number((await q.query(`SELECT parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='sacred_weapon' AND active`, [campaignId, characterId])).rows[0]?.parameters?.bonus ?? 1);
    modifier += bonus;
    ruling.reasons.push(`священное оружие +${bonus}`);
  }
  const factionAttack = kind === 'attack' ? await factionBonusOf(q, campaignId, characterId, 'attack') : null;
  if (factionAttack?.value) {
    modifier += factionAttack.value;
    ruling.reasons.push(...factionAttack.reasons);
  }
  const raw = rollCheck(modifier, ruling.advantage, rollDie);
  const traits = d20Traits(character, kind, raw.results, ruling.advantage, check.proficient === true);
  ruling.reasons.push(...traits.notes);
  const rolled = { results: traits.results, kept: traits.kept, total: traits.kept + modifier };
  let { results, kept } = rolled;
  if (lucky && kind !== 'attack') {
    const left = await spendLuckPoint(ctx, q, campaignId, character);
    if (left !== null) {
      const die = rollDie(20);
      ruling.reasons.push(`везунчик (очко удачи, осталось ${left}): ещё к20 — ${die}${die > kept ? `, берётся ${die}` : ''}`);
      results = [...results, die];
      if (die > kept) kept = die;
    } else {
      ruling.reasons.push('везунчик: очков удачи нет');
    }
  }
  if (strokeOfLuck && (kind === 'skill' || kind === 'ability') && kept < 20 && classFeaturesFor(characterClassLevels(character).classes).some(feature => feature.id === 'stroke-of-luck')) {
    const luck = await classResourceOf(q, campaignId, character, 'Удача', true);
    if (luck && Number(luck.current) > 0) {
      await q.query('UPDATE character_resources SET current=current-1 WHERE id=$1', [luck.id]);
      ruling.reasons.push(`удача: к20 ${kept} → 20`);
      kept = 20;
      void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
    }
  }
  const riders = await rollRiders(q, campaignId, characterId, kind, bardic === true, check.ability, kind === 'skill' ? key : null);
  ruling.reasons.push(...riders.reasons);
  let peerless = 0;
  if (body.peerless && (kind === 'skill' || kind === 'ability')) {
    const bardClasses = characterClassLevels(character).classes;
    if (!classFeaturesFor(bardClasses).some(feature => feature.id === 'peerless-skill')) reject(400, '«Непревзойдённое мастерство» — у барда Коллегии знаний с 14-го уровня.');
    await spendClassResource(q, campaignId, character, 'Вдохновение барда');
    const die = bardicDie(classLevelOf(bardClasses, 'bard', character.level));
    peerless = rollDie(die);
    ruling.reasons.push(`непревзойдённое мастерство: к${die} — +${peerless}`);
    void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
  }
  let total = kept + modifier + riders.value + peerless;
  const might = mightFloor(character, kind, check.ability, total);
  if (might.note) {
    total = might.total;
    ruling.reasons.push(might.note);
  }
  const extra: Record<string, unknown> = advantage && advantage !== 'none' ? { requested: advantage } : {};
  if (riders.list.length) extra.riders = riders.list;
  if (extraGuard) extra.protectedBy = extraGuard;
  const attackWeapon = kind === 'attack'
    ? (await q.query('SELECT name, ability, weapon_kind FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND id=$3', [campaignId, characterId, key])).rows[0] as any
    : null;
  const melee = attackWeapon ? (situation ? !situation.ranged : attackWeapon.weapon_kind !== 'ranged') : false;
  if (target && kind === 'attack' && target.id !== characterId && own.codes.has('raging')) await keepRage(q, campaignId, characterId);

  return {
    modifier, revealed, ruling, results, kept, riders, total, extra, attackWeapon, melee,
  };
}

export type CheckRoll = Awaited<ReturnType<typeof rollD20>>;
