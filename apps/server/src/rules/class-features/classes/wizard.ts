import { reject } from '../../../tabletop/scene-feature.ts';
import { spendResource, entryOf, spellsOf } from '../helpers.ts';
import { classLevelOf, arcaneRecoveryProblem, spellPicks } from '../../../../../../packages/domain/character/class-features.ts';
import type { FeatureAction, FeatureResult, FeatureUse } from './types.ts';
import { abilityModifier } from '../../../../../../packages/domain/dice/dice.ts';
import type { FeatureLook, FeatureView, FeatureViewFn, FeatureChoice } from './types.ts';

export async function arcaneRecovery(use: FeatureUse): Promise<FeatureResult> {
  const { feature, q, campaignId, characterId, request, classes, row } = use;
  const title = feature === 'arcane-recovery' ? 'Арканное восстановление' : 'Природное восстановление';
  if (await entryOf(q, campaignId, characterId, null)) reject(400, `«${title}» — вне боя.`);
  const levels = request.body?.slots ?? [];
  const problem = arcaneRecoveryProblem(classLevelOf(classes, feature === 'arcane-recovery' ? 'wizard' : 'druid', row.level), levels);
  if (problem) reject(400, `«${title}»: ${problem}.`);
  const counts = new Map<number, number>();
  for (const level of levels) counts.set(level, (counts.get(level) ?? 0) + 1);
  for (const [level, count] of counts) {
    const slot = (await q.query('SELECT current, max FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 AND level=$3 FOR UPDATE', [campaignId, characterId, level])).rows[0] as any;
    if (!slot || slot.max - slot.current < count) reject(400, `Ячеек ${level}-го уровня потрачено меньше, чем ${count}.`);
  }
  await spendResource(q, campaignId, row, title);
  for (const [level, count] of counts) {
    await q.query('UPDATE character_spell_slots SET current=current+$4 WHERE campaign_id=$1 AND character_id=$2 AND level=$3', [campaignId, characterId, level, count]);
  }
  const text = [...counts].sort((a, b) => a[0] - b[0]).map(([level, count]) => `${level} ур.${count > 1 ? ` ×${count}` : ''}`).join(', ');
  return { message: `${row.name}: «${title}» — вернулись ячейки ${text}.`, float: 'ячейки', economyScene: null, heal: null };
}

export const wizardActions: Record<string, FeatureAction> = {
  'arcane-recovery': arcaneRecovery,
};

function empoweredEvocationView(look: FeatureLook): FeatureView {
  const { row } = look;
  return {
    detail: `+${Math.max(0, abilityModifier(Number(row.intelligence ?? 10)))} к одному броску урона воплощения`,
  };
}

function sculptSpellsView(): FeatureView {
  return { detail: 'свои в области воплощения (до 1 + уровень) — сами спасаются и без урона' };
}

async function spellMasteryView(look: FeatureLook): Promise<FeatureView> {
  const { feature, row, q, campaignId, characterId } = look;
  let choices: FeatureChoice[] | null = null;
  let detail: string = '';
  const mastery = feature.id === 'spell-mastery';
  const picked = spellPicks(row.sheet_extra)[mastery ? 'mastery' : 'signature'];
  const spells = (await spellsOf(q, campaignId, characterId)).filter(spell => (mastery ? spell.level === 1 || spell.level === 2 : spell.level === 3));
  const spent = mastery ? new Set<string>() : new Set(
    (await q.query(`SELECT name FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name LIKE 'Фирменное:%' AND current = 0`, [campaignId, characterId])).rows
      .map(entry => String(entry.name)),
  );
  choices = spells.map(spell => ({
    value: spell.id, label: spell.name, hint: `${spell.level} ур.`,
    ...(picked.includes(spell.id) ? { active: true } : {}),
    ...(!mastery && picked.includes(spell.id) ? { count: spent.has(`Фирменное: ${spell.name}`.slice(0, 100)) ? 0 : 1 } : {}),
  }));
  const chosen = spells.filter(spell => picked.includes(spell.id));
  detail = chosen.length
    ? chosen.map(spell => `${spell.name}${spent.has(`Фирменное: ${spell.name}`.slice(0, 100)) ? ' (потрачено)' : ''}`).join(', ') + ' — без ячейки, в окне сотворения'
    : mastery ? 'выберите заклинание 1-го и 2-го уровня' : 'выберите два заклинания 3-го уровня';
  return { choices, detail };
}

function potentCantripView(): FeatureView {
  return { detail: 'спасся от вашего заговора — всё равно половина урона' };
}

function overchannelView(look: FeatureLook): FeatureView {
  const { effects } = look;
  const strain = effects.find(effect => effect.effect_code === 'overchannel');
  const uses = Number(strain?.parameters?.uses ?? 0);
  return {
    detail: uses ? `уже ${uses} раз с долгого отдыха — следующий: ${uses + 1}к12 некротического себе за уровень` : 'первый раз до долгого отдыха — даром; галочка в окне сотворения',
  };
}

export const wizardViews: Record<string, FeatureViewFn> = {
  'empowered-evocation': empoweredEvocationView,
  'sculpt-spells': sculptSpellsView,
  'spell-mastery': spellMasteryView,
  'signature-spells': spellMasteryView,
  'potent-cantrip': potentCantripView,
  'overchannel': overchannelView,
};
