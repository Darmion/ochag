import { addCondition, loadEffects } from '../../conditions.ts';
import { reject } from '../../../tabletop/scene-feature.ts';
import { entryOf } from '../helpers.ts';
import { knownHunterMultiattack, HUNTER_MULTIATTACK, VOLLEY_SPREAD_FEET, knownFavoredEnemies, favoredEnemyLimit, classLevelOf, FAVORED_ENEMY_TYPES, knownSuperiorDefense, SUPERIOR_HUNTERS_DEFENSE, knownHuntersPrey, HUNTERS_PREY, knownDefensiveTactics, DEFENSIVE_TACTICS } from '../../../../../../packages/domain/character/class-features.ts';
import { conditionState } from '../../../../../../packages/domain/combat/conditions.ts';
import { relationsFor } from '../../../campaign/factions.ts';
import { announceTime, advanceWorldTime } from '../../../campaign/world-time.ts';
import type { FeatureAction, FeatureResult, FeatureUse } from './types.ts';
import { CREATURE_TYPE_LABELS, type CreatureType } from '../../../../../../packages/domain/spells/spell-targets.ts';
import { abilityModifier } from '../../../../../../packages/domain/dice/dice.ts';
import type { FeatureLook, FeatureView, FeatureViewFn, FeatureChoice } from './types.ts';

async function volley(use: FeatureUse): Promise<FeatureResult> {
  const { row, feature, q, campaignId, characterId, sceneId, targetId, request, enforce, after } = use;
  const { actionEconomy } = use.ctx;
  const ctx = use.ctx;
  const chosen = knownHunterMultiattack(row.sheet_extra)[0];
  if (chosen !== feature) {
    reject(400, `«Мультиатака»: ${chosen ? `выбран «${HUNTER_MULTIATTACK.find(item => item.id === chosen)!.nameRu}»` : 'вариант не выбран'} — отметьте нужный в «Умениях».`);
  }
  const entry = await entryOf(q, campaignId, characterId, sceneId);
  const where = sceneId ?? entry?.scene_id ?? null;
  if (!where || !ctx.creaturesNear) reject(400, '«Мультиатака» — на сцене: выберите сцену.');
  if (feature === 'volley' && !targetId) reject(400, '«Залп»: выберите цель — стрелы полетят в неё и во всех в 10 футах от неё.');
  const near = feature === 'volley'
    ? [{ id: targetId!, name: '' }, ...await ctx.creaturesNear(q, campaignId, where!, targetId!, 10)]
    : await ctx.creaturesNear(q, campaignId, where!, characterId, 5);
  const ids = [...new Set(near.map(item => item.id).filter(id => id !== characterId))];
  const rows = ids.length
    ? (await q.query('SELECT id, name, kind, disposition FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, ids])).rows as any[]
    : [];
  const sides = await relationsFor(q, campaignId, [characterId, ...rows.map(other => other.id as string)]);
  const foes: Array<{ id: string; name: string }> = [];
  for (const other of rows) {
    if (other.kind === 'object') continue;
    if (other.id !== targetId && sides.factionsOf(characterId).length > 0 && sides.allies(characterId, other.id)) continue;
    if (conditionState((await loadEffects(q, campaignId, other.id)).map(effect => effect.effect_code)).codes.has('dead')) continue;
    foes.push({ id: other.id, name: other.name });
  }
  if (feature === 'volley' && ctx.feetApart) {
    for (const foe of foes) {
      const feet = await ctx.feetApart(q, campaignId, where, targetId!, foe.id);
      if (feet !== null && feet > VOLLEY_SPREAD_FEET) reject(400, `«Залп»: «${foe.name}» дальше 10 футов от точки.`);
    }
  }
  if (!foes.length) reject(400, feature === 'whirlwind' ? '«Вихрь»: в 5 футах от вас врагов нет.' : '«Залп»: целей нет.');
  let weaponId = request.body?.weaponId ?? null;
  if (feature === 'volley' && !weaponId) {
    const ranged = (await q.query(
      `SELECT id, damage_formula FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND weapon_kind='ranged'`, [campaignId, characterId],
    )).rows as any[];
    weaponId = ranged[0]?.id ?? null;
    if (!weaponId) reject(400, '«Залп» — дальнобойным оружием, а его в листе нет.');
  }
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId: where });
  after.volley = { targets: foes, weaponId, sceneId: where! };
  return {
    message: `${row.name}: «${feature === 'volley' ? 'Залп' : 'Вихрь'}» — ${foes.map(foe => foe.name).join(', ')}:`,
    float: feature === 'volley' ? 'залп' : 'вихрь', economyScene: spent?.sceneId ?? null, heal: null,
  };
}

async function hideInPlainSight(use: FeatureUse): Promise<FeatureResult> {
  const { q, campaignId, characterId, row, state } = use;
  const ctx = use.ctx;
  if (await entryOf(q, campaignId, characterId, null)) reject(400, `${row.name} в бою — маскировка занимает минуту.`);
  if (state.codes.has('camouflaged')) reject(400, `${row.name} уже замаскирован.`);
  announceTime(ctx, campaignId, await advanceWorldTime(q, campaignId, 1));
  await addCondition(q, campaignId, characterId, 'camouflaged', { source: 'feature', sourceName: 'Сокрытие' });
  return {
    message: `${row.name}: «Сокрытие» — минута маскировки, +10 к Скрытности, пока стоит на месте.`,
    float: 'замаскирован', economyScene: null, heal: null,
  };
}

export const rangerActions: Record<string, FeatureAction> = {
  'volley': volley,
  'whirlwind': volley,
  'hide-in-plain-sight': hideInPlainSight,
};

function favoredEnemyView(look: FeatureLook): FeatureView {
  const { row, classes } = look;
  let choices: FeatureChoice[] | null = null;
  let detail: string = '';
  const known = knownFavoredEnemies(row.sheet_extra);
  const limit = favoredEnemyLimit(classLevelOf(classes, 'ranger', row.level));
  choices = FAVORED_ENEMY_TYPES.map(type => ({ value: type, label: CREATURE_TYPE_LABELS[type as CreatureType], ...(known.includes(type) ? { active: true } : {}) }));
  detail = `выбрано ${known.length} из ${limit}${known.length ? `: ${known.map(type => CREATURE_TYPE_LABELS[type as CreatureType]).join(', ')}` : ''}`;
  return { choices, detail };
}

function foeSlayerView(look: FeatureLook): FeatureView {
  const { row } = look;
  return { detail: `раз в ход по избранному врагу — +${Math.max(0, abilityModifier(row.wisdom))} к урону` };
}

function superiorHuntersDefenseView(look: FeatureLook): FeatureView {
  const { row } = look;
  const known = knownSuperiorDefense(row.sheet_extra);
  return {
    choices: SUPERIOR_HUNTERS_DEFENSE.map(item => ({ value: item.id, label: item.nameRu, hint: item.text, ...(known.includes(item.id) ? { active: true } : {}) })),
    detail: known.length ? `${SUPERIOR_HUNTERS_DEFENSE.find(item => item.id === known[0])!.nameRu} — само` : 'не выбрано',
  };
}

function huntersPreyView(look: FeatureLook): FeatureView {
  const { row } = look;
  const known = knownHuntersPrey(row.sheet_extra);
  return {
    choices: HUNTERS_PREY.map(item => ({ value: item.id, label: item.nameRu, ...(known.includes(item.id) ? { active: true } : {}) })),
    detail: known.length ? HUNTERS_PREY.find(item => item.id === known[0])!.nameRu + (known[0] === 'colossus-slayer' ? ' — само, раз в ход' : ' — вручную') : 'не выбрано',
  };
}

function hideInPlainSightView(look: FeatureLook): FeatureView {
  const { effects, unable, entry } = look;
  let active: boolean = false;
  let detail: string = '';
  let reason: string | null = null;
  active = effects.some(effect => effect.effect_code === 'camouflaged');
  detail = active ? 'замаскирован: +10 к Скрытности, пока стоит на месте' : 'минута маскировки: +10 к Скрытности';
  reason = active ? 'уже замаскирован' : unable ?? (entry ? 'в бою нельзя' : null);
  return { active, detail, reason };
}

function vanishView(): FeatureView {
  return { detail: '«Спрятаться» бонусным действием — в «Действиях»' };
}

function feralSensesView(): FeatureView {
  return { detail: 'по невидимым и в темноте — без помехи' };
}

function defensiveTacticsView(look: FeatureLook): FeatureView {
  const { row } = look;
  const known = knownDefensiveTactics(row.sheet_extra);
  return {
    choices: DEFENSIVE_TACTICS.map(item => ({ value: item.id, label: item.nameRu, hint: item.text, ...(known.includes(item.id) ? { active: true } : {}) })),
    detail: known.length ? `${DEFENSIVE_TACTICS.find(item => item.id === known[0])!.nameRu} — само` : 'не выбрано',
  };
}

function hunterMultiattackView(look: FeatureLook): FeatureView {
  const { row, unable, actionReason } = look;
  const known = knownHunterMultiattack(row.sheet_extra);
  return {
    choices: HUNTER_MULTIATTACK.map(item => ({ value: item.id, label: item.nameRu, hint: item.text, ...(known.includes(item.id) ? { active: true } : {}) })),
    detail: known[0] === 'volley' ? 'Залп: выбранная цель и все в 10 фт. от неё, действием'
    : known[0] === 'whirlwind' ? 'Вихрь: все враги в 5 фт. от вас, действием' : 'не выбрано',
    reason: !known.length ? 'выберите вариант' : unable ?? actionReason,
  };
}

export const rangerViews: Record<string, FeatureViewFn> = {
  'favored-enemy': favoredEnemyView,
  'foe-slayer': foeSlayerView,
  'superior-hunters-defense': superiorHuntersDefenseView,
  'hunters-prey': huntersPreyView,
  'hide-in-plain-sight': hideInPlainSightView,
  'vanish': vanishView,
  'feral-senses': feralSensesView,
  'defensive-tactics': defensiveTacticsView,
  'hunter-multiattack': hunterMultiattackView,
};
