import { reject } from '../../../tabletop/scene-feature.ts';
import { spendResource, entryOf } from '../helpers.ts';
import { pactSlotsSpent, restorePactSlots } from '../../../characters/class-slots.ts';
import { announceTime, advanceWorldTime } from '../../../campaign/world-time.ts';
import type { FeatureAction, FeatureResult, FeatureUse } from './types.ts';
import { knownInvocations, INVOCATIONS, darkBlessingHp, classLevelOf, mysticArcanumLevels, knownFiendishResilience, FIENDISH_RESILIENCE_TYPES } from '../../../../../../packages/domain/character/class-features.ts';
import { abilityModifier } from '../../../../../../packages/domain/dice/dice.ts';
import type { FeatureLook, FeatureView, FeatureViewFn } from './types.ts';

async function eldritchMaster(use: FeatureUse): Promise<FeatureResult> {
  const { q, campaignId, characterId, classes, row } = use;
  const ctx = use.ctx;
  if (await entryOf(q, campaignId, characterId, null)) reject(400, `«Мастер таинств» — вне боя: на это уходит минута.`);
  if (!(await pactSlotsSpent(q, campaignId, characterId, classes))) reject(400, `${row.name}: ячейки договора и так целы.`);
  await spendResource(q, campaignId, row, 'Мастер таинств');
  await restorePactSlots(q, campaignId, characterId, classes);
  announceTime(ctx, campaignId, await advanceWorldTime(q, campaignId, 1));
  return { message: `${row.name}: «Мастер таинств» — минута мольбы, ячейки договора вернулись.`, float: 'ячейки', economyScene: null, heal: null };
}

export const warlockActions: Record<string, FeatureAction> = {
  'eldritch-master': eldritchMaster,
};

function hurlThroughHellView(look: FeatureLook): FeatureView {
  const { empty } = look;
  return { detail: 'кнопка после попадания атакой; вернувшись, цель получает 10к10 психического', reason: empty };
}

function eldritchInvocationsView(look: FeatureLook): FeatureView {
  const { row } = look;
  const known = knownInvocations(row.sheet_extra);
  return {
    choices: INVOCATIONS.map(entry => ({ value: entry.id, label: entry.nameRu, ...(known.includes(entry.id) ? { active: true } : {}) })) as any,
    detail: known.length ? INVOCATIONS.filter(entry => known.includes(entry.id)).map(entry => entry.nameRu).join(', ') : 'не отмечены',
  };
}

function darkOnesBlessingView(look: FeatureLook): FeatureView {
  const { row, classes } = look;
  return {
    detail: `+${darkBlessingHp(abilityModifier(row.charisma), classLevelOf(classes, 'warlock', row.level))} временных хитов за поверженного врага`,
  };
}

function darkOnesOwnLuckView(look: FeatureLook): FeatureView {
  const { empty } = look;
  return { detail: 'к10 к проваленной проверке или спасброску против СЛ — сама, если может спасти', reason: empty };
}

async function mysticArcanumView(look: FeatureLook): Promise<FeatureView> {
  const { classes, row, q, campaignId, characterId } = look;
  const levels = mysticArcanumLevels(classLevelOf(classes, 'warlock', row.level));
  const charges = new Map(
    (await q.query(`SELECT name, current FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name LIKE 'Мистический арканум:%'`, [campaignId, characterId])).rows
      .map(entry => [String(entry.name), Number(entry.current)]),
  );
  return {
    choices: levels.map(level => ({ value: String(level), label: `${level} ур.`, count: charges.get(`Мистический арканум: ${level} ур.`) === 0 ? 0 : 1 })),
    detail: `${levels.map(level => `${level} ур. — ${charges.get(`Мистический арканум: ${level} ур.`) === 0 ? 'потрачен' : 'есть'}`).join(', ')}; в окне сотворения`,
  };
}

function fiendishResilienceView(look: FeatureLook): FeatureView {
  const { row, entry } = look;
  const known = knownFiendishResilience(row.sheet_extra);
  return {
    choices: FIENDISH_RESILIENCE_TYPES.map(item => ({ value: item.id, label: item.nameRu, ...(known.includes(item.id) ? { active: true } : {}) })),
    detail: known.length ? `сопротивление: ${FIENDISH_RESILIENCE_TYPES.find(item => item.id === known[0])!.nameRu}` : 'вид урона не выбран',
    reason: entry ? 'сменить — вне боя' : null,
  };
}

async function eldritchMasterView(look: FeatureLook): Promise<FeatureView> {
  const { q, campaignId, characterId, classes, unable, empty, entry } = look;
  const spentSlots = await pactSlotsSpent(q, campaignId, characterId, classes);
  return {
    detail: spentSlots ? `минута — вернуть ячейки договора (потрачено: ${spentSlots})` : 'минута — вернуть ячейки договора',
    reason: unable ?? empty ?? (entry ? 'вне боя' : null) ?? (spentSlots ? null : 'ячейки договора целы'),
  };
}

export const warlockViews: Record<string, FeatureViewFn> = {
  'hurl-through-hell': hurlThroughHellView,
  'eldritch-invocations': eldritchInvocationsView,
  'dark-ones-blessing': darkOnesBlessingView,
  'dark-ones-own-luck': darkOnesOwnLuckView,
  'mystic-arcanum': mysticArcanumView,
  'fiendish-resilience': fiendishResilienceView,
  'eldritch-master': eldritchMasterView,
};
