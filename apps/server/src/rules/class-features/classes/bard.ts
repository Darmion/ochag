import { addCondition } from '../../conditions.ts';
import { reject } from '../../../tabletop/scene-feature.ts';
import { spendResource, entryOf } from '../helpers.ts';
import { classLevelOf, bardicDie, COUNTERCHARM_FEET, songOfRestDie } from '../../../../../../packages/domain/character/class-features.ts';
import type { FeatureAction, FeatureResult, FeatureUse } from './types.ts';
import { proficiencyBonusForLevel } from '../../../../../../packages/domain/dice/dice.ts';
import type { FeatureLook, FeatureView, FeatureViewFn } from './types.ts';

async function bardicInspiration(use: FeatureUse): Promise<FeatureResult> {
  const { targetId, characterId, q, campaignId, sceneId, enforce, row, classes, after } = use;
  const { actionEconomy } = use.ctx;
  const ctx = use.ctx;
  if (!targetId) reject(400, 'Кого вдохновить — выберите существо.');
  if (targetId === characterId) reject(400, 'Вдохновение барда — другому существу, не себе.');
  const target = (await q.query('SELECT id, name, kind FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0] as any;
  if (!target || target.kind === 'object') reject(404, 'Существо не найдено.');
  const feet = ctx.feetApart ? await ctx.feetApart(q, campaignId, sceneId, characterId, target.id) : null;
  if (feet !== null && feet > 60) reject(400, `«${target.name}» дальше 60 футов (${Math.round(feet)} фт.).`);
  const already = (await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='bardic_inspiration' AND active`, [campaignId, target.id])).rows[0];
  if (already) reject(400, `У «${target.name}» уже есть кость вдохновения — вторая не даётся.`);
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'bonus', { kind: 'other' }, { enforce, sceneId });
  await spendResource(q, campaignId, row, 'Вдохновение барда');
  const die = bardicDie(classLevelOf(classes, 'bard', row.level));
  await addCondition(q, campaignId, target.id, 'bardic_inspiration', {
    source: 'feature', die, sourceCharacterId: characterId, sourceName: row.name, remainingRounds: 100, durationRounds: 100,
  });
  after.floatOn = target.id;
  return {
    message: `${row.name} вдохновляет «${target.name}»: кость к${die} — к одной проверке, атаке или спасброску в ближайшие 10 минут.`,
    float: `вдохновение к${die}`, economyScene: spent?.sceneId ?? null, heal: null,
  };
}

async function countercharm(use: FeatureUse): Promise<FeatureResult> {
  const { q, campaignId, characterId, enforce, sceneId, row } = use;
  const { actionEconomy } = use.ctx;
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId });
  const entry = await entryOf(q, campaignId, characterId, null);
  await addCondition(q, campaignId, characterId, 'countercharm', {
    source: 'feature', sourceName: 'Контрочарование', expires: { at: 'end', of: characterId, skip: entry?.is_current ? 1 : 0 },
  });
  return {
    message: `${row.name}: «Контрочарование» — до конца следующего хода спасброски от испуга и очарования в ${COUNTERCHARM_FEET} фт. — с преимуществом.`,
    float: 'контрочарование', economyScene: spent?.sceneId ?? null, heal: null,
  };
}

export const bardActions: Record<string, FeatureAction> = {
  'bardic-inspiration': bardicInspiration,
  'countercharm': countercharm,
};

function bardicInspirationView(look: FeatureLook): FeatureView {
  const { classes, row, unable, empty, bonusReason } = look;
  return {
    detail: `к${bardicDie(classLevelOf(classes, 'bard', row.level))}, кому — выбранная цель`,
    reason: unable ?? empty ?? bonusReason,
  };
}

function countercharmView(look: FeatureLook): FeatureView {
  const { state, unable, actionReason } = look;
  let active: boolean = false;
  let detail: string = '';
  let reason: string | null = null;
  active = state.codes.has('countercharm');
  detail = active ? `звучит: спасброски от испуга и очарования в ${COUNTERCHARM_FEET} фт. — с преимуществом` : `действием — до конца следующего хода, ${COUNTERCHARM_FEET} фт.`;
  reason = unable ?? actionReason;
  return { active, detail, reason };
}

function peerlessSkillView(look: FeatureLook): FeatureView {
  const { classes, row, empty } = look;
  return {
    detail: `к${bardicDie(classLevelOf(classes, 'bard', row.level))} к своей проверке — галочка в «Проверках»`,
    reason: empty,
  };
}

function cuttingWordsView(look: FeatureLook): FeatureView {
  const { row, classes, empty } = look;
  let active: boolean = false;
  let detail: string = '';
  let reason: string | null = null;
  active = (row.auto_reactions ?? []).includes('cutting-words');
  detail = `${active ? 'наготове' : 'не наготове'}: −к${bardicDie(classLevelOf(classes, 'bard', row.level))} к атаке врага в 60 фт. по своему`;
  reason = empty;
  return { active, detail, reason };
}

function jackOfAllTradesView(look: FeatureLook): FeatureView {
  const { row } = look;
  return {
    detail: `+${Math.floor(proficiencyBonusForLevel(Math.max(1, row.level ?? 1)) / 2)} к проверкам без владения и к инициативе`,
  };
}

function songOfRestView(look: FeatureLook): FeatureView {
  const { classes, row, unable } = look;
  return {
    detail: `+к${songOfRestDie(classLevelOf(classes, 'bard', row.level))} тем, кто тратит кости хитов на коротком отдыхе`,
    reason: unable,
  };
}

export const bardViews: Record<string, FeatureViewFn> = {
  'bardic-inspiration': bardicInspirationView,
  'countercharm': countercharmView,
  'peerless-skill': peerlessSkillView,
  'cutting-words': cuttingWordsView,
  'jack-of-all-trades': jackOfAllTradesView,
  'song-of-rest': songOfRestView,
};
