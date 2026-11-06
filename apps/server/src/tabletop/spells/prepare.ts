import { reject, canManage, type CastSpellParams } from '../shared.ts';
import { canManageCharacter } from '../scene/placements.ts';
import { loadConditionState } from '../../rules/conditions.ts';
import { incapacitatedReason, castingUse } from '../../../../../packages/domain/combat/conditions.ts';
import { classFeaturesFor, knownInvocations, METAMAGIC, knownMetamagic, metamagicCost } from '../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { breakCamouflage, canRitualCast, inCombat, spendCharge, freeCastRule } from '../rolls/modifiers.ts';
import { hiddenStealth, revealHidden } from '../combat/stealth.ts';
import { type EffectiveSpellMechanics, mergeSpellMechanics, deriveSpellMechanics, durationRounds, type SpellDamageType } from '../../../../../packages/domain/spells/spell-mechanics.ts';
import { type SpellTemplate, normalizeTemplate } from '../../../../../packages/domain/spells/spell-template.ts';
import { type CastPlan, templateCastPlan } from '../../../../../packages/domain/spells/spell-template-engine.ts';
import { findSrdSpell, srdSpellName } from '../../rules/srd-data.ts';
import { assertTemplateTargets, assertSpellTargets } from './rules.ts';
import { campaignFlag } from '../rolls/dice.ts';
import { type SpellRider, spellRiders, projectileRule, hitPointPool, targetLimit, singleTarget } from '../../../../../packages/domain/spells/spell-riders.ts';
import { infernalLegacySpell } from '../../../../../packages/domain/character/races.ts';
import { spendClassResource } from '../../rules/class-features.ts';
import { breakInvisibility } from '../combat/sight.ts';
import type { TableContext } from '../context.ts';
import type { Queryable } from '../../db.ts';
import type { CastBody } from './cast.ts';

export async function prepareCast(ctx: TableContext, q: Queryable, member: any, userId: string, params: CastSpellParams, body: CastBody) {
  const { actionEconomy } = ctx;
  const { campaignId, characterId, characterSpellId } = params;
  const { slotLevel, targetIds, templateId, sceneId, pact } = body;
  let casterRevealed = false;
  let becameVisible: string | null = null;
  let castEconomyScene: string | null = null;

  const character = (
    await q.query(
      `SELECT id, name, kind, disposition, owner_user_id, level, challenge_rating::float8 AS challenge_rating, sheet_extra, spellcasting_ability, class_name,
                  spell_save_dc_override, spell_attack_override,
                  strength, dexterity, constitution, intelligence, wisdom, charisma
           FROM characters WHERE campaign_id=$1 AND id=$2`,
      [campaignId, characterId],
    )
  ).rows[0];
  if (!character) reject(404, 'Персонаж не найден.');

  if (!(await canManageCharacter(q, member, userId, character.owner_user_id, character.id))) {
    reject(403, 'Сотворить заклинание может только владелец персонажа или мастер.');
  }

  const casterState = await loadConditionState(q, campaignId, characterId);
  const unable = incapacitatedReason(casterState);
  if (unable) reject(400, `${character.name} не может сотворить заклинание: ${unable}.`);
  if (casterState.codes.has('raging')) reject(400, `${character.name} в ярости — в ярости нельзя сотворять заклинания.`);
  if (casterState.codes.has('turned')) reject(400, `${character.name} изгнан — может только бежать (Рывок) или вырываться.`);
  if (casterState.codes.has('wild_shape') && !classFeaturesFor(characterClassLevels(character).classes).some(feature => feature.id === 'beast-spells')) {
    reject(400, `${character.name} в зверином облике — колдовать нельзя.`);
  }
  await breakCamouflage(ctx, q, campaignId, characterId);
  const casterStealth = (await hiddenStealth(q, campaignId, [characterId])).get(characterId);
  if (casterStealth !== undefined) casterRevealed = await revealHidden(q, campaignId, characterId);

  const known = (
    await q.query(
      `SELECT source, srd_index, custom_spell_id, slotless FROM character_spells
           WHERE campaign_id=$1 AND character_id=$2 AND id=$3`,
      [campaignId, characterId, characterSpellId],
    )
  ).rows[0];
  if (!known) reject(404, 'Заклинание не найдено у этого персонажа.');

  let spellName: string;
  let level: number;
  let castingTime: string | null;
  let spellRange: string | null;
  let damageFormula: string | null;
  let healingFormula: string | null;
  let upcastFormula: string | null;
  let concentration = false;
  let spellDuration = '';
  let spellSchool = '';
  let mechanics: EffectiveSpellMechanics;
  let spellTemplate: SpellTemplate | null = null;
  let castPlan: CastPlan | null = null;
  let templateSpell: { id: string; notify: boolean } | null = null;

  if (known.source === 'srd') {
    const srdSpell = findSrdSpell(known.srd_index);
    if (!srdSpell) reject(404, 'Заклинание SRD не найдено.');
    level = srdSpell.level;
    castingTime = srdSpell.castingTime ?? null;
    spellRange = srdSpell.range ?? null;
    concentration = srdSpell.concentration === true;
    spellDuration = srdSpell.duration ?? '';
    spellSchool = String(srdSpell.school ?? '');

    spellName = srdSpellName(known.srd_index);

    const overlay = (
      await q.query('SELECT * FROM srd_spell_mechanics WHERE srd_index=$1', [known.srd_index])
    ).rows[0] as any;
    mechanics = mergeSpellMechanics(deriveSpellMechanics(srdSpell), overlay ?? null);
    damageFormula = mechanics.damageFormula;
    healingFormula = mechanics.healingFormula;
    upcastFormula = mechanics.upcastFormula;
    const override = (
      await q.query('SELECT template, special_notify FROM campaign_srd_templates WHERE campaign_id=$1 AND srd_index=$2', [campaignId, known.srd_index])
    ).rows[0] as { template: unknown; special_notify: boolean } | undefined;
    if (override) {
      spellTemplate = normalizeTemplate(override.template);
      templateSpell = { id: known.srd_index as string, notify: override.special_notify !== false };
      castPlan = templateCastPlan(spellTemplate, { slotLevel: slotLevel ?? level, characterLevel: Number(character.level ?? 1), mode: body.mode ?? null });
      mechanics = { ...castPlan.mechanics };
      damageFormula = mechanics.damageFormula;
      healingFormula = mechanics.healingFormula;
      upcastFormula = null;
    }
  } else {
    const custom = (
      await q.query(
        `SELECT * FROM campaign_spells WHERE campaign_id=$1 AND id=$2`,
        [campaignId, known.custom_spell_id],
      )
    ).rows[0];
    if (!custom) reject(404, 'Заклинание кампании не найдено.');
    spellName = custom.name;
    level = custom.level;
    castingTime = custom.casting_time ?? null;
    spellRange = custom.range ?? null;
    concentration = custom.concentration === true;
    spellDuration = String(custom.duration ?? '');
    spellSchool = String(custom.school ?? '');
    mechanics = mergeSpellMechanics(null, custom as any);
    damageFormula = mechanics.damageFormula;
    healingFormula = mechanics.healingFormula;
    upcastFormula = mechanics.upcastFormula;
    if (custom.template) {
      if (custom.status !== 'approved') reject(400, `«${custom.name}» ещё не одобрено мастером.`);
      spellTemplate = normalizeTemplate(custom.template);
      templateSpell = { id: custom.id as string, notify: custom.special_notify !== false };
      castPlan = templateCastPlan(spellTemplate, { slotLevel: slotLevel ?? level, characterLevel: Number(character.level ?? 1), mode: body.mode ?? null });
      mechanics = { ...castPlan.mechanics };
      damageFormula = mechanics.damageFormula;
      healingFormula = mechanics.healingFormula;
      upcastFormula = null;
    }
  }

  const spellText = known.source === 'srd'
    ? { desc: findSrdSpell(known.srd_index)?.desc ?? '', higherLevel: findSrdSpell(known.srd_index)?.higherLevel ?? null }
    : { desc: (await q.query('SELECT description FROM campaign_spells WHERE campaign_id=$1 AND id=$2', [campaignId, known.custom_spell_id])).rows[0]?.description ?? '', higherLevel: null };
  if (castPlan) await assertTemplateTargets(q, campaignId, characterId, sceneId ?? null, targetIds ?? [], spellName, castPlan.rules);
  else await assertSpellTargets(q, campaignId, characterId, sceneId ?? null, targetIds ?? [], spellName, spellText.desc);
  const textEffects = (await campaignFlag(q, campaignId, 'spell_effects')) !== false;
  const riders: SpellRider[] = castPlan ? [...castPlan.riders] : textEffects ? spellRiders(spellText.desc) : [];
  const projectiles = castPlan ? castPlan.projectiles : textEffects ? projectileRule(spellText) : null;
  const pool = castPlan ? castPlan.pool : textEffects ? hitPointPool(spellText) : null;
  if (pool) mechanics = { ...mechanics, condition: null };
  if (known.source === 'srd' && !castPlan && known.srd_index === 'eldritch-blast') {
    const invocations = knownInvocations(character.sheet_extra);
    if (invocations.includes('agonizing-blast') && damageFormula) damageFormula = `${damageFormula}+@cha`;
    if (invocations.includes('repelling-blast')) riders.push({ kind: 'push', feet: 10 });
  }
  if (riders.some(rider => rider.kind === 'sanctuary')) mechanics = { ...mechanics, save: null };
  if (riders.some(rider => rider.kind === 'light') && /target an object held or worn by a hostile creature/i.test(spellText.desc)) mechanics = { ...mechanics, save: null };
  if (body.shots?.length && !projectiles) reject(400, `У «${spellName}» нет снарядов — назначать нечего.`);

  const metamagic = body.metamagic ?? null;
  const empowered = body.empowered === true;
  if (metamagic === 'empowered') reject(400, '«Усиленное заклинание» — отдельной галочкой (empowered), вдобавок к другой метамагии.');
  for (const id of [...(metamagic ? [metamagic] : []), ...(empowered ? ['empowered' as const] : [])]) {
    const name = METAMAGIC.find(entry => entry.id === id)!.nameRu;
    if (!classFeaturesFor(characterClassLevels(character).classes).some(feature => feature.id === 'metamagic')) reject(400, `«Метамагия» — умение чародея с 3-го уровня; у «${character.name}» её нет.`);
    if (!knownMetamagic(character.sheet_extra).includes(id)) reject(400, `«${name}» у «${character.name}» не отмечено — отметьте в «Умениях».`);
  }
  if (metamagic === 'quickened' && castingUse(castingTime) !== 'action') reject(400, '«Ускоренное заклинание» — для заклинаний, что творятся действием.');
  if ((metamagic === 'careful' || metamagic === 'heightened') && !mechanics.save) reject(400, `«${METAMAGIC.find(entry => entry.id === metamagic)!.nameRu}» — для заклинаний со спасброском.`);
  if (empowered && !damageFormula) reject(400, '«Усиленное заклинание» — для заклинаний с уроном.');
  if (metamagic === 'distant' && /^(self|на себя)/i.test((spellRange ?? '').trim())) reject(400, '«Отдалённое заклинание» — не для заклинаний на себя.');
  if (metamagic === 'extended' && (durationRounds(spellDuration) ?? 0) < 10) reject(400, '«Продлённое заклинание» — для заклинаний на минуту и дольше.');
  const castSpent = await actionEconomy.spend(q, campaignId, characterId, metamagic === 'quickened' ? 'bonus' : castingUse(castingTime), { kind: 'spell', spellLevel: level }, {
    enforce: await actionEconomy.enforceFor(q, campaignId, await canManage(q, member, userId)), sceneId: sceneId ?? null,
  });
  if (castSpent) castEconomyScene = castSpent.sceneId;

  if (known.slotless && (slotLevel !== undefined || pact)) reject(400, `«${spellName}» сотворяется без ячейки.`);
  const ritual = body.ritual === true;
  if (ritual) {
    const ritualSpell = known.source === 'srd'
      ? findSrdSpell(known.srd_index)?.ritual === true
      : (await q.query('SELECT ritual FROM campaign_spells WHERE campaign_id=$1 AND id=$2', [campaignId, known.custom_spell_id])).rows[0]?.ritual === true;
    if (!ritualSpell) reject(400, `«${spellName}» — не ритуал.`);
    if (!canRitualCast(character)) reject(400, `${character.name} не умеет колдовать ритуалы (волшебник, жрец, друид, бард или черта «Ритуальный заклинатель»).`);
    if (slotLevel !== undefined || pact || body.racial) reject(400, 'Ритуал — без ячейки.');
    if (await inCombat(q, campaignId, characterId)) reject(400, 'Ритуал — 10 минут: в бою нельзя.');
  }
  const legacy = body.racial ? infernalLegacySpell(character, known.source === 'srd' ? known.srd_index : null) : null;
  if (body.racial && !legacy) reject(400, `«${spellName}» не из «Дьявольского наследия» тифлинга (или ещё не по уровню).`);
  if (legacy && (slotLevel !== undefined || pact)) reject(400, `«${spellName}» по наследию — без ячейки.`);
  if (legacy?.resource) {
    await spendCharge(q, campaignId, characterId, legacy.resource, 'long', `«${spellName}» по наследию уже сотворено — снова после долгого отдыха.`);
  }
  const freeCast = body.free ? freeCastRule(character, characterSpellId, spellName, level, body.free) : null;
  if (freeCast && (slotLevel !== undefined || pact || body.racial || ritual || known.slotless)) reject(400, `«${spellName}» (${freeCast.label}) — без ячейки и своим уровнем.`);
  const freeLeft = freeCast?.resource
    ? await spendCharge(q, campaignId, characterId, freeCast.resource, freeCast.recharge, `«${spellName}» (${freeCast.label}) уже сотворено — снова после ${freeCast.recharge === 'long' ? 'долгого' : 'короткого'} отдыха.`)
    : null;
  if (slotLevel !== undefined) {
    if (level === 0) reject(400, 'Заговоры не тратят ячейки — повысить нечего.');
    if (slotLevel < level) reject(400, 'Ячейка не может быть ниже уровня заклинания.');
  }
  let pactSlot: { level: number; current: number; max: number; pact: true } | null = null;
  if (pact) {
    if (level === 0) reject(400, 'Заговоры не тратят ячейки.');
    const own = (
      await q.query('SELECT pact_slots_current, pact_slots_max, pact_slot_level FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, characterId])
    ).rows[0];
    if (!own?.pact_slots_max) reject(400, 'Отдельных ячеек договора нет: они ведутся только у колдуна-мультикласса при правиле «Ячейки договора — отдельно».');
    if (level > own.pact_slot_level) reject(400, `Ячейки договора — ${own.pact_slot_level} уровня, заклинание выше.`);
    if (slotLevel !== undefined && slotLevel !== own.pact_slot_level) reject(400, `Ячейка договора тратится только на своём уровне — ${own.pact_slot_level}.`);
    if (own.pact_slots_current <= 0) reject(400, 'Ячейки договора потрачены — вернутся после короткого отдыха.');
    await q.query('UPDATE characters SET pact_slots_current=pact_slots_current-1 WHERE campaign_id=$1 AND id=$2', [campaignId, characterId]);
    pactSlot = { level: own.pact_slot_level, current: own.pact_slots_current - 1, max: own.pact_slots_max, pact: true };
  }
  const effectiveLevel = legacy && legacy.castAt > level ? legacy.castAt : pactSlot?.level ?? slotLevel ?? level;
  const extraLevels = effectiveLevel - level;
  if (castPlan && spellTemplate) {
    castPlan = templateCastPlan(spellTemplate, { slotLevel: effectiveLevel, characterLevel: Number(character.level ?? 1), mode: body.mode ?? null });
    mechanics = { ...castPlan.mechanics, ...(pool ? { condition: null } : {}) };
    damageFormula = mechanics.damageFormula;
    healingFormula = mechanics.healingFormula;
    riders.splice(0, riders.length, ...castPlan.riders);
    if (riders.some(rider => rider.kind === 'sanctuary')) mechanics = { ...mechanics, save: null };
    if (spellTemplate.options.params.some(param => param.kind === 'damage-type')) {
      if (!body.element) reject(400, `«${spellName}»: выберите вид урона.`);
      if (!mechanics.damageType && mechanics.damageFormula) mechanics = { ...mechanics, damageType: body.element as SpellDamageType };
      for (const mod of castPlan.mods) if (mod.kind === 'defense') mod.values = { ...mod.values, paramValue: body.element };
    }
  }
  const limit = castPlan ? castPlan.targetLimit : textEffects ? targetLimit(spellText, effectiveLevel) : null;
  if (limit !== null && (targetIds ?? []).length > limit) reject(400, `«${spellName}»: целей не больше ${limit}.`);
  const chosenTargets = [...new Set(targetIds ?? [])];
  const oneCreature = (await campaignFlag(q, campaignId, 'spell_targets')) !== false && (castPlan ? castPlan.single : singleTarget({ ...spellText, range: spellRange }, level, effectiveLevel));
  if (metamagic === 'twinned') {
    if (!oneCreature) reject(400, `«${spellName}» не удвоить: оно не на одно существо (на себя, на область или на нескольких).`);
    if (chosenTargets.length !== 2 || templateId) reject(400, '«Удвоенное заклинание» — ровно две цели.');
  } else if (oneCreature && chosenTargets.length > 1) {
    reject(400, `«${spellName}» — на одно существо; вторую цель даёт «Удвоенное заклинание» чародея.`);
  }
  let metamagicSpent: { id: string; name: string; cost: number; left: number; empowered?: boolean } | null = null;
  if (metamagic || empowered) {
    const ids = [...(metamagic ? [metamagic] : []), ...(empowered ? ['empowered' as const] : [])];
    const cost = ids.reduce((sum, id) => sum + metamagicCost(id, effectiveLevel), 0);
    const left = await spendClassResource(q, campaignId, character, 'Очки чародейства', cost);
    metamagicSpent = {
      id: metamagic ?? 'empowered', name: ids.map(id => METAMAGIC.find(entry => entry.id === id)!.nameRu).join(' + '), cost, left: Number(left.current),
      ...(empowered && metamagic ? { empowered: true } : {}),
    };
  }
  const lasting = (rounds: number) => (metamagic === 'extended' ? Math.min(14_400, rounds * 2) : rounds);

  let slot: { level: number; current: number; max: number; pact?: true } | null = pactSlot;
  if (effectiveLevel > 0 && !pactSlot && !known.slotless && !legacy && !ritual && !freeCast) {
    const slotRow = (
      await q.query(
        `SELECT current, max FROM character_spell_slots
             WHERE campaign_id=$1 AND character_id=$2 AND level=$3 FOR UPDATE`,
        [campaignId, characterId, effectiveLevel],
      )
    ).rows[0];

    if (!slotRow || slotRow.current <= 0) {
      reject(400, `Нет свободных ячеек ${effectiveLevel} уровня — выберите другой уровень или восстановите ячейки отдыхом.`);
    }

    const updated = await q.query(
      `UPDATE character_spell_slots SET current = current - 1
           WHERE campaign_id=$1 AND character_id=$2 AND level=$3
           RETURNING level, current, max`,
      [campaignId, characterId, effectiveLevel],
    );
    slot = updated.rows[0] as { level: number; current: number; max: number };
  }

  if (await breakInvisibility(q, campaignId, characterId)) becameVisible = character.name;

  return {
    casterRevealed, becameVisible, castEconomyScene, character, casterStealth, known, spellName, level,
    spellRange, damageFormula, healingFormula, upcastFormula, concentration, spellDuration, spellSchool,
    mechanics, spellTemplate, castPlan, templateSpell, spellText, riders, projectiles, pool, metamagic,
    empowered, ritual, legacy, freeCast, freeLeft, effectiveLevel, extraLevels, metamagicSpent, lasting,
    slot,
  };
}

export type CastSetup = Awaited<ReturnType<typeof prepareCast>>;
