import { removeCondition, addCondition } from '../../conditions.ts';
import { reject } from '../../../tabletop/scene-feature.ts';
import { spendResource, resourceOf } from '../helpers.ts';
import { FLEXIBLE_CASTING_COST, DRACONIC_PRESENCE_COST, DRACONIC_PRESENCE_ROUNDS, DRACONIC_PRESENCE_FEET, knownAncestry, knownMetamagic, METAMAGIC } from '../../../../../../packages/domain/character/class-features.ts';
import { abilityModifier, proficiencyBonusForLevel } from '../../../../../../packages/domain/dice/dice.ts';
import type { FeatureAction, FeatureResult, FeatureUse } from './types.ts';
import { DRAGON_ANCESTRIES } from '../../../../../../packages/domain/srd/heroes.ts';
import { ANCESTRY_DAMAGE_RU } from '../../class-features.ts';
import type { FeatureLook, FeatureView, FeatureViewFn, FeatureChoice } from './types.ts';

async function dragonWings(use: FeatureUse): Promise<FeatureResult> {
  const { q, campaignId, characterId, enforce, sceneId, state, row } = use;
  const { actionEconomy } = use.ctx;
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'bonus', { kind: 'other' }, { enforce, sceneId });
  if (state.codes.has('dragon_wings')) {
    await removeCondition(q, campaignId, characterId, 'dragon_wings');
    return { message: `${row.name} складывает драконьи крылья.`, float: 'крылья сложены', economyScene: spent?.sceneId ?? null, heal: null };
  }
  await addCondition(q, campaignId, characterId, 'dragon_wings', { source: 'feature', sourceName: 'Драконьи крылья' });
  return {
    message: `${row.name} раскрывает драконьи крылья: скорость полёта — как обычная; местность и ямы не мешают.`,
    float: 'крылья!', economyScene: spent?.sceneId ?? null, heal: null,
  };
}

async function flexibleCasting(use: FeatureUse): Promise<FeatureResult> {
  const { request, q, campaignId, characterId, row, enforce, sceneId } = use;
  const { actionEconomy } = use.ctx;
  const mode = request.body?.mode;
  const level = Number(request.body?.slotLevel ?? 0);
  if ((mode !== 'to-points' && mode !== 'to-slot') || !level) reject(400, 'Что во что: ячейку в очки или очки в ячейку — и уровень ячейки.');
  const slot = (await q.query('SELECT current, max FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 AND level=$3 FOR UPDATE', [campaignId, characterId, level])).rows[0] as any;
  if (!slot || Number(slot.max) <= 0) reject(400, `Ячеек ${level}-го уровня у ${row.name} нет.`);
  const points = await resourceOf(q, campaignId, row, 'Очки чародейства', true);
  if (!points) reject(400, `В листе «${row.name}» нет очков чародейства.`);
  if (mode === 'to-points') {
    if (Number(slot.current) <= 0) reject(400, `Ячейки ${level}-го уровня потрачены.`);
    if (Number(points.current) >= Number(points.max)) reject(400, 'Очков чародейства и так полный запас.');
  } else {
    const cost = FLEXIBLE_CASTING_COST[level];
    if (!cost) reject(400, 'Создать можно ячейку не выше 5-го уровня.');
    if (Number(points.current) < cost) reject(400, `На ячейку ${level}-го уровня нужно ${cost} очков, есть ${points.current}.`);
  }
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'bonus', { kind: 'other' }, { enforce, sceneId });
  if (mode === 'to-points') {
    const gained = Math.min(level, Number(points.max) - Number(points.current));
    await q.query('UPDATE character_spell_slots SET current=current-1 WHERE campaign_id=$1 AND character_id=$2 AND level=$3', [campaignId, characterId, level]);
    await q.query('UPDATE character_resources SET current=current+$2 WHERE id=$1', [points.id, gained]);
    return { message: `${row.name}: ячейка ${level}-го уровня → ${gained} очк. чародейства (${Number(points.current) + gained}/${points.max}).`, float: `+${gained} очк.`, economyScene: spent?.sceneId ?? null, heal: null };
  }
  const cost = FLEXIBLE_CASTING_COST[level]!;
  await q.query('UPDATE character_resources SET current=current-$2 WHERE id=$1', [points.id, cost]);
  await q.query('UPDATE character_spell_slots SET current=current+1 WHERE campaign_id=$1 AND character_id=$2 AND level=$3', [campaignId, characterId, level]);
  return { message: `${row.name}: ${cost} очк. чародейства → ячейка ${level}-го уровня (${Number(slot.current) + 1}/${slot.max}).`, float: `ячейка ${level}`, economyScene: spent?.sceneId ?? null, heal: null };
}

async function draconicPresence(use: FeatureUse): Promise<FeatureResult> {
  const { request, state, row, q, campaignId, characterId, enforce, sceneId } = use;
  const { actionEconomy } = use.ctx;
  const mode = request.body?.mode === 'charm' ? 'charm' : 'fear';
  if (state.codes.has('draconic_presence')) reject(400, `${row.name}: «Драконье присутствие» уже держится.`);
  const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId });
  await spendResource(q, campaignId, row, 'Очки чародейства', DRACONIC_PRESENCE_COST);
  await removeCondition(q, campaignId, characterId, 'concentration');
  await addCondition(q, campaignId, characterId, 'concentration', { source: 'feature', spellName: 'Драконье присутствие' });
  const dc = row.spell_save_dc_override ?? 8 + proficiencyBonusForLevel(Math.max(1, row.level ?? 1)) + abilityModifier(row.charisma);
  await addCondition(q, campaignId, characterId, 'draconic_presence', {
    source: 'feature', sourceName: 'Драконье присутствие', mode, dc, concentrationOf: characterId,
    remainingRounds: DRACONIC_PRESENCE_ROUNDS, durationRounds: DRACONIC_PRESENCE_ROUNDS,
  });
  return {
    message: `${row.name}: «Драконье присутствие» — аура ${mode === 'charm' ? 'очарования' : 'страха'} на ${DRACONIC_PRESENCE_FEET} фт. (СЛ ${dc}, концентрация, минута).`,
    float: mode === 'charm' ? 'аура очарования' : 'аура страха', economyScene: spent?.sceneId ?? null, heal: null,
  };
}

export const sorcererActions: Record<string, FeatureAction> = {
  'dragon-wings': dragonWings,
  'flexible-casting': flexibleCasting,
  'draconic-presence': draconicPresence,
};

async function flexibleCastingView(look: FeatureLook): Promise<FeatureView> {
  const { q, campaignId, characterId, resource, unable, bonusReason } = look;
  const slots = (await q.query('SELECT level, current, max FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 AND max > 0 ORDER BY level', [campaignId, characterId])).rows as any[];
  return {
    choices: slots.map(slot => ({ value: String(slot.level), label: `${slot.level} ур.`, count: Number(slot.current), ...(FLEXIBLE_CASTING_COST[Number(slot.level)] ? { hint: `${FLEXIBLE_CASTING_COST[Number(slot.level)]} очк.` } : {}) })),
    detail: `очков ${resource?.current ?? 0}/${resource?.max ?? 0}; ячейка в очки или очки в ячейку`,
    reason: unable ?? bonusReason,
  };
}

function draconicPresenceView(look: FeatureLook): FeatureView {
  const { state, unable, resource, actionReason } = look;
  let active: boolean = false;
  let detail: string = '';
  let reason: string | null = null;
  active = state.codes.has('draconic_presence');
  detail = active ? 'аура держится (концентрация)' : `${DRACONIC_PRESENCE_COST} очков: аура страха или очарования на ${DRACONIC_PRESENCE_FEET} фт.`;
  reason = active ? 'уже держится' : unable ?? (resource && resource.current < DRACONIC_PRESENCE_COST ? `нужно ${DRACONIC_PRESENCE_COST} очков` : null) ?? actionReason;
  return { active, detail, reason };
}

function dragonWingsView(look: FeatureLook): FeatureView {
  const { state, unable, bonusReason } = look;
  let active: boolean = false;
  let detail: string = '';
  let reason: string | null = null;
  active = state.codes.has('dragon_wings');
  detail = active ? 'крылья раскрыты: местность и ямы-ловушки не мешают' : 'бонусным — раскрыть крылья';
  reason = unable ?? bonusReason;
  return { active, detail, reason };
}

function elementalAffinityView(look: FeatureLook): FeatureView {
  const { row } = look;
  let choices: FeatureChoice[] | null = null;
  let detail: string = '';
  const known = knownAncestry(row.sheet_extra);
  choices = DRAGON_ANCESTRIES.map(item => ({ value: item.id, label: `${item.nameRu} (${ANCESTRY_DAMAGE_RU[item.damage] ?? item.damage})`, ...(known.includes(item.id) ? { active: true } : {}) }));
  const pick = DRAGON_ANCESTRIES.find(item => item.id === known[0]);
  detail = pick ? `+${Math.max(0, abilityModifier(row.charisma))} к урону — ${ANCESTRY_DAMAGE_RU[pick.damage] ?? pick.damage}` : 'предок не выбран';
  return { choices, detail };
}

function sorcerousRestorationView(): FeatureView {
  return { detail: 'короткий отдых: +4 очка чародейства' };
}

function draconicResilienceView(look: FeatureLook): FeatureView {
  const { row } = look;
  return { detail: `без доспехов КД ${13 + abilityModifier(Number(row.dexterity ?? 10))}; +1 хит за уровень чародея` };
}

function metamagicView(look: FeatureLook): FeatureView {
  const { row } = look;
  const known = knownMetamagic(row.sheet_extra);
  return {
    choices: METAMAGIC.map(entry => ({ value: entry.id, label: entry.nameRu, ...(known.includes(entry.id) ? { active: true } : {}) })),
    detail: known.length ? `${METAMAGIC.filter(entry => known.includes(entry.id)).map(entry => entry.nameRu).join(', ')} — в окне сотворения` : 'не отмечена',
  };
}

export const sorcererViews: Record<string, FeatureViewFn> = {
  'flexible-casting': flexibleCastingView,
  'draconic-presence': draconicPresenceView,
  'dragon-wings': dragonWingsView,
  'elemental-affinity': elementalAffinityView,
  'sorcerous-restoration': sorcerousRestorationView,
  'draconic-resilience': draconicResilienceView,
  'metamagic': metamagicView,
};
