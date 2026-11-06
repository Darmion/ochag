import { addCondition } from '../../conditions.ts';
import { reject } from '../../../tabletop/scene-feature.ts';
import type { HpResult } from '../../class-features.ts';
import { spendResource, entryOf } from '../helpers.ts';
import { classLevelOf, classFeaturesFor, martialArtsDie, kiSaveDc, EMPTY_BODY_KI, EMPTY_BODY_ROUNDS, QUIVERING_PALM_DAMAGE, wholenessOfBodyHp, QUIVERING_PALM_KI, unarmoredMovementFeet } from '../../../../../../packages/domain/character/class-features.ts';
import { abilityModifier, proficiencyBonusForLevel, rollDice } from '../../../../../../packages/domain/dice/dice.ts';
import type { FeatureAction, FeatureResult, FeatureUse } from './types.ts';
import type { FeatureLook, FeatureView, FeatureViewFn, FeatureChoice } from './types.ts';

async function flurryOfBlows(use: FeatureUse): Promise<FeatureResult> {
  const { q, campaignId, characterId, sceneId, feature, targetId, enforce, row, request, after, classes } = use;
  const { actionEconomy } = use.ctx;
  const entry = await entryOf(q, campaignId, characterId, sceneId);
  if (feature === 'flurry-of-blows') {
    if (!targetId) reject(400, 'Кого бить — выберите цель.');
    if (entry?.is_current && !(entry.action_used && entry.attacks_made > 0)) reject(400, '«Шквал ударов» — сразу после действия «Атака».');
  }
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'bonus', { kind: 'other' }, { enforce, sceneId: sceneId ?? entry?.scene_id ?? null });
  await spendResource(q, campaignId, row, 'Ци');
  const where = spent?.sceneId ?? sceneId ?? entry?.scene_id ?? null;
  if (feature === 'flurry-of-blows') {
    const technique = request.body?.technique;
    after.flurry = {
      targetId: targetId!, die: martialArtsDie(classLevelOf(classes, 'monk', row.level)), sceneId: where,
      openHand: technique && classFeaturesFor(classes).some(item => item.id === 'open-hand-technique')
        ? { id: characterId, name: row.name, current: Boolean(entry?.is_current), dc: kiSaveDc(proficiencyBonusForLevel(Math.max(1, row.level ?? 1)), abilityModifier(row.wisdom)) }
        : null,
    };
    return { message: `${row.name}: «Шквал ударов» — два безоружных удара.`, float: 'шквал ударов', economyScene: where, heal: null };
  }
  if (feature === 'patient-defense') {
    await addCondition(q, campaignId, characterId, 'dodging', { source: 'feature' });
    return { message: `${row.name}: «Терпеливая защита» — уклоняется до начала своего хода.`, float: 'уклонение', economyScene: where, heal: null };
  }
  const mode = request.body?.mode ?? 'dash';
  if (entry) await q.query(mode === 'dash' ? 'UPDATE initiative_entries SET dashes=dashes+1 WHERE id=$1' : 'UPDATE initiative_entries SET disengaged=true WHERE id=$1', [entry.id]);
  return {
    message: `${row.name}: «Шаг ветра» — ${mode === 'dash' ? 'Рывок' : 'Отход'} бонусным действием.`,
    float: mode === 'dash' ? 'рывок' : 'отход', economyScene: where, heal: null,
  };
}

async function emptyBody(use: FeatureUse): Promise<FeatureResult> {
  const { state, row, q, campaignId, characterId, enforce, sceneId } = use;
  const { actionEconomy } = use.ctx;
  if (state.codes.has('empty_body')) reject(400, `${row.name}: «Пустое тело» уже действует.`);
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId });
  await spendResource(q, campaignId, row, 'Ци', EMPTY_BODY_KI);
  const lasting = { source: 'feature', sourceName: 'Пустое тело', remainingRounds: EMPTY_BODY_ROUNDS, durationRounds: EMPTY_BODY_ROUNDS };
  await addCondition(q, campaignId, characterId, 'invisible', lasting);
  await addCondition(q, campaignId, characterId, 'empty_body', lasting);
  return {
    message: `${row.name}: «Пустое тело» — ${EMPTY_BODY_KI} ци, на минуту невидимость и сопротивление всему урону, кроме силового поля.`,
    float: 'пустое тело', economyScene: spent?.sceneId ?? null, heal: null,
  };
}

async function quiveringPalm(use: FeatureUse): Promise<FeatureResult> {
  const { q, campaignId, characterId, targetId, row, enforce, sceneId, userId, changed, after } = use;
  const { actionEconomy, applyHpChange, rollDie, insertRoll } = use.ctx;
  const ctx = use.ctx;
  const marked = (
    await q.query(
      `SELECT e.id, e.character_id, c.name FROM character_effects e JOIN characters c ON c.campaign_id=e.campaign_id AND c.id=e.character_id
               WHERE e.campaign_id=$1 AND e.active AND e.effect_code='quivering_palm' AND e.parameters->>'sourceCharacterId' = $2
                 AND ($3::uuid IS NULL OR e.character_id = $3::uuid)`,
      [campaignId, characterId, targetId],
    )
  ).rows[0] as { id: string; character_id: string; name: string } | undefined;
  if (!marked) reject(400, targetId ? 'В этой цели нет вашей дрожи.' : `${row.name}: «Дрожащей ладони» ни в ком нет — сначала попадите безоружным ударом.`);
  if (!ctx.rollSaveAgainst) reject(400, 'Спасбросок недоступен.');
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId });
  await q.query('DELETE FROM character_effects WHERE id=$1', [marked.id]);
  const dc = kiSaveDc(proficiencyBonusForLevel(Math.max(1, row.level ?? 1)), abilityModifier(row.wisdom));
  const save = await ctx.rollSaveAgainst(q, campaignId, userId, marked.character_id, 'constitution', dc, `Спасбросок ТЕЛ (СЛ ${dc}) против «Дрожащей ладони» — ${marked.name}`.slice(0, 100), false, null);
  const victim = (await q.query('SELECT hp_current, hp_temp FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, marked.character_id])).rows[0] as any;
  let change: HpResult;
  if (!save.success) {
    change = await applyHpChange(q, campaignId, userId, marked.character_id, {
      mode: 'damage', amount: Number(victim?.hp_current ?? 0) + Number(victim?.hp_temp ?? 0), damageType: null, critical: false,
      ignoreResistance: true, ignoreImmunity: true, sourceId: characterId,
    });
  } else {
    const rolled = rollDice({ count: 10, sides: 10, modifier: 0 }, rollDie);
    await insertRoll(q, campaignId, userId, characterId, `Урон: «Дрожащая ладонь» — ${marked.name}`.slice(0, 100), QUIVERING_PALM_DAMAGE, rolled.results, 0, rolled.total, false);
    change = await applyHpChange(q, campaignId, userId, marked.character_id, { mode: 'damage', amount: rolled.total, damageType: 'necrotic', critical: false, sourceId: characterId });
  }
  changed.push({ characterId: marked.character_id, change });
  after.floatOn = marked.character_id;
  return {
    message: `${row.name} обрывает «Дрожащую ладонь» в «${marked.name}»: ${save.success ? `устоял (${save.total}) — ${change.applied} некротического урона` : `провал (${save.total}) — 0 хитов`}.`,
    float: save.success ? `−${change.applied}` : 'дрожь: 0 хитов', economyScene: spent?.sceneId ?? null, heal: null,
  };
}

async function stillnessOfMind(use: FeatureUse): Promise<FeatureResult> {
  const { q, campaignId, characterId, row, enforce, sceneId } = use;
  const { actionEconomy } = use.ctx;
  const ended = (
    await q.query(
      `DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('charmed', 'frightened') RETURNING effect_code`,
      [campaignId, characterId],
    )
  ).rows.map(entry => (entry.effect_code === 'charmed' ? 'очарование' : 'испуг'));
  if (!ended.length) reject(400, `${row.name} не очарован и не испуган.`);
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId });
  const gone = [...new Set(ended)];
  return {
    message: `${row.name}: «Спокойствие разума» — ${gone.join(' и ')} больше не ${gone.length > 1 ? 'действуют' : 'действует'}.`,
    float: 'спокойствие', economyScene: spent?.sceneId ?? null, heal: null,
  };
}

async function wholenessOfBody(use: FeatureUse): Promise<FeatureResult> {
  const { row, q, campaignId, characterId, enforce, sceneId, classes, userId } = use;
  const { actionEconomy, applyHpChange } = use.ctx;
  if (row.hp_current >= row.hp_max) reject(400, `${row.name}: хиты и так полны.`);
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId });
  await spendResource(q, campaignId, row, 'Цельность тела');
  const amount = wholenessOfBodyHp(classLevelOf(classes, 'monk', row.level));
  const heal = await applyHpChange(q, campaignId, userId, characterId, { mode: 'heal', amount, damageType: null, critical: false });
  return { message: `${row.name}: «Цельность тела» — +${heal.applied} хит.`, float: null, economyScene: spent?.sceneId ?? null, heal };
}

export const monkActions: Record<string, FeatureAction> = {
  'flurry-of-blows': flurryOfBlows,
  'patient-defense': flurryOfBlows,
  'step-of-the-wind': flurryOfBlows,
  'empty-body': emptyBody,
  'quivering-palm': quiveringPalm,
  'stillness-of-mind': stillnessOfMind,
  'wholeness-of-body': wholenessOfBody,
};

function openHandTechniqueView(look: FeatureLook): FeatureView {
  const { row } = look;
  return {
    detail: `в «Шквале ударов»: сбить с ног, оттолкнуть или без реакций; СЛ ${kiSaveDc(proficiencyBonusForLevel(Math.max(1, row.level ?? 1)), abilityModifier(row.wisdom))}`,
  };
}

function flurryOfBlowsView(look: FeatureLook): FeatureView {
  const { classes, row, unable, empty, bonusReason, entry } = look;
  return {
    detail: `2 удара по 1d${martialArtsDie(classLevelOf(classes, 'monk', row.level))}, 1 ци; цель — выбранная`,
    reason: unable ?? empty ?? bonusReason ?? (entry && entry.is_current && !(entry.action_used && entry.attacks_made > 0) ? 'сначала действие «Атака»' : null),
  };
}

function patientDefenseView(look: FeatureLook): FeatureView {
  const { feature, unable, empty, bonusReason } = look;
  return {
    detail: feature.id === 'patient-defense' ? '«Уклонение», 1 ци' : '«Отход» или «Рывок», 1 ци',
    reason: unable ?? empty ?? bonusReason,
  };
}

function stunningStrikeView(look: FeatureLook): FeatureView {
  const { row, empty } = look;
  return {
    detail: `СЛ ${kiSaveDc(proficiencyBonusForLevel(Math.max(1, row.level ?? 1)), abilityModifier(row.wisdom))}, 1 ци — кнопка после попадания рукопашной`,
    reason: empty,
  };
}

function tranquilityView(look: FeatureLook): FeatureView {
  const { row } = look;
  return {
    detail: `после долгого отдыха — «Убежище» (СЛ ${8 + proficiencyBonusForLevel(Math.max(1, row.level ?? 1)) + abilityModifier(row.wisdom)})`,
  };
}

function emptyBodyView(look: FeatureLook): FeatureView {
  const { state, unable, resource, actionReason } = look;
  let active: boolean = false;
  let detail: string = '';
  let reason: string | null = null;
  active = state.codes.has('empty_body');
  detail = active ? 'невидимость и сопротивление всему, кроме силового поля' : `${EMPTY_BODY_KI} ци: на минуту невидимость и сопротивление урону`;
  reason = active ? 'уже действует' : unable ?? (resource && resource.current < EMPTY_BODY_KI ? `нужно ${EMPTY_BODY_KI} ци` : null) ?? actionReason;
  return { active, detail, reason };
}

async function quiveringPalmView(look: FeatureLook): Promise<FeatureView> {
  const { q, campaignId, characterId, row, unable, actionReason, resource } = look;
  let choices: FeatureChoice[] | null = null;
  let active: boolean = false;
  let detail: string = '';
  let reason: string | null = null;
  const marked = (
    await q.query(
      `SELECT e.character_id, c.name FROM character_effects e JOIN characters c ON c.campaign_id=e.campaign_id AND c.id=e.character_id
                 WHERE e.campaign_id=$1 AND e.active AND e.effect_code='quivering_palm' AND e.parameters->>'sourceCharacterId' = $2`,
      [campaignId, characterId],
    )
  ).rows as Array<{ character_id: string; name: string }>;
  const dc = kiSaveDc(proficiencyBonusForLevel(Math.max(1, row.level ?? 1)), abilityModifier(row.wisdom));
  choices = marked.map(entry => ({ value: entry.character_id, label: entry.name }));
  active = marked.length > 0;
  detail = active ? `дрожь в «${marked[0]!.name}» — действием оборвать: спасбросок ТЕЛ СЛ ${dc}` : `${QUIVERING_PALM_KI} ци — кнопка после попадания безоружным ударом`;
  reason = active ? unable ?? actionReason : (resource && resource.current < QUIVERING_PALM_KI ? `нужно ${QUIVERING_PALM_KI} ци` : null);
  return { choices, active, detail, reason };
}

function wholenessOfBodyView(look: FeatureLook): FeatureView {
  const { classes, row, unable, empty, actionReason } = look;
  return {
    detail: `+${wholenessOfBodyHp(classLevelOf(classes, 'monk', row.level))} хитов действием`,
    reason: unable ?? empty ?? (row.hp_current >= row.hp_max ? 'хиты полны' : null) ?? actionReason,
  };
}

function stillnessOfMindView(look: FeatureLook): FeatureView {
  const { effects, unable, actionReason } = look;
  const fear = effects.filter(effect => effect.effect_code === 'charmed' || effect.effect_code === 'frightened');
  return {
    detail: fear.length ? `снять: ${fear.map(effect => (effect.effect_code === 'charmed' ? 'очарован' : 'испуган')).join(', ')}` : 'снимает очарование и испуг',
    reason: unable ?? (fear.length ? null : 'не очарован и не испуган') ?? actionReason,
  };
}

function purityOfBodyView(): FeatureView {
  return { detail: 'иммунитет к яду: урон ядом и «отравлен» — нет' };
}

function unarmoredMovementView(look: FeatureLook): FeatureView {
  const { classes, row } = look;
  return { detail: `+${unarmoredMovementFeet(classLevelOf(classes, 'monk', row.level))} фт. без доспеха и щита` };
}

function deflectMissilesView(look: FeatureLook): FeatureView {
  const { row, classes } = look;
  let active: boolean = false;
  let detail: string = '';
  active = (row.auto_reactions ?? []).includes('deflect-missiles');
  detail = `${active ? 'наготове' : 'не наготове'}: 1d10 + ${abilityModifier(Number(row.dexterity ?? 10))} + ${classLevelOf(classes, 'monk', row.level)}`;
  return { active, detail };
}

export const monkViews: Record<string, FeatureViewFn> = {
  'open-hand-technique': openHandTechniqueView,
  'flurry-of-blows': flurryOfBlowsView,
  'patient-defense': patientDefenseView,
  'step-of-the-wind': patientDefenseView,
  'stunning-strike': stunningStrikeView,
  'tranquility': tranquilityView,
  'empty-body': emptyBodyView,
  'quivering-palm': quiveringPalmView,
  'wholeness-of-body': wholenessOfBodyView,
  'stillness-of-mind': stillnessOfMindView,
  'purity-of-body': purityOfBodyView,
  'unarmored-movement': unarmoredMovementView,
  'deflect-missiles': deflectMissilesView,
};
