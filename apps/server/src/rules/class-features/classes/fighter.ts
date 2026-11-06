import { reject } from '../../../tabletop/scene-feature.ts';
import { spendResource, entryOf } from '../helpers.ts';
import { classLevelOf, knownManeuvers, MANEUVERS, superiorityDie, maneuverDc } from '../../../../../../packages/domain/character/class-features.ts';
import type { FeatureAction, FeatureResult, FeatureUse } from './types.ts';
import { proficiencyBonusForLevel, abilityModifier } from '../../../../../../packages/domain/dice/dice.ts';
import type { FeatureLook, FeatureView, FeatureViewFn } from './types.ts';

async function secondWind(use: FeatureUse): Promise<FeatureResult> {
  const { q, campaignId, characterId, enforce, sceneId, row, classes, userId } = use;
  const { actionEconomy, rollDie, insertRoll, applyHpChange } = use.ctx;
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'bonus', { kind: 'other' }, { enforce, sceneId });
  await spendResource(q, campaignId, row, 'Второе дыхание');
  const die = rollDie(10);
  const level = classLevelOf(classes, 'fighter', row.level);
  const total = die + level;
  await insertRoll(q, campaignId, userId, characterId, `Второе дыхание — ${row.name}`.slice(0, 100), `1d10+${level}`, [die], level, total, false, null, { kind: 'heal' });
  const heal = await applyHpChange(q, campaignId, userId, characterId, { mode: 'heal', amount: total, damageType: null, critical: false });
  return { message: `${row.name}: второе дыхание — +${heal.applied} хит.`, float: null, economyScene: spent?.sceneId ?? null, heal };
}

async function actionSurge(use: FeatureUse): Promise<FeatureResult> {
  const { q, campaignId, characterId, sceneId, row } = use;
  const { actionEconomy } = use.ctx;
  const entry = await actionEconomy.entryFor(q, campaignId, characterId, sceneId);
  if (!entry || !entry.is_current) reject(400, 'Всплеск действий — в бою, в свой ход.');
  if ((await entryOf(q, campaignId, characterId, entry.scene_id))?.action_surged) reject(400, 'Всплеск действий — не больше раза за ход.');
  await spendResource(q, campaignId, row, 'Всплеск действий');
  await q.query('UPDATE initiative_entries SET action_used=false, attacks_made=0, action_surged=true WHERE id=$1', [entry.id]);
  return { message: `${row.name}: всплеск действий — ещё одно действие в этот ход.`, float: 'всплеск действий', economyScene: entry.scene_id as string, heal: null };
}

export const fighterActions: Record<string, FeatureAction> = {
  'second-wind': secondWind,
  'action-surge': actionSurge,
};

function secondWindView(look: FeatureLook): FeatureView {
  const { classes, row, unable, empty, bonusReason } = look;
  return {
    detail: `1d10+${classLevelOf(classes, 'fighter', row.level)} хитов`,
    reason: unable ?? empty ?? (row.hp_current >= row.hp_max ? 'хиты полны' : null) ?? bonusReason,
  };
}

function actionSurgeView(look: FeatureLook): FeatureView {
  const { unable, entry, empty } = look;
  return {
    detail: 'ещё одно действие',
    reason: unable ?? (!entry ? 'только в бою' : !entry.is_current ? 'не ваш ход' : entry.action_surged ? 'уже в этот ход' : null) ?? empty,
  };
}

function improvedCriticalView(look: FeatureLook): FeatureView {
  const { classes, row } = look;
  return { detail: `крит на ${classLevelOf(classes, 'fighter', row.level) >= 15 ? '18' : '19'}–20` };
}

function combatSuperiorityView(look: FeatureLook): FeatureView {
  const { row, classes, empty } = look;
  const known = knownManeuvers(row.sheet_extra);
  return {
    choices: MANEUVERS.map(item => ({ value: item.id, label: item.nameRu, ...(known.includes(item.id) ? { active: true } : {}) })),
    detail: `кость к${superiorityDie(classLevelOf(classes, 'fighter', row.level))}, СЛ ${maneuverDc(proficiencyBonusForLevel(Math.max(1, row.level ?? 1)), abilityModifier(row.strength), abilityModifier(row.dexterity))} — кнопка после попадания оружием`,
    reason: empty,
  };
}

function remarkableAthleteView(look: FeatureLook): FeatureView {
  const { row } = look;
  return {
    detail: `+${Math.ceil(proficiencyBonusForLevel(Math.max(1, row.level ?? 1)) / 2)} к проверкам СИЛ, ЛОВ, ТЕЛ без владения и к инициативе`,
  };
}

function survivorView(look: FeatureLook): FeatureView {
  const { row } = look;
  return {
    detail: `в начале хода при ${Math.floor(Number(row.hp_max) / 2)} хит. и меньше — +${5 + abilityModifier(Number(row.constitution ?? 10))}`,
  };
}

function protectionStyleView(look: FeatureLook): FeatureView {
  const { row } = look;
  let active: boolean = false;
  let detail: string = '';
  active = (row.auto_reactions ?? []).includes('protection');
  detail = active ? 'наготове — сама, реакцией' : 'не наготове';
  return { active, detail };
}

export const fighterViews: Record<string, FeatureViewFn> = {
  'second-wind': secondWindView,
  'action-surge': actionSurgeView,
  'improved-critical': improvedCriticalView,
  'combat-superiority': combatSuperiorityView,
  'remarkable-athlete': remarkableAthleteView,
  'survivor': survivorView,
  'protection-style': protectionStyleView,
};
