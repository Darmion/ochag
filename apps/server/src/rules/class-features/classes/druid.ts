import { addCondition } from '../../conditions.ts';
import { reject } from '../../../tabletop/scene-feature.ts';
import { wildShapeBeasts, revertWildShape } from '../../class-features.ts';
import { spendResource } from '../helpers.ts';
import { classLevelOf, classFeaturesFor, wildShapeLimit } from '../../../../../../packages/domain/character/class-features.ts';
import { monsterSheet } from '../../../../../../packages/domain/world/bestiary.ts';
import type { FeatureAction, FeatureResult, FeatureUse } from './types.ts';
import { arcaneRecovery } from './wizard.ts';
import type { FeatureLook, FeatureView, FeatureViewFn, FeatureChoice } from './types.ts';

async function wildShape(use: FeatureUse): Promise<FeatureResult> {
  const { state, row, classes, request, q, campaignId, characterId, enforce, sceneId } = use;
  const { actionEconomy } = use.ctx;
  if (state.codes.has('wild_shape')) reject(400, `${row.name} уже в зверином облике.`);
  const beast = wildShapeBeasts(classLevelOf(classes, 'druid', row.level)).find(entry => entry.index === request.body?.beast);
  if (!beast) reject(400, 'Такого зверя этим уровнем не принять — выберите из списка.');
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId });
  if (!classFeaturesFor(classes).some(item => item.id === 'archdruid')) await spendResource(q, campaignId, row, 'Дикий облик');
  const own = {
    hp_current: row.hp_current, hp_max: row.hp_max, armor_class: row.armor_class, speed_feet: row.speed_feet,
    strength: row.strength, dexterity: row.dexterity, constitution: row.constitution, size: row.size,
  };
  await addCondition(q, campaignId, characterId, 'wild_shape', { source: 'feature', beast: beast.index, beastName: beast.nameRu, own });
  await q.query(
    `UPDATE characters SET hp_current=$3, hp_max=$3, hp_temp=0, armor_class=$4, speed_feet=$5, strength=$6, dexterity=$7, constitution=$8, size=$9, revision=revision+1
             WHERE campaign_id=$1 AND id=$2`,
    [campaignId, characterId, beast.hp, beast.ac, beast.speed, beast.abilities[0], beast.abilities[1], beast.abilities[2], beast.size],
  );
  for (const weapon of monsterSheet(beast, beast.hp).weapons) {
    await q.query(
      `INSERT INTO character_weapons (campaign_id, character_id, name, ability, proficient, damage_formula, damage_type, range_feet, weapon_kind,
                 long_range_feet, thrown_range_feet, versatile_formula, properties, attack_bonus, extra_damage_formula, extra_damage_type)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16)`,
      [
        campaignId, characterId, `${weapon.name} (${beast.nameRu})`.slice(0, 100), weapon.ability, weapon.proficient, weapon.damage_formula, weapon.damage_type,
        weapon.range_feet, weapon.weapon_kind, weapon.long_range_feet, weapon.thrown_range_feet, weapon.versatile_formula,
        JSON.stringify([...weapon.properties, 'wild_shape']), weapon.attack_bonus, weapon.extra_damage_formula, weapon.extra_damage_type,
      ],
    );
  }
  return {
    message: `${row.name} принимает облик: ${beast.nameRu} — хиты ${beast.hp}, КД ${beast.ac}, скорость ${beast.speed} фт.`,
    float: beast.nameRu, economyScene: spent?.sceneId ?? null, heal: null,
  };
}

async function endWildShape(use: FeatureUse): Promise<FeatureResult> {
  const { q, campaignId, characterId, row } = use;
  const back = await revertWildShape(q, campaignId, characterId, 0);
  if (!back) reject(400, `${row.name} не в зверином облике.`);
  return { message: `${row.name} снова в своём облике — хиты ${back.hp}.`, float: 'свой облик', economyScene: null, heal: null };
}

export const druidActions: Record<string, FeatureAction> = {
  'wild-shape': wildShape,
  'end-wild-shape': endWildShape,
  'natural-recovery': arcaneRecovery,
};

function wildShapeView(look: FeatureLook): FeatureView {
  const { wildShape, classes, row, unable, empty, actionReason } = look;
  let active: boolean = false;
  let choices: FeatureChoice[] | null = null;
  let detail: string = '';
  let reason: string | null = null;
  active = Boolean(wildShape);
  const beasts = wildShapeBeasts(classLevelOf(classes, 'druid', row.level));
  choices = beasts.map(beast => ({ value: beast.index, label: `${beast.nameRu} (опасность ${beast.cr < 1 ? `1/${Math.round(1 / beast.cr)}` : beast.cr}, хиты ${beast.hp}, КД ${beast.ac})` }));
  detail = active ? `в облике: ${wildShape!.parameters?.beastName ?? 'зверь'}; свои хиты ${wildShape!.parameters?.own?.hp_current ?? '—'}` : `звери до опасности ${wildShapeLimit(classLevelOf(classes, 'druid', row.level)).cr < 1 ? `1/${Math.round(1 / wildShapeLimit(classLevelOf(classes, 'druid', row.level)).cr)}` : 1}`;
  reason = active ? null : unable ?? empty ?? actionReason;
  return { active, choices, detail, reason };
}

function archdruidView(): FeatureView {
  return { detail: '«Дикий облик» — без счёта' };
}

function naturesWardView(): FeatureView {
  return { detail: 'иммунитет к яду; элементали и феи не очаруют и не испугают' };
}

function naturesSanctuaryView(): FeatureView {
  return { detail: 'звери и растения — спасбросок Мудрости, прежде чем напасть' };
}

function beastSpellsView(): FeatureView {
  return { detail: 'в облике зверя можно колдовать' };
}

export const druidViews: Record<string, FeatureViewFn> = {
  'wild-shape': wildShapeView,
  'archdruid': archdruidView,
  'natures-ward': naturesWardView,
  'natures-sanctuary': naturesSanctuaryView,
  'beast-spells': beastSpellsView,
};
