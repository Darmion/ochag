import { sneakAttackDice, classLevelOf } from '../../../../../../packages/domain/character/class-features.ts';
import type { FeatureLook, FeatureView, FeatureViewFn } from './types.ts';

function cunningActionView(look: FeatureLook): FeatureView {
  const { unable, entry, bonusReason } = look;
  return { detail: 'Рывок, Отход, Спрятаться', reason: unable ?? (!entry ? 'только в бою' : bonusReason) };
}

function sneakAttackView(look: FeatureLook): FeatureView {
  const { classes, row, entry } = look;
  return {
    detail: `${sneakAttackDice(classLevelOf(classes, 'rogue', row.level))}d6`,
    reason: entry?.sneak_attack_used ? 'в этот ход уже была' : null,
  };
}

function supremeSneakView(): FeatureView {
  return { detail: 'Скрытность с преимуществом, если прошли не больше половины скорости' };
}

function thiefsReflexesView(): FeatureView {
  return { detail: 'в первом раунде — второй ход на инициативу −10' };
}

function uncannyDodgeView(look: FeatureLook): FeatureView {
  const { row } = look;
  let active: boolean = false;
  let detail: string = '';
  active = (row.auto_reactions ?? []).includes('uncanny-dodge');
  detail = active ? 'наготове: урон вдвое' : 'не наготове';
  return { active, detail };
}

function reliableTalentView(): FeatureView {
  return { detail: 'проверка навыка с владением — к20 не меньше 10' };
}

function slipperyMindView(): FeatureView {
  return { detail: 'владение спасбросками МДР' };
}

function elusiveView(look: FeatureLook): FeatureView {
  const { unable } = look;
  return { detail: 'у атак по вам нет преимущества', reason: unable ? `не действует: ${unable}` : null };
}

function strokeOfLuckView(look: FeatureLook): FeatureView {
  const { empty } = look;
  return { detail: 'промах — попадание: галочка в окне атаки', reason: empty };
}

function blindsenseView(): FeatureView {
  return { detail: 'спрятавшиеся в 10 фт. — без помехи «цель скрыта»' };
}

export const rogueViews: Record<string, FeatureViewFn> = {
  'cunning-action': cunningActionView,
  'sneak-attack': sneakAttackView,
  'supreme-sneak': supremeSneakView,
  'thiefs-reflexes': thiefsReflexesView,
  'uncanny-dodge': uncannyDodgeView,
  'reliable-talent': reliableTalentView,
  'slippery-mind': slipperyMindView,
  'elusive': elusiveView,
  'stroke-of-luck': strokeOfLuckView,
  'blindsense': blindsenseView,
};
