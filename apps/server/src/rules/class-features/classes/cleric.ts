import { addCondition, loadEffects } from '../../conditions.ts';
import { reject } from '../../../tabletop/scene-feature.ts';
import { sceneOfCreature } from '../../class-features.ts';
import { spendResource, entryOf, preserveCandidates, clericDc } from '../helpers.ts';
import { classLevelOf, preserveLifeProblem, destroyUndeadCr, divineInterventionBlock, divineStrikeDice } from '../../../../../../packages/domain/character/class-features.ts';
import { conditionState } from '../../../../../../packages/domain/combat/conditions.ts';
import type { FeatureAction, FeatureResult, FeatureUse } from './types.ts';
import type { FeatureLook, FeatureView, FeatureViewFn } from './types.ts';

async function preserveLife(use: FeatureUse): Promise<FeatureResult> {
  const { q, campaignId, characterId, sceneId, row, request, classes, enforce, userId, healed } = use;
  const { actionEconomy, applyHpChange } = use.ctx;
  const ctx = use.ctx;
  const entry = await entryOf(q, campaignId, characterId, sceneId);
  const where = await sceneOfCreature(q, campaignId, characterId, sceneId ?? entry?.scene_id);
  const candidates = await preserveCandidates(ctx, q, campaignId, row, where);
  const heals = (request.body?.heals ?? []).map(item => {
    const found = candidates.find(candidate => candidate.id === item.targetId);
    if (!found) reject(400, 'Лечить — себя и существ в 30 футах (не нежить и не конструктов).');
    return { ...found, amount: item.amount };
  });
  if (new Set(heals.map(item => item.id)).size !== heals.length) reject(400, 'Каждое существо — один раз.');
  const problem = preserveLifeProblem(classLevelOf(classes, 'cleric', row.level), heals);
  if (problem) reject(400, `«Сохранение жизни»: ${problem}.`);
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId: where });
  await spendResource(q, campaignId, row, 'Божественный канал');
  const parts: string[] = [];
  for (const item of heals) {
    const change = await applyHpChange(q, campaignId, userId, item.id, { mode: 'heal', amount: item.amount, damageType: null, critical: false });
    healed.push({ characterId: item.id, change });
    parts.push(`«${item.name}» +${change.applied}`);
  }
  return { message: `${row.name}: «Сохранение жизни» — ${parts.join(', ')}.`, float: 'сохранение жизни', economyScene: spent?.sceneId ?? where, heal: null };
}

async function turnUndead(use: FeatureUse): Promise<FeatureResult> {
  const { q, campaignId, characterId, sceneId, enforce, row, classes, userId, changed } = use;
  const { actionEconomy, applyHpChange } = use.ctx;
  const ctx = use.ctx;
  const entry = await entryOf(q, campaignId, characterId, sceneId);
  const where = sceneId ?? entry?.scene_id ?? null;
  if (!where || !ctx.creaturesNear || !ctx.isUndead || !ctx.rollSaveAgainst) reject(400, 'Изгнание нежити — на сцене: выберите сцену.');
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId: where });
  await spendResource(q, campaignId, row, 'Божественный канал');
  const dc = clericDc(row);
  const destroyUpTo = destroyUndeadCr(classLevelOf(classes, 'cleric', row.level));
  const parts: string[] = [];
  for (const near of await ctx.creaturesNear(q, campaignId, where, characterId, 30)) {
    if (!(await ctx.isUndead(q, campaignId, near.id))) continue;
    const state = conditionState((await loadEffects(q, campaignId, near.id)).map(effect => effect.effect_code));
    if (state.codes.has('dead')) continue;
    const save = await ctx.rollSaveAgainst(q, campaignId, userId, near.id, 'wisdom', dc, `Спасбросок МДР (СЛ ${dc}) против «Изгнания нежити» — ${near.name}`, false, { condition: 'turned', magic: true });
    if (save.success) {
      parts.push(`${near.name} устоял (${save.total})`);
      continue;
    }
    const victim = (await q.query('SELECT hp_current, hp_temp, challenge_rating::float8 AS cr FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, near.id])).rows[0] as any;
    if (destroyUpTo !== null && victim?.cr !== null && victim?.cr !== undefined && Number(victim.cr) <= destroyUpTo) {
      const change = await applyHpChange(q, campaignId, userId, near.id, { mode: 'damage', amount: Number(victim.hp_current) + Number(victim.hp_temp ?? 0), damageType: null, critical: false });
      changed.push({ characterId: near.id, change });
      parts.push(`${near.name} уничтожен`);
      continue;
    }
    await addCondition(q, campaignId, near.id, 'turned', {
      source: 'feature', sourceCharacterId: characterId, sourceName: row.name, remainingRounds: 10, durationRounds: 10, endsOnDamage: true,
    });
    changed.push({ characterId: near.id, change: null as any });
    parts.push(`${near.name} изгнан (${save.total})`);
  }
  return {
    message: `${row.name}: «Изгнание нежити» (СЛ ${dc}) — ${parts.length ? parts.join(', ') : 'нежити в 30 футах нет'}.`,
    float: 'изгнание нежити', economyScene: spent?.sceneId ?? where, heal: null,
  };
}

async function divineIntervention(use: FeatureUse): Promise<FeatureResult> {
  const { q, campaignId, characterId, row, enforce, sceneId, classes, userId } = use;
  const { actionEconomy, rollDie, insertRoll, notifyCampaign } = use.ctx;
  const clock = (
    await q.query('SELECT w.world_minutes, c.long_rest_at FROM campaigns w JOIN characters c ON c.campaign_id = w.id WHERE w.id=$1 AND c.id=$2', [campaignId, characterId])
  ).rows[0] as any;
  const now = Number(clock?.world_minutes ?? 0);
  const block = divineInterventionBlock(row.sheet_extra?.divineIntervention ?? null, now, clock?.long_rest_at === null || clock?.long_rest_at === undefined ? null : Number(clock.long_rest_at));
  if (block) reject(400, `${row.name}: ${block}.`);
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId });
  const clericLevel = classLevelOf(classes, 'cleric', row.level);
  const die = rollDie(100);
  const success = clericLevel >= 20 || die <= clericLevel;
  await insertRoll(
    q, campaignId, userId, characterId, `Божественное вмешательство — ${row.name}`.slice(0, 100), '1d100', [die], 0, die, false, null,
    { kind: 'divine-intervention', success, dc: clericLevel },
  );
  await q.query(
    `UPDATE characters SET sheet_extra = jsonb_set(COALESCE(sheet_extra, '{}'::jsonb), '{divineIntervention}', $3::jsonb), revision=revision+1 WHERE campaign_id=$1 AND id=$2`,
    [campaignId, characterId, JSON.stringify({ at: now, success })],
  );
  const message = success
    ? `${row.name}: «Божественное вмешательство» — божество отвечает (к100 = ${die}${clericLevel >= 20 ? '' : ` ≤ ${clericLevel}`}). Как оно вмешается — решает мастер; снова — через 7 дней.`
    : `${row.name}: «Божественное вмешательство» — мольба не услышана (к100 = ${die} > ${clericLevel}); снова — после долгого отдыха.`;
  void notifyCampaign(campaignId, { type: 'notice', title: 'Божественное вмешательство', detail: message, tone: success ? 'crit' : 'info' });
  void notifyCampaign(campaignId, { type: 'rolls' });
  return { message, float: success ? 'божество отвечает' : null, economyScene: spent?.sceneId ?? null, heal: null };
}

export const clericActions: Record<string, FeatureAction> = {
  'preserve-life': preserveLife,
  'turn-undead': turnUndead,
  'divine-intervention': divineIntervention,
};

function blessedHealerView(): FeatureView {
  return { detail: 'лечите другого заклинанием — сами +2 + уровень ячейки' };
}

function turnUndeadView(look: FeatureLook): FeatureView {
  const { classes, row, unable, empty, actionReason } = look;
  const cr = destroyUndeadCr(classLevelOf(classes, 'cleric', row.level));
  return {
    detail: `СЛ ${clericDc(row)}${cr !== null ? `; уничтожает нежить до опасности ${cr === 0.5 ? '1/2' : cr}` : ''}`,
    reason: unable ?? empty ?? actionReason,
  };
}

function discipleOfLifeView(): FeatureView {
  return { detail: '+2 + уровень ячейки к лечению заклинаниями' };
}

async function preserveLifeView(look: FeatureLook): Promise<FeatureView> {
  const { classes, row, q, campaignId, characterId, request, entry, unable, empty, actionReason } = look;
  const ctx = look.ctx;
  const pool = 5 * classLevelOf(classes, 'cleric', row.level);
  const where = await sceneOfCreature(q, campaignId, characterId, request.query.sceneId ?? entry?.scene_id);
  const candidates = (await preserveCandidates(ctx, q, campaignId, row, where)).filter(item => item.room > 0);
  return {
    choices: candidates.map(item => ({ value: item.id, label: `${item.name} (${item.current}/${item.max})`, count: item.room })),
    limit: pool,
    detail: `запас ${pool}; каждому — до половины максимума`,
    reason: unable ?? empty ?? actionReason ?? (candidates.length ? null : 'в 30 футах некого — у всех половина хитов и больше'),
  };
}

async function divineInterventionView(look: FeatureLook): Promise<FeatureView> {
  const { classes, row, q, campaignId, characterId, unable, actionReason } = look;
  const clericLevel = classLevelOf(classes, 'cleric', row.level);
  const clock = (
    await q.query('SELECT w.world_minutes, c.long_rest_at FROM campaigns w JOIN characters c ON c.campaign_id = w.id WHERE w.id=$1 AND c.id=$2', [campaignId, characterId])
  ).rows[0] as any;
  const block = divineInterventionBlock(row.sheet_extra?.divineIntervention ?? null, Number(clock?.world_minutes ?? 0), clock?.long_rest_at === null || clock?.long_rest_at === undefined ? null : Number(clock.long_rest_at));
  return {
    detail: clericLevel >= 20 ? 'божество отвечает всегда' : `к100 не больше ${clericLevel}`,
    reason: unable ?? block ?? actionReason,
  };
}

function supremeHealingView(): FeatureView {
  return { detail: 'кости лечения заклинаний — наибольшие' };
}

function divineStrikeView(look: FeatureLook): FeatureView {
  const { classes, row, entry } = look;
  return {
    detail: `+${divineStrikeDice(classLevelOf(classes, 'cleric', row.level))}d8 излучением при попадании оружием, раз в свой ход`,
    reason: (entry?.turn_flags ?? []).includes('divine-strike') ? 'в этот ход уже был' : null,
  };
}

export const clericViews: Record<string, FeatureViewFn> = {
  'blessed-healer': blessedHealerView,
  'turn-undead': turnUndeadView,
  'disciple-of-life': discipleOfLifeView,
  'preserve-life': preserveLifeView,
  'divine-intervention': divineInterventionView,
  'supreme-healing': supremeHealingView,
  'divine-strike': divineStrikeView,
};
