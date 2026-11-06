import type { Queryable } from '../../db.ts';
import { classResourceOf } from '../../rules/class-features.ts';
import { hasFeat } from '../../../../../packages/domain/character/feats.ts';
import { classFeaturesFor, darkLuckCanSave } from '../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { rollMods } from '../../../../../packages/domain/spells/spell-mods.ts';
import { type Ability as ConditionAbility, d20Ruling } from '../../../../../packages/domain/combat/conditions.ts';
import { type SaveAgainst, raceSaveAdvantages, characterRace } from '../../../../../packages/domain/character/races.ts';
import { abilityModifier, rollCheck } from '../../../../../packages/domain/dice/dice.ts';
import { findSrdSkill } from '../../rules/srd-data.ts';

import { supremeSneak } from '../combat/attack.ts';
import { hunterTactic } from '../combat/hp.ts';
import { countercharmNear } from '../combat/reactions.ts';
import type { TableContext } from '../context.ts';
import { notifyCampaign } from '../live/notify.ts';
import { insertRoll, rollDie } from './dice.ts';
import { ABILITY_BY_SRD_ABBREVIATION, bardicOnFailedSave, checkModifier, consumeHelp, d20Formula, d20Traits, darkOnesOwnLuck, mightFloor, ownRollState, rollRiders, rulingOutcome, saveAids, spendLuckPoint, useLegendaryResistance } from './modifiers.ts';
import { canManageCharacter } from '../scene/placements.ts';
import { reject, type SaveBonus } from '../shared.ts';
import { creatureTypeOf, spellModsFor } from '../spells/rules.ts';

export async function rollSave(
  ctx: TableContext, q: Queryable, campaignId: string, userId: string, characterId: string, ability: string, label: string, hidden: boolean,
) {
  return rollCheckFor(ctx, q, campaignId, userId, characterId, 'save', ability, label, hidden);
}

export async function saveReroll(ctx: TableContext, q: Queryable, campaignId: string, actor: any): Promise<{ label: string; best: boolean } | null> {
  const ids = new Set(classFeaturesFor(characterClassLevels(actor).classes).map(feature => feature.id));
  const lucky = hasFeat(actor.sheet_extra, 'lucky');
  if (!ids.has('indomitable') && !ids.has('diamond-soul') && !lucky) return null;
  const rule = (await q.query(`SELECT value FROM campaign_rules WHERE campaign_id=$1 AND key='save_rerolls' AND kind='text'`, [campaignId])).rows[0]?.value;
  if (rule === 'manual') return null;
  for (const [feature, name, label] of [['indomitable', 'Упорный', 'упорный'], ['diamond-soul', 'Ци', 'алмазная душа (1 ци)']] as const) {
    if (!ids.has(feature)) continue;
    const resource = await classResourceOf(q, campaignId, actor, name, true);
    if (!resource || Number(resource.current) <= 0) continue;
    await q.query('UPDATE character_resources SET current=current-1 WHERE id=$1', [resource.id]);
    void notifyCampaign(ctx, campaignId, { type: 'character', characterId: actor.id });
    return { label, best: false };
  }
  if (lucky) {
    const left = await spendLuckPoint(ctx, q, campaignId, actor);
    if (left !== null) return { label: `везунчик (очко удачи, осталось ${left})`, best: true };
  }
  return null;
}

export async function rollCheckFor(
  ctx: TableContext, q: Queryable, campaignId: string, userId: string, characterId: string,
  kind: 'save' | 'skill', key: string, label: string, hidden: boolean, log = true, dc: number | null = null,
  extraDisadvantages: string[] = [], bonus: SaveBonus | null = null,
  against: SaveAgainst | null = null,
) {
  const actor = (
    await q.query(
      `SELECT id, name, kind, owner_user_id, level, class_name, challenge_rating::float8 AS challenge_rating, sheet_extra,
                strength, dexterity, constitution, intelligence, wisdom, charisma, legendary_resistances
         FROM characters WHERE campaign_id=$1 AND id=$2`,
      [campaignId, characterId],
    )
  ).rows[0];
  if (!actor) reject(404, 'Существо не найдено.');

  let modifier: number;
  let proficient = false;
  let checkNotes: string[] = [];
  try {
    const checked = await checkModifier(q, campaignId, actor, kind, key);
    modifier = checked.modifier;
    proficient = checked.proficient;
    checkNotes = checked.notes;
  } catch {
    const skill = kind === 'skill' ? findSrdSkill(key) : null;
    const ability = kind === 'save' ? key : skill ? ABILITY_BY_SRD_ABBREVIATION[skill.ability] : 'dexterity';
    modifier = abilityModifier(actor[ability as string]);
  }

  const skillInfo = kind === 'skill' ? findSrdSkill(key) : null;
  const rollAbility = (kind === 'save' ? key : skillInfo ? ABILITY_BY_SRD_ABBREVIATION[skillInfo.ability] : 'dexterity') as ConditionAbility;
  const own = await ownRollState(q, campaignId, actor.id);
  const aids = kind === 'save' ? await saveAids(q, campaignId, actor.id, rollAbility, own) : null;
  const raceAdvantages = kind === 'save' ? raceSaveAdvantages(characterRace(actor), rollAbility, against) : [];
  if (kind === 'skill') {
    const helped = await consumeHelp(q, campaignId, actor.id);
    if (helped) raceAdvantages.push(helped);
  }
  if (kind === 'save' && against?.concentration && hasFeat(actor.sheet_extra, 'war-caster')) raceAdvantages.push('боевой заклинатель');
  if (kind === 'save' && against?.nearCaster && hasFeat(actor.sheet_extra, 'mage-slayer')) raceAdvantages.push('убийца магов');
  if (kind === 'save' && against?.condition === 'frightened' && await hunterTactic(q, campaignId, actor.id, 'steel-will')) raceAdvantages.push('стальная воля');
  if (kind === 'save' && (against?.condition === 'frightened' || against?.condition === 'charmed')) {
    const bard = await countercharmNear(q, campaignId, actor.id);
    if (bard) raceAdvantages.push(`контрочарование${bard === actor.name ? '' : ` (${bard})`}`);
  }
  if (kind === 'save' && against?.magic && against.casterId && own.codes.has('holy_nimbus')) {
    const type = await creatureTypeOf(q, campaignId, against.casterId);
    if (type === 'fiend' || type === 'undead') raceAdvantages.push('святой нимб');
  }
  if (kind === 'skill' && key === 'stealth' && await supremeSneak(q, campaignId, actor.id)) raceAdvantages.push('превосходная скрытность');
  const templatedRuling = rollMods(await spellModsFor(q, campaignId, actor.id), kind === 'save' ? 'save' : 'check', rollAbility, kind === 'skill' ? key : null);
  const ruling = d20Ruling({
    kind, ability: rollAbility, own, extraDisadvantages: [...extraDisadvantages, ...templatedRuling.disadvantages],
    extraAdvantages: [...(aids?.advantages ?? []), ...raceAdvantages, ...templatedRuling.advantages],
  });
  if (templatedRuling.spentRuling.length) await q.query('DELETE FROM character_effects WHERE id = ANY($1::uuid[])', [templatedRuling.spentRuling]);
  ruling.reasons.push(...checkNotes);
  if (aids?.bonus) {
    modifier += aids.bonus.value;
    ruling.reasons.push(aids.bonus.reason);
  }
  if (bonus?.value) {
    modifier += bonus.value;
    ruling.reasons.push(bonus.reason);
  }
  const raw = rollCheck(modifier, ruling.advantage, rollDie);
  const traits = d20Traits(actor, kind, raw.results, ruling.advantage, proficient);
  ruling.reasons.push(...traits.notes);
  const rolled = { results: traits.results, kept: traits.kept, total: traits.kept + modifier };
  let { results } = rolled;
  let keptDie = rolled.kept;
  const riders = await rollRiders(q, campaignId, actor.id, kind, false, rollAbility, kind === 'skill' ? key : null);
  ruling.reasons.push(...riders.reasons);
  let total = rolled.total + riders.value;
  const might = mightFloor(actor, kind, rollAbility, total);
  if (might.note) {
    total = might.total;
    ruling.reasons.push(might.note);
  }
  if (kind === 'save' && dc !== null && !ruling.autoFail && total < dc) {
    const spent = await saveReroll(ctx, q, campaignId, actor);
    if (spent) {
      const again = d20Traits(actor, kind, rollCheck(modifier, ruling.advantage, rollDie).results, ruling.advantage, proficient);
      ruling.reasons.push(...again.notes);
      const next = again.kept + modifier + riders.value;
      const keepNew = !spent.best || next > total;
      ruling.reasons.push(`${spent.label}: переброс ${total} → ${next}${spent.best && !keepNew ? ' (остаётся прежний)' : ''}`);
      if (keepNew) {
        results = again.results;
        total = next;
        keptDie = again.kept;
      }
    }
  }
  if (kind === 'save' && dc !== null && !ruling.autoFail && total < dc) {
    const extra = await bardicOnFailedSave(q, campaignId, actor.id, dc - total);
    if (extra) {
      total += extra.value;
      riders.list.push(extra);
      ruling.reasons.push(`${extra.label} ${extra.die}: +${extra.value}${total >= dc ? ' — спасбросок удался' : ' — не хватило'}`);
    }
  }
  if (dc !== null && !ruling.autoFail && darkLuckCanSave(total, dc)) {
    const luck = await darkOnesOwnLuck(q, campaignId, actor);
    if (luck !== null) {
      total += luck;
      riders.list.push({ label: 'удача тёмного', die: '+к10', value: luck });
      ruling.reasons.push(`удача тёмного +к10: +${luck}${total >= dc ? ' — удалось' : ' — не хватило'}`);
    }
  }
  let success = dc === null ? null : !ruling.autoFail && total >= dc;
  if (success !== null && !ruling.autoFail && (keptDie === 20 || keptDie === 1)) {
    const rule = (await q.query(`SELECT value FROM campaign_rules WHERE campaign_id=$1 AND key='natural_checks' AND kind='text'`, [campaignId])).rows[0]?.value;
    if (rule === 'auto' && success !== (keptDie === 20)) {
      success = keptDie === 20;
      ruling.reasons.push(keptDie === 20 ? 'натуральная 20 — успех (правило мастера)' : 'натуральная 1 — провал (правило мастера)');
    }
  }
  let legendaryLeft: number | null = null;
  if (kind === 'save' && success === false && actor.kind === 'npc' && Number(actor.legendary_resistances ?? 0) > 0) {
    legendaryLeft = await useLegendaryResistance(q, campaignId, actor);
    if (legendaryLeft !== null) {
      success = true;
      ruling.reasons.push(`легендарное сопротивление: провал → успех (осталось ${legendaryLeft})`);
    }
  }
  if (legendaryLeft !== null) {
    void notifyCampaign(ctx, campaignId, { type: 'character', characterId: actor.id });
    if (!hidden) {
      void notifyCampaign(ctx, campaignId, {
        type: 'notice', title: `${actor.name}: «Легендарное сопротивление»`,
        detail: `Спасбросок провален (${total} против СЛ ${dc}) — босс решает преуспеть. Осталось на сегодня: ${legendaryLeft}.`, tone: 'info',
      });
      void notifyCampaign(ctx, campaignId, { type: 'float', characterId: actor.id, text: 'легендарное сопротивление', tone: 'info' });
    }
  }
  if (!log) return { total, roll: null, autoFail: ruling.autoFail, success };
  const roll = await insertRoll(
    q, campaignId, userId, actor.id, label,
    `${d20Formula(modifier, ruling.advantage)}${riders.formula}`.slice(0, 20), results, modifier, total, hidden, null,
    rulingOutcome(kind, ruling, {
      ...(dc === null ? {} : { dc, success }), ...(riders.list.length ? { riders: riders.list } : {}),
      ...(legendaryLeft !== null ? { legendaryResistance: { left: legendaryLeft } } : {}),
    }),
  );
  return { total, roll, autoFail: ruling.autoFail, success };
}

export async function rollSaveAgainst(
  ctx: TableContext, q: Queryable, campaignId: string, userId: string, characterId: string, ability: string, dc: number, label: string, hidden: boolean,
  bonus: SaveBonus | null = null, disadvantages: string[] = [], against: SaveAgainst | null = null,
) {
  const rolled = await rollCheckFor(ctx, q, campaignId, userId, characterId, 'save', ability, label, hidden, true, dc, disadvantages, bonus, against);
  return { total: rolled.total, roll: rolled.roll, autoFail: rolled.autoFail, success: rolled.success === true };
}

export async function rollSkill(
  q: Queryable, member: any, campaignId: string, userId: string, actorId: string, skill: string, what: string,
) {
  const actor = (
    await q.query(
      `SELECT id, name, owner_user_id, level, challenge_rating::float8 AS challenge_rating, sheet_extra, class_name,
                strength, dexterity, constitution, intelligence, wisdom, charisma
         FROM characters WHERE campaign_id=$1 AND id=$2`,
      [campaignId, actorId],
    )
  ).rows[0];
  if (!actor) reject(404, 'Персонаж не найден.');
  if (!(await canManageCharacter(q, member, userId, actor.owner_user_id, actor.id))) {
    reject(403, 'Действовать можно своим персонажем.');
  }

  const check = await checkModifier(q, campaignId, actor, 'skill', skill);
  const helped = await consumeHelp(q, campaignId, actor.id);
  const ruling = d20Ruling({ kind: 'skill', ability: check.ability as ConditionAbility, own: await ownRollState(q, campaignId, actor.id), extraAdvantages: helped ? [helped] : [] });
  ruling.reasons.push(...check.notes);
  const traits = d20Traits(actor, 'skill', rollCheck(check.modifier, ruling.advantage, rollDie).results, ruling.advantage, check.proficient === true);
  ruling.reasons.push(...traits.notes);
  const results = traits.results;
  const might = mightFloor(actor, 'skill', check.ability, traits.kept + check.modifier);
  if (might.note) ruling.reasons.push(might.note);
  const total = might.total;
  const roll = await insertRoll(
    q, campaignId, userId, actor.id, `${what} — ${actor.name}`,
    d20Formula(check.modifier, ruling.advantage), results, check.modifier, total, false, null, rulingOutcome('skill', ruling),
  );
  return { total, roll };
}
