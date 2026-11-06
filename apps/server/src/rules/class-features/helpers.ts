import type { Queryable } from '../../db.ts';
import { conditionLabel, loadEffects, addCondition } from '../conditions.ts';
import { objectSchema, uuid, reject } from '../../tabletop/scene-feature.ts';
import { characterClassLevels, type ClassLevel, CLASS_LABELS } from '../../../../../packages/domain/character/classes.ts';
import { type ClassFeature, classFeaturesFor, CLASS_FEATURE_LIST } from '../../../../../packages/domain/character/class-features.ts';
import { proficiencyBonusForLevel, abilityModifier } from '../../../../../packages/domain/dice/dice.ts';
import { conditionState } from '../../../../../packages/domain/combat/conditions.ts';
import { findSrdSpell, srdSpellName } from '../srd-data.ts';

import { CHARACTER_COLUMNS, type ClassFeatureContext, classResourceOf, HARMFUL_SPELL_EFFECTS, spendClassResource } from '../class-features.ts';

export const characterParams = objectSchema({ campaignId: uuid, characterId: uuid });

export async function loadActor(ctx: ClassFeatureContext, q: Queryable, campaignId: string, characterId: string, userId: string, lock = false) {
  const { canManageCharacter, membership } = ctx;
  const member = await membership(q, campaignId, userId, true);
  const row = (await q.query(`SELECT ${CHARACTER_COLUMNS} FROM characters WHERE campaign_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [campaignId, characterId])).rows[0] as any;
  if (!row || row.kind === 'object') reject(404, 'Существо не найдено.');
  if (!(await canManageCharacter(q, member, userId, row.owner_user_id, row.id))) reject(403, 'Умениями пользуется тот, чьё это существо, или мастер.');
  const classes = characterClassLevels(row).classes;
  return { member, row, classes, classId: classes[0]?.id ?? null };
}

export async function spellsOf(q: Queryable, campaignId: string, characterId: string): Promise<Array<{ id: string; name: string; level: number }>> {
  const rows = (
    await q.query(
      `SELECT cs.id, cs.source, cs.srd_index, cp.name AS custom_name, cp.level AS custom_level
         FROM character_spells cs
         LEFT JOIN campaign_spells cp ON cp.campaign_id = cs.campaign_id AND cp.id = cs.custom_spell_id
         WHERE cs.campaign_id=$1 AND cs.character_id=$2`,
      [campaignId, characterId],
    )
  ).rows as any[];
  return rows.map(row => {
    if (row.source !== 'srd') return { id: row.id, name: String(row.custom_name ?? 'заклинание'), level: Number(row.custom_level ?? -1) };
    const spell = findSrdSpell(row.srd_index);
    return { id: row.id, name: srdSpellName(row.srd_index), level: Number(spell?.level ?? -1) };
  }).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'ru'));
}

export async function cleansable(q: Queryable, campaignId: string, targetId: string) {
  const effects = (
    await q.query(
      `SELECT id, effect_code, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND parameters ? 'spellLevel'
         ORDER BY (parameters->>'spellLevel')::int DESC NULLS LAST, id`,
      [campaignId, targetId],
    )
  ).rows as Array<{ id: string; effect_code: string; parameters: any }>;
  const keyOf = (effect: { effect_code: string; parameters: any }) => `${effect.parameters?.sourceName ?? effect.effect_code}|${effect.parameters?.sourceCharacterId ?? ''}`;
  const spells = new Map<string, { key: string; name: string; level: number; harmful: boolean; effects: typeof effects }>();
  for (const effect of effects) {
    const key = keyOf(effect);
    const known = spells.get(key);
    if (known) {
      known.effects.push(effect);
      known.harmful ||= HARMFUL_SPELL_EFFECTS.has(effect.effect_code);
      continue;
    }
    spells.set(key, {
      key, name: String(effect.parameters?.sourceName ?? conditionLabel(effect.effect_code)), level: Number(effect.parameters?.spellLevel ?? 0),
      harmful: HARMFUL_SPELL_EFFECTS.has(effect.effect_code), effects: [effect],
    });
  }
  return [...spells.values()].sort((a, b) => Number(b.harmful) - Number(a.harmful) || b.level - a.level);
}

export async function entryOf(q: Queryable, campaignId: string, characterId: string, sceneId?: string | null) {
  return (
    await q.query(
      `SELECT id, scene_id, is_current, action_used, bonus_used, sneak_attack_used, action_surged, attacks_made, turn_flags
         FROM initiative_entries
         WHERE campaign_id=$1 AND character_id=$2 AND ($3::uuid IS NULL OR scene_id=$3)
         ORDER BY is_current DESC, created_at LIMIT 1`,
      [campaignId, characterId, sceneId ?? null],
    )
  ).rows[0] as {
    id: string; scene_id: string; is_current: boolean; action_used: boolean; bonus_used: boolean; sneak_attack_used: boolean; action_surged: boolean; attacks_made: number;
    turn_flags: string[];
  } | undefined;
}

export const resourceOf = classResourceOf;
export const spendResource = spendClassResource;

export function clericDc(row: any) {
  return row.spell_save_dc_override ?? 8 + proficiencyBonusForLevel(Math.max(1, row.level ?? 1)) + abilityModifier(row.wisdom);
}
export function paladinDc(row: any) {
  return row.spell_save_dc_override ?? 8 + proficiencyBonusForLevel(Math.max(1, row.level ?? 1)) + abilityModifier(row.charisma);
}

export async function openHand(
  ctx: ClassFeatureContext, q: Queryable, campaignId: string, userId: string, monk: { id: string; name: string; current: boolean; dc: number }, targetId: string, sceneId: string | null,
  technique: 'prone' | 'push' | 'no-reactions',
) {
  const target = (await q.query('SELECT id, name FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0] as any;
  if (!target) return null;
  const codes = conditionState((await loadEffects(q, campaignId, targetId)).map(effect => effect.effect_code)).codes;
  const how = technique === 'prone' && codes.has('prone') ? 'no-reactions' : technique;
  const save = async (ability: string, ru: string) => (ctx.rollSaveAgainst
    ? ctx.rollSaveAgainst(q, campaignId, userId, targetId, ability, monk.dc, `Спасбросок ${ru} (СЛ ${monk.dc}) против «Техники открытой ладони» — ${target.name}`.slice(0, 100), false, { condition: ability === 'dexterity' ? 'prone' : null })
    : null);
  if (how === 'prone') {
    const result = await save('dexterity', 'ЛОВ');
    if (result && !result.success) await addCondition(q, campaignId, targetId, 'prone', { source: 'feature', sourceCharacterId: monk.id, sourceName: 'Техника открытой ладони' });
    return result?.success ? `«${target.name}» устоял на ногах` : `«${target.name}» сбит с ног`;
  }
  if (how === 'push') {
    const result = await save('strength', 'СИЛ');
    const moved = result && !result.success && sceneId && ctx.pushAway ? await ctx.pushAway(q, campaignId, sceneId, monk.id, targetId, 15) : 0;
    return result?.success ? `«${target.name}» устоял` : moved ? `«${target.name}» отброшен на ${moved} фт.` : `«${target.name}» — отбросить некуда`;
  }
  await addCondition(q, campaignId, targetId, 'no_reactions', {
    source: 'feature', sourceCharacterId: monk.id, sourceName: 'Техника открытой ладони', expires: { at: 'end', of: monk.id, skip: monk.current ? 1 : 0 },
  });
  return `«${target.name}» без реакций до конца следующего хода «${monk.name}»`;
}

export function requireFeature(row: any, classes: ClassLevel[], id: ClassFeature['id']) {
  const feature = classFeaturesFor(classes).find(entry => entry.id === id);
  if (feature) return feature;
  const known = CLASS_FEATURE_LIST.find(entry => entry.id === id)!;
  reject(400, `«${known.name}» — умение класса «${CLASS_LABELS[known.classId]}» с ${known.level}-го уровня; у «${row.name}» его нет.`);
}

export async function preserveCandidates(ctx: ClassFeatureContext, q: Queryable, campaignId: string, row: any, sceneId: string | null) {
  const near = sceneId && ctx.creaturesNear ? await ctx.creaturesNear(q, campaignId, sceneId, row.id, 30) : [];
  const ids = [row.id, ...near.map(entry => entry.id)];
  const rows = (await q.query('SELECT id, name, kind, hp_current, hp_max FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, ids])).rows as any[];
  const list: Array<{ id: string; name: string; current: number; max: number; room: number }> = [];
  for (const id of ids) {
    const entry = rows.find(item => item.id === id);
    if (!entry || entry.kind === 'object') continue;
    const type = ctx.creatureType ? await ctx.creatureType(q, campaignId, id) : null;
    if (type === 'undead' || type === 'construct') continue;
    if (conditionState((await loadEffects(q, campaignId, id)).map(effect => effect.effect_code)).codes.has('dead')) continue;
    const room = Math.max(0, Math.floor(Number(entry.hp_max) / 2) - Number(entry.hp_current));
    list.push({ id, name: entry.name, current: Number(entry.hp_current), max: Number(entry.hp_max), room });
  }
  return list;
}
