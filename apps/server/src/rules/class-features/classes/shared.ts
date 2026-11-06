import { classLevelOf } from '../../../../../../packages/domain/character/class-features.ts';
import { CLASS_LABELS } from '../../../../../../packages/domain/character/classes.ts';
import type { FeatureLook, FeatureView, FeatureViewFn, FeatureChoice } from './types.ts';

function landsStrideView(): FeatureView {
  return { detail: 'местность сцены — без лишней цены движения' };
}

function evasionView(): FeatureView {
  return { detail: 'спасбросок ЛОВ: успех — 0, провал — половина' };
}

async function indomitableView(look: FeatureLook): Promise<FeatureView> {
  const { q, campaignId, feature, empty } = look;
  const manual = (await q.query(`SELECT value FROM campaign_rules WHERE campaign_id=$1 AND key='save_rerolls' AND kind='text'`, [campaignId])).rows[0]?.value === 'manual';
  return {
    detail: `${feature.id === 'diamond-soul' ? 'владение всеми спасбросками; ' : ''}провал спасброска — переброс${feature.id === 'diamond-soul' ? ' за 1 ци' : ''}${manual ? ' (правило «Вручную» — решает мастер)' : ''}`,
    reason: empty,
  };
}

function superiorInspirationView(look: FeatureLook): FeatureView {
  const { feature } = look;
  return {
    detail: feature.id === 'superior-inspiration' ? 'инициатива без костей вдохновения — одна кость' : 'инициатива без ци — 4 очка',
  };
}

async function arcaneRecoveryView(look: FeatureLook): Promise<FeatureView> {
  const { classes, feature, row, q, campaignId, characterId, unable, empty, entry } = look;
  let choices: FeatureChoice[] | null = null;
  let limit: number | null = null;
  let detail: string = '';
  let reason: string | null = null;
  const wizard = classLevelOf(classes, feature.id === 'arcane-recovery' ? 'wizard' : 'druid', row.level);
  const slots = (await q.query('SELECT level, current, max FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 AND level <= 5 AND current < max ORDER BY level', [campaignId, characterId])).rows as any[];
  choices = slots.map(slot => ({ value: String(slot.level), label: `${slot.level} ур.`, count: slot.max - slot.current }));
  limit = Math.ceil(Math.max(1, wizard) / 2);
  detail = `ячейки на сумму до ${limit} ур. (не выше 5-го)`;
  reason = unable ?? empty ?? (entry ? 'в бою нельзя' : null) ?? (slots.length ? null : 'ячейки целы');
  return { choices, limit, detail, reason };
}

function unarmoredDefenseView(look: FeatureLook): FeatureView {
  const { unarmored, feature, row } = look;
  let detail: string = '';
  let reason: string | null = null;
  let active: boolean = false;
  if (unarmored && unarmored.classId !== feature.classId) {
    detail = `второй раз не берётся — считается по классу «${CLASS_LABELS[unarmored.classId]}»`;
    reason = 'уже есть от другого класса';
  } else if (unarmored) {
    active = row.armor_class === unarmored.ac || (unarmored.shield && row.armor_class === unarmored.ac + 2);
    detail = `без доспехов КД ${unarmored.ac} = 10 + ЛОВ + ${unarmored.ability === 'constitution' ? 'ТЕЛ' : 'МДР'}${unarmored.shield ? ' (+2 со щитом)' : ''}`;
  }
  return { detail, reason, active };
}

export const sharedViews: Record<string, FeatureViewFn> = {
  'lands-stride': landsStrideView,
  'lands-stride-ranger': landsStrideView,
  'evasion': evasionView,
  'evasion-monk': evasionView,
  'indomitable': indomitableView,
  'diamond-soul': indomitableView,
  'superior-inspiration': superiorInspirationView,
  'perfect-self': superiorInspirationView,
  'arcane-recovery': arcaneRecoveryView,
  'natural-recovery': arcaneRecoveryView,
  'unarmored-defense': unarmoredDefenseView,
  'unarmored-defense-monk': unarmoredDefenseView,
};
