import { conditionLabel, removeCondition, addCondition, suspendForRage, loadEffects } from '../../conditions.ts';
import { reject } from '../../../tabletop/scene-feature.ts';
import type { HpResult } from '../../class-features.ts';
import { spendResource, entryOf } from '../helpers.ts';
import { rageDamageBonus, classLevelOf, classFeaturesFor, RAGE_ROUNDS, INTIMIDATING_PRESENCE_FEET, brutalCriticalDice, RELENTLESS_RAGE_MAX, relentlessRageDc } from '../../../../../../packages/domain/character/class-features.ts';
import { abilityModifier, proficiencyBonusForLevel } from '../../../../../../packages/domain/dice/dice.ts';
import type { FeatureAction, FeatureResult, FeatureUse } from './types.ts';
import type { FeatureLook, FeatureView, FeatureViewFn } from './types.ts';

async function endRage(use: FeatureUse): Promise<FeatureResult> {
  const { q, campaignId, characterId, row } = use;
  const waiting = (
    await q.query(`SELECT effect_code FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND NOT active AND parameters->>'suspendedBy' = 'rage'`, [campaignId, characterId])
  ).rows.map(entry => conditionLabel(entry.effect_code));
  if (!(await removeCondition(q, campaignId, characterId, 'raging'))) reject(400, `${row.name} не в ярости.`);
  return {
    message: `${row.name}: ярость утихает.${waiting.length ? ` Снова: ${waiting.join(', ')}.` : ''}`,
    float: 'ярость утихла', economyScene: null as string | null, heal: null as HpResult | null,
  };
}

async function rage(use: FeatureUse): Promise<FeatureResult> {
  const { state, row, q, campaignId, characterId, enforce, sceneId, classes, request } = use;
  const { actionEconomy } = use.ctx;
  if (state.codes.has('raging')) reject(400, `${row.name} уже в ярости.`);
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'bonus', { kind: 'other' }, { enforce, sceneId });
  await spendResource(q, campaignId, row, 'Ярость');
  const lostConcentration = await removeCondition(q, campaignId, characterId, 'concentration');
  const bonus = rageDamageBonus(classLevelOf(classes, 'barbarian', row.level));
  const frenzy = request.body?.frenzy === true && classFeaturesFor(classes).some(item => item.id === 'frenzy');
  await addCondition(q, campaignId, characterId, 'raging', { source: 'rage', remainingRounds: RAGE_ROUNDS, damageBonus: bonus, kept: true, ...(frenzy ? { frenzy: true } : {}) });
  const suspended = classFeaturesFor(classes).some(item => item.id === 'mindless-rage') ? await suspendForRage(q, campaignId, characterId) : [];
  return {
    message: `${row.name} впадает в ${frenzy ? 'бешенство' : 'ярость'}: +${bonus} к урону рукопашным на Силе, сопротивление дробящему, колющему и рубящему, преимущество в бросках Силы.${frenzy ? ' В следующие ходы — бонусным рукопашная атака; после ярости — истощение.' : ''}${lostConcentration ? ' Концентрация прервана.' : ''}${suspended.length ? ` «Бездумная ярость»: ${suspended.join(', ')} — приостановлено до конца ярости.` : ''}`,
    float: 'ЯРОСТЬ!', economyScene: spent?.sceneId ?? null, heal: null,
  };
}

async function frenzyAttack(use: FeatureUse): Promise<FeatureResult> {
  const { targetId, q, campaignId, characterId, row, sceneId, enforce, after, request } = use;
  const { actionEconomy } = use.ctx;
  if (!targetId) reject(400, 'Кого бить — выберите цель.');
  const rage = (await loadEffects(q, campaignId, characterId)).find(effect => effect.effect_code === 'raging');
  if (!rage?.parameters?.frenzy) reject(400, `${row.name} не в бешенстве — впадите в ярость с галочкой «в бешенство».`);
  const entry = await entryOf(q, campaignId, characterId, sceneId);
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'bonus', { kind: 'other' }, { enforce, sceneId: sceneId ?? entry?.scene_id ?? null });
  const where = spent?.sceneId ?? sceneId ?? entry?.scene_id ?? null;
  after.frenzyStrike = { targetId, weaponId: request.body?.weaponId ?? null, sceneId: where };
  return { message: `${row.name} в бешенстве — атака бонусным действием.`, float: 'бешенство', economyScene: where, heal: null };
}

async function recklessAttack(use: FeatureUse): Promise<FeatureResult> {
  const { state, row, q, campaignId, characterId, sceneId } = use;
  if (state.codes.has('reckless')) reject(400, `${row.name} уже атакует безрассудно.`);
  const entry = await entryOf(q, campaignId, characterId, sceneId);
  if (!entry || !entry.is_current) reject(400, '«Безрассудная атака» — в бою, в свой ход.');
  if (entry.attacks_made > 0) reject(400, '«Безрассудная атака» — перед первой атакой хода.');
  await addCondition(q, campaignId, characterId, 'reckless', { source: 'feature', sourceName: row.name, expires: { at: 'start', of: characterId } });
  return {
    message: `${row.name} атакует безрассудно: рукопашные атаки Силой в этот ход — с преимуществом, по нему — с преимуществом до начала его хода.`,
    float: 'безрассудно!', economyScene: entry.scene_id, heal: null,
  };
}

async function intimidatingPresence(use: FeatureUse): Promise<FeatureResult> {
  const { targetId, characterId, q, campaignId, sceneId, enforce, after, row, userId } = use;
  const { actionEconomy } = use.ctx;
  const ctx = use.ctx;
  if (!targetId || targetId === characterId) reject(400, 'Кого пугать — выберите цель.');
  const target = (await q.query('SELECT id, name, kind FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0] as any;
  if (!target || target.kind === 'object') reject(400, 'Пугать можно существо.');
  const where = sceneId ?? (await entryOf(q, campaignId, characterId, null))?.scene_id ?? null;
  const feet = ctx.feetApart ? await ctx.feetApart(q, campaignId, where, characterId, targetId) : null;
  if (feet !== null && feet > INTIMIDATING_PRESENCE_FEET) reject(400, `«${target.name}» дальше ${INTIMIDATING_PRESENCE_FEET} футов.`);
  const resisted = (
    await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='presence_resisted' AND parameters->>'sourceCharacterId' = $3 AND parameters->>'sourceName' = 'Пугающее присутствие'`, [campaignId, targetId, characterId])
  ).rows[0];
  if (resisted) reject(400, `«${target.name}» уже устоял перед «Пугающим присутствием» — сутки не испугать.`);
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId: where });
  const entry = await entryOf(q, campaignId, characterId, null);
  const until = { expires: { at: 'end', of: characterId, skip: entry?.is_current ? 1 : 0 } };
  const scared = (
    await q.query(`SELECT id FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='frightened' AND parameters->>'sourceCharacterId' = $3`, [campaignId, targetId, characterId])
  ).rows[0];
  after.floatOn = targetId;
  if (scared) {
    await q.query(`UPDATE character_effects SET parameters = parameters || $2::jsonb WHERE id=$1`, [scared.id, JSON.stringify(until)]);
    return { message: `${row.name}: «Пугающее присутствие» — «${target.name}» испуган и дальше, до конца следующего хода.`, float: 'страх держится', economyScene: spent?.sceneId ?? null, heal: null };
  }
  if (!ctx.rollSaveAgainst) reject(400, 'Спасбросок недоступен.');
  const dc = 8 + proficiencyBonusForLevel(Math.max(1, row.level ?? 1)) + abilityModifier(row.charisma);
  const save = await ctx.rollSaveAgainst(q, campaignId, userId, targetId, 'wisdom', dc, `Спасбросок МДР (СЛ ${dc}) против «Пугающего присутствия» — ${target.name}`.slice(0, 100), false, { condition: 'frightened' });
  if (save.success) {
    await addCondition(q, campaignId, targetId, 'presence_resisted', { source: 'feature', sourceCharacterId: characterId, sourceName: 'Пугающее присутствие' });
    return { message: `${row.name}: «Пугающее присутствие» — «${target.name}» устоял (${save.total}), сутки неуязвим.`, float: 'устоял', economyScene: spent?.sceneId ?? null, heal: null };
  }
  const added = await addCondition(q, campaignId, targetId, 'frightened', { source: 'feature', sourceCharacterId: characterId, sourceName: 'Пугающее присутствие', ...until });
  return {
    message: `${row.name}: «Пугающее присутствие» — «${target.name}» ${added ? `испуган (${save.total}) до конца следующего хода ${row.name}` : 'не боится'}.`,
    float: added ? 'испуган!' : 'не боится', economyScene: spent?.sceneId ?? null, heal: null,
  };
}

export const barbarianActions: Record<string, FeatureAction> = {
  'end-rage': endRage,
  'rage': rage,
  'frenzy-attack': frenzyAttack,
  'reckless-attack': recklessAttack,
  'intimidating-presence': intimidatingPresence,
};

function rageView(look: FeatureLook): FeatureView {
  const { rage, classes, row, unable, empty, bonusReason } = look;
  let active: boolean = false;
  let detail: string = '';
  let reason: string | null = null;
  active = Boolean(rage);
  const bonus = Number(rage?.parameters?.damageBonus ?? rageDamageBonus(classLevelOf(classes, 'barbarian', row.level)));
  detail = active ? `+${bonus} к урону, осталось раундов: ${rage!.parameters?.remainingRounds ?? '—'}` : `+${bonus} к урону`;
  reason = active ? null : unable ?? empty ?? bonusReason;
  return { active, detail, reason };
}

function frenzyView(look: FeatureLook): FeatureView {
  const { rage, unable, bonusReason } = look;
  let active: boolean = false;
  let detail: string = '';
  let reason: string | null = null;
  active = Boolean(rage?.parameters?.frenzy);
  detail = active ? 'в бешенстве: бонусным — рукопашная атака' : 'впадая в ярость — галочка «в бешенство»';
  reason = !active ? (rage ? 'ярость без бешенства' : 'сначала ярость с бешенством') : unable ?? bonusReason;
  return { active, detail, reason };
}

function intimidatingPresenceView(look: FeatureLook): FeatureView {
  const { row, unable, actionReason } = look;
  return {
    detail: `СЛ ${8 + proficiencyBonusForLevel(Math.max(1, row.level ?? 1)) + abilityModifier(row.charisma)}, цель в ${INTIMIDATING_PRESENCE_FEET} фт. — выбранная`,
    reason: unable ?? actionReason,
  };
}

function retaliationView(look: FeatureLook): FeatureView {
  const { row } = look;
  let active: boolean = false;
  let detail: string = '';
  active = (row.auto_reactions ?? []).includes('retaliation');
  detail = active ? 'наготове: ранили в 5 фт. — реакцией удар' : 'не наготове';
  return { active, detail };
}

function recklessAttackView(look: FeatureLook): FeatureView {
  const { state, unable, entry } = look;
  let active: boolean = false;
  let detail: string = '';
  let reason: string | null = null;
  active = state.codes.has('reckless');
  detail = active ? 'до начала вашего хода: ваши рукопашные Силой и атаки по вам — с преимуществом' : 'перед первой атакой хода';
  reason = active ? null : unable ?? (!entry ? 'только в бою' : !entry.is_current ? 'не ваш ход' : entry.attacks_made > 0 ? 'только перед первой атакой хода' : null);
  return { active, detail, reason };
}

function dangerSenseView(look: FeatureLook): FeatureView {
  const { unable, state } = look;
  return {
    detail: 'спасброски ЛОВ — с преимуществом',
    reason: unable ?? (state.codes.has('blinded') ? 'ослеплён' : state.codes.has('deafened') ? 'оглох' : null),
  };
}

function mindlessRageView(look: FeatureLook): FeatureView {
  const { rage } = look;
  let active: boolean = false;
  let detail: string = '';
  active = Boolean(rage);
  detail = active ? 'в ярости: очарование и испуг не действуют' : 'в ярости — иммунитет к очарованию и испугу';
  return { active, detail };
}

function brutalCriticalView(look: FeatureLook): FeatureView {
  const { classes, row } = look;
  const dice = brutalCriticalDice(classLevelOf(classes, 'barbarian', row.level));
  return { detail: `крит рукопашным — +${dice} ${dice === 1 ? 'кость' : 'кости'} урона оружия` };
}

function relentlessRageView(look: FeatureLook): FeatureView {
  const { resource } = look;
  const left = resource ? Number(resource.current) : RELENTLESS_RAGE_MAX;
  return {
    detail: `в ярости на 0 хитов — спасбросок ТЕЛ СЛ ${relentlessRageDc(RELENTLESS_RAGE_MAX - left)}: успех — 1 хит`,
  };
}

function fastMovementView(): FeatureView {
  return { detail: '+10 фт., если в руках нет тяжёлого доспеха' };
}

function feralInstinctView(): FeatureView {
  return { detail: 'инициатива с преимуществом' };
}

function indomitableMightView(look: FeatureLook): FeatureView {
  const { row } = look;
  return { detail: `проверка Силы — не меньше ${Number(row.strength ?? 10)}` };
}

function persistentRageView(): FeatureView {
  return { detail: 'ярость не кончается раньше срока, если вы атакуете не каждый ход' };
}

export const barbarianViews: Record<string, FeatureViewFn> = {
  'rage': rageView,
  'frenzy': frenzyView,
  'intimidating-presence': intimidatingPresenceView,
  'retaliation': retaliationView,
  'reckless-attack': recklessAttackView,
  'danger-sense': dangerSenseView,
  'mindless-rage': mindlessRageView,
  'brutal-critical': brutalCriticalView,
  'relentless-rage': relentlessRageView,
  'fast-movement': fastMovementView,
  'feral-instinct': feralInstinctView,
  'indomitable-might': indomitableMightView,
  'persistent-rage': persistentRageView,
};
