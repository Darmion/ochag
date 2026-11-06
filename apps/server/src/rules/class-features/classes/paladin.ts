import { removeCondition, addCondition, loadEffects } from '../../conditions.ts';
import { reject } from '../../../tabletop/scene-feature.ts';
import { spendResource, entryOf, paladinDc, resourceOf, cleansable } from '../helpers.ts';
import { HOLY_NIMBUS_ROUNDS, HOLY_NIMBUS_FEET, HOLY_NIMBUS_DAMAGE, auraOfProtection, auraOfDevotion, auraOfCourage } from '../../../../../../packages/domain/character/class-features.ts';
import { conditionState } from '../../../../../../packages/domain/combat/conditions.ts';
import { abilityModifier } from '../../../../../../packages/domain/dice/dice.ts';
import type { FeatureAction, FeatureResult, FeatureUse } from './types.ts';
import type { FeatureLook, FeatureView, FeatureViewFn } from './types.ts';

async function turnTheUnholy(use: FeatureUse): Promise<FeatureResult> {
  const { q, campaignId, characterId, sceneId, enforce, row, userId, changed } = use;
  const { actionEconomy } = use.ctx;
  const ctx = use.ctx;
  const entry = await entryOf(q, campaignId, characterId, sceneId);
  const where = sceneId ?? entry?.scene_id ?? null;
  if (!where || !ctx.creaturesNear || !ctx.creatureType || !ctx.rollSaveAgainst) reject(400, 'Изгнание нечестивых — на сцене: выберите сцену.');
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId: where });
  await spendResource(q, campaignId, row, 'Божественный канал');
  const dc = paladinDc(row);
  const parts: string[] = [];
  for (const near of await ctx.creaturesNear(q, campaignId, where, characterId, 30)) {
    const type = await ctx.creatureType(q, campaignId, near.id);
    if (type !== 'undead' && type !== 'fiend') continue;
    if (conditionState((await loadEffects(q, campaignId, near.id)).map(effect => effect.effect_code)).codes.has('dead')) continue;
    const save = await ctx.rollSaveAgainst(q, campaignId, userId, near.id, 'wisdom', dc, `Спасбросок МДР (СЛ ${dc}) против «Изгнания нечестивых» — ${near.name}`, false, { condition: 'turned', magic: true });
    if (save.success) {
      parts.push(`${near.name} устоял (${save.total})`);
      continue;
    }
    await addCondition(q, campaignId, near.id, 'turned', {
      source: 'feature', sourceCharacterId: characterId, sourceName: row.name, remainingRounds: 10, durationRounds: 10, endsOnDamage: true,
    });
    changed.push({ characterId: near.id, change: null as any });
    parts.push(`${near.name} изгнан (${save.total})`);
  }
  return {
    message: `${row.name}: «Изгнание нечестивых» (СЛ ${dc}) — ${parts.length ? parts.join(', ') : 'исчадий и нежити в 30 футах нет'}.`,
    float: 'изгнание нечестивых', economyScene: spent?.sceneId ?? where, heal: null,
  };
}

async function sacredWeapon(use: FeatureUse): Promise<FeatureResult> {
  const { state, row, q, campaignId, characterId, enforce, sceneId } = use;
  const { actionEconomy } = use.ctx;
  if (state.codes.has('sacred_weapon')) reject(400, `${row.name}: «Священное оружие» уже действует.`);
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId });
  await spendResource(q, campaignId, row, 'Божественный канал');
  const bonus = Math.max(1, abilityModifier(row.charisma));
  await addCondition(q, campaignId, characterId, 'sacred_weapon', { source: 'feature', bonus, remainingRounds: 10, durationRounds: 10 });
  return {
    message: `${row.name}: «Священное оружие» — +${bonus} к броскам атаки оружием на минуту.`,
    float: 'священное оружие', economyScene: spent?.sceneId ?? null, heal: null,
  };
}

async function layOnHands(use: FeatureUse): Promise<FeatureResult> {
  const { targetId, q, campaignId, row, characterId, sceneId, request, enforce, userId, healed, after } = use;
  const { actionEconomy, applyHpChange } = use.ctx;
  const ctx = use.ctx;
  const target = targetId
    ? (await q.query('SELECT id, name, kind, hp_current, hp_max FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0] as any
    : row;
  if (!target || target.kind === 'object') reject(404, 'Существо не найдено.');
  const type = ctx.creatureType ? await ctx.creatureType(q, campaignId, target.id) : null;
  if (type === 'undead' || type === 'construct') reject(400, `«Наложение рук» не действует на ${type === 'undead' ? 'нежить' : 'конструктов'}: «${target.name}».`);
  if (target.id !== characterId && ctx.feetApart) {
    const feet = await ctx.feetApart(q, campaignId, sceneId, characterId, target.id);
    if (feet !== null && feet > 5) reject(400, `«Наложение рук» — касанием: «${target.name}» в ${Math.round(feet)} фт.`);
  }
  const pool = await resourceOf(q, campaignId, row, 'Наложение рук', false);
  const cure = request.body?.cure === true;
  const missing = Math.max(0, Number(target.hp_max) - Number(target.hp_current));
  const amount = request.body?.amount ?? Math.min(Number(pool?.current ?? 0) - (cure ? 5 : 0), missing);
  if (!cure && amount <= 0) reject(400, missing ? 'Запас «Наложения рук» пуст.' : `У «${target.name}» хиты полны.`);
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId });
  await spendResource(q, campaignId, row, 'Наложение рук', Math.max(0, amount) + (cure ? 5 : 0));
  const parts: string[] = [];
  if (amount > 0) {
    const change = await applyHpChange(q, campaignId, userId, target.id, { mode: 'heal', amount, damageType: null, critical: false });
    healed.push({ characterId: target.id, change });
    parts.push(`+${change.applied} хит.`);
  }
  if (cure) parts.push((await removeCondition(q, campaignId, target.id, 'poisoned')) ? 'яд снят' : 'яда не было');
  after.floatOn = target.id;
  return { message: `${row.name}: «Наложение рук» — «${target.name}»: ${parts.join(', ')}.`, float: 'наложение рук', economyScene: spent?.sceneId ?? null, heal: null };
}

async function cleansingTouch(use: FeatureUse): Promise<FeatureResult> {
  const { targetId, q, campaignId, row, characterId, sceneId, request, enforce, after } = use;
  const { actionEconomy } = use.ctx;
  const ctx = use.ctx;
  const target = targetId
    ? (await q.query('SELECT id, name, kind FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0] as any
    : row;
  if (!target || target.kind === 'object') reject(404, 'Существо не найдено.');
  if (target.id !== characterId && ctx.feetApart) {
    const feet = await ctx.feetApart(q, campaignId, sceneId, characterId, target.id);
    if (feet !== null && feet > 5) reject(400, `«Очищающее касание» — касанием: «${target.name}» в ${Math.round(feet)} фт.`);
  }
  const spells = await cleansable(q, campaignId, target.id);
  if (!spells.length) reject(400, `На «${target.name}» нет заклинаний, которые можно закончить.`);
  const wanted = request.body?.spell ?? null;
  const pick = wanted ? spells.find(entry => entry.key === wanted) : spells[0]!;
  if (!pick) reject(400, `На «${target.name}» такого заклинания уже нет — обновите список.`);
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId });
  await spendResource(q, campaignId, row, 'Очищающее касание');
  for (const effect of pick.effects) {
    await q.query('DELETE FROM character_effects WHERE id=$1', [effect.id]);
    if (effect.parameters?.concentrationOf) await removeCondition(q, campaignId, effect.parameters.concentrationOf, 'concentration');
  }
  const spellName = pick.name;
  after.floatOn = target.id;
  return {
    message: `${row.name}: «Очищающее касание» — «${spellName}» на «${target.name}» больше не действует.`,
    float: 'очищено', economyScene: spent?.sceneId ?? null, heal: null,
  };
}

async function holyNimbus(use: FeatureUse): Promise<FeatureResult> {
  const { state, row, q, campaignId, characterId, enforce, sceneId } = use;
  const { actionEconomy } = use.ctx;
  if (state.codes.has('holy_nimbus')) reject(400, `${row.name} уже сияет.`);
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId });
  await spendResource(q, campaignId, row, 'Святой нимб');
  await addCondition(q, campaignId, characterId, 'holy_nimbus', {
    source: 'feature', sourceName: 'Святой нимб', remainingRounds: HOLY_NIMBUS_ROUNDS, durationRounds: HOLY_NIMBUS_ROUNDS,
  });
  return {
    message: `${row.name}: «Святой нимб» — на минуту яркий свет; враги в ${HOLY_NIMBUS_FEET} фт. в начале своего хода получают ${HOLY_NIMBUS_DAMAGE} излучением.`,
    float: 'святой нимб', economyScene: spent?.sceneId ?? null, heal: null,
  };
}

export const paladinActions: Record<string, FeatureAction> = {
  'turn-the-unholy': turnTheUnholy,
  'sacred-weapon': sacredWeapon,
  'lay-on-hands': layOnHands,
  'cleansing-touch': cleansingTouch,
  'holy-nimbus': holyNimbus,
};

async function divineSmiteView(look: FeatureLook): Promise<FeatureView> {
  const { q, campaignId, characterId } = look;
  const slots = (await q.query('SELECT level, current FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 AND max > 0 ORDER BY level', [campaignId, characterId])).rows as any[];
  return {
    detail: slots.length ? slots.map(slot => `${slot.level} ур. — ${slot.current}`).join(', ') : 'ячеек нет',
    reason: slots.some(slot => slot.current > 0) ? null : 'нет ячеек',
  };
}

function turnTheUnholyView(look: FeatureLook): FeatureView {
  const { row, unable, empty, actionReason } = look;
  return { detail: `СЛ ${paladinDc(row)}; исчадия и нежить в 30 фт.`, reason: unable ?? empty ?? actionReason };
}

function sacredWeaponView(look: FeatureLook): FeatureView {
  const { effects, row, unable, empty, actionReason } = look;
  let active: boolean = false;
  let detail: string = '';
  let reason: string | null = null;
  active = effects.some(effect => effect.effect_code === 'sacred_weapon');
  detail = `+${Math.max(1, abilityModifier(row.charisma))} к атакам оружием на минуту`;
  reason = active ? null : unable ?? empty ?? actionReason;
  return { active, detail, reason };
}

function layOnHandsView(look: FeatureLook): FeatureView {
  const { resource, unable, empty, actionReason } = look;
  return {
    detail: `запас ${resource?.current ?? 0} из ${resource?.max ?? 0}; кому — выбранная цель`,
    reason: unable ?? empty ?? actionReason,
  };
}

function purityOfSpiritView(): FeatureView {
  return { detail: 'всегда под «Защитой от добра и зла»' };
}

function holyNimbusView(look: FeatureLook): FeatureView {
  const { state, unable, empty, actionReason } = look;
  let active: boolean = false;
  let detail: string = '';
  let reason: string | null = null;
  active = state.codes.has('holy_nimbus');
  detail = active
    ? `сияет: враг в ${HOLY_NIMBUS_FEET} фт. в начале своего хода — ${HOLY_NIMBUS_DAMAGE} излучением`
    : `минута: ${HOLY_NIMBUS_DAMAGE} излучением врагам в ${HOLY_NIMBUS_FEET} фт.`;
  reason = active ? 'уже сияет' : unable ?? empty ?? actionReason;
  return { active, detail, reason };
}

function auraOfProtectionView(look: FeatureLook): FeatureView {
  const { classes, row, unable } = look;
  const aura = auraOfProtection(classes, abilityModifier(row.charisma));
  return { detail: aura ? `+${aura.bonus} к спасброскам — вы и союзники в ${aura.feet} фт.` : '', reason: unable };
}

function auraOfDevotionView(look: FeatureLook): FeatureView {
  const { classes, unable } = look;
  const aura = auraOfDevotion(classes);
  return { detail: aura ? `вас и союзников в ${aura.feet} фт. нельзя очаровать` : '', reason: unable };
}

function auraOfCourageView(look: FeatureLook): FeatureView {
  const { classes, unable } = look;
  const aura = auraOfCourage(classes);
  return { detail: aura ? `вас и союзников в ${aura.feet} фт. нельзя испугать` : '', reason: unable };
}

function improvedDivineSmiteView(): FeatureView {
  return { detail: '+1d8 излучением каждым попаданием рукопашным оружием' };
}

function cleansingTouchView(look: FeatureLook): FeatureView {
  const { unable, empty, actionReason } = look;
  return {
    detail: 'закончить заклинание на себе или союзнике рядом — цель выбранная',
    reason: unable ?? empty ?? actionReason,
  };
}

export const paladinViews: Record<string, FeatureViewFn> = {
  'divine-smite': divineSmiteView,
  'turn-the-unholy': turnTheUnholyView,
  'sacred-weapon': sacredWeaponView,
  'lay-on-hands': layOnHandsView,
  'purity-of-spirit': purityOfSpiritView,
  'holy-nimbus': holyNimbusView,
  'aura-of-protection': auraOfProtectionView,
  'aura-of-devotion': auraOfDevotionView,
  'aura-of-courage': auraOfCourageView,
  'improved-divine-smite': improvedDivineSmiteView,
  'cleansing-touch': cleansingTouchView,
};
