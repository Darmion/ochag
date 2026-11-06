import { conditionGuard as templateConditionGuard, spellModsOf } from '../../../../packages/domain/spells/spell-mods.ts';
import type { Queryable } from '../db.ts';
import { restoreOwnForm } from './shape-forms.ts';
import { vanishSummon } from './summons.ts';
import { CONDITION_LABELS, conditionState, type ConditionState } from '../../../../packages/domain/combat/conditions.ts';
import { NATURES_WARD_TYPES, PROTECTION_FROM_EVIL_TYPES, classFeaturesFor } from '../../../../packages/domain/character/class-features.ts';
import { creatureTypeFromText } from '../../../../packages/domain/spells/spell-targets.ts';
import { findMonster } from '../../../../packages/domain/world/bestiary.ts';
import { characterClassLevels } from '../../../../packages/domain/character/classes.ts';

export const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const;
export const ABILITY_SHORT: Record<string, string> = {
  strength: 'СИЛ', dexterity: 'ЛОВ', constitution: 'ТЕЛ', intelligence: 'ИНТ', wisdom: 'МДР', charisma: 'ХАР',
};
export const ABILITY_GENITIVE: Record<string, string> = {
  strength: 'Силы', dexterity: 'Ловкости', constitution: 'Телосложения',
  intelligence: 'Интеллекта', wisdom: 'Мудрости', charisma: 'Харизмы',
};

export type Notice = { title: string; detail: string; secret?: boolean; characterId?: string };

export function conditionLabel(code: string) {
  const exhaustion = /^exhaustion_([1-6])$/.exec(code);
  return exhaustion ? `истощение ${exhaustion[1]}` : CONDITION_LABELS[code] ?? code;
}

export async function loadEffects(q: Queryable, campaignId: string, characterId: string) {
  return (
    await q.query(
      `SELECT id, effect_code, parameters FROM character_effects
       WHERE campaign_id=$1 AND character_id=$2 AND active
       ORDER BY effect_code, id`,
      [campaignId, characterId],
    )
  ).rows as Array<{ id: string; effect_code: string; parameters: any }>;
}

export async function loadConditionState(q: Queryable, campaignId: string, characterId: string): Promise<ConditionState> {
  return conditionState((await loadEffects(q, campaignId, characterId)).map(effect => effect.effect_code));
}

type ConditionGuard = (q: Queryable, campaignId: string, characterId: string, code: string) => Promise<string | null>;
let conditionGuard: ConditionGuard | null = null;
export function setConditionGuard(guard: ConditionGuard) {
  conditionGuard = guard;
}

export async function hasFeature(q: Queryable, campaignId: string, characterId: string, id: string) {
  const row = (await q.query('SELECT level, class_name, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
  return Boolean(row) && classFeaturesFor(characterClassLevels(row).classes).some(feature => feature.id === id);
}

async function creatureTypeAt(q: Queryable, campaignId: string, characterId: string) {
  const row = (await q.query('SELECT kind, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
  if (!row) return null;
  const own = creatureTypeFromText(row.sheet_extra?.creatureType);
  if (own) return own;
  const monster = typeof row.sheet_extra?.srdMonster === 'string' ? findMonster(row.sheet_extra.srdMonster) : undefined;
  if (monster) return creatureTypeFromText(monster.type);
  return row.kind === 'character' ? 'humanoid' : null;
}

export async function conditionImmunity(q: Queryable, campaignId: string, characterId: string, code: string, sourceId: string | null = null): Promise<string | null> {
  if (code !== 'spell_mod') {
    const guard = templateConditionGuard(spellModsOf((await q.query(
      `SELECT id, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='spell_mod' AND parameters->>'kind'='defense'`,
      [campaignId, characterId],
    )).rows as Array<{ id: string; parameters: any }>), code);
    if (guard) return guard;
  }
  if (code === 'poisoned') {
    if (await hasFeature(q, campaignId, characterId, 'purity-of-body')) return 'чистота тела';
    return (await hasFeature(q, campaignId, characterId, 'natures-ward')) ? 'защита природы' : null;
  }
  if (code !== 'charmed' && code !== 'frightened') return null;
  if (sourceId && sourceId !== characterId) {
    const type = await creatureTypeAt(q, campaignId, sourceId);
    if (type && (PROTECTION_FROM_EVIL_TYPES as readonly string[]).includes(type)) {
      const guarded = (await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='protected_from_evil' AND active`, [campaignId, characterId])).rows[0];
      if (guarded) return 'защита от добра и зла';
      if (await hasFeature(q, campaignId, characterId, 'purity-of-spirit')) return 'чистота духа';
    }
    if (type && (NATURES_WARD_TYPES as readonly string[]).includes(type) && (await hasFeature(q, campaignId, characterId, 'natures-ward'))) return 'защита природы';
  }
  const codes = new Set(
    (
      await q.query(
        `SELECT effect_code FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('heroism', 'raging')`,
        [campaignId, characterId],
      )
    ).rows.map(row => row.effect_code as string),
  );
  if (code === 'frightened' && codes.has('heroism')) return 'героизм';
  if (codes.has('raging') && (await hasFeature(q, campaignId, characterId, 'mindless-rage'))) return 'бездумная ярость';
  return conditionGuard ? conditionGuard(q, campaignId, characterId, code) : null;
}

export async function suspendForRage(q: Queryable, campaignId: string, characterId: string): Promise<string[]> {
  return (
    await q.query(
      `UPDATE character_effects SET active=false, parameters = COALESCE(parameters, '{}'::jsonb) || '{"suspendedBy":"rage"}'::jsonb
       WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('charmed', 'frightened')
       RETURNING effect_code`,
      [campaignId, characterId],
    )
  ).rows.map(row => conditionLabel(row.effect_code));
}

export async function resumeAfterRage(q: Queryable, campaignId: string, characterId: string): Promise<string[]> {
  const raging = (await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='raging'`, [campaignId, characterId])).rows[0];
  if (raging) return [];
  const back = (
    await q.query(
      `UPDATE character_effects e SET active=true, parameters = e.parameters - 'suspendedBy'
       WHERE e.campaign_id=$1 AND e.character_id=$2 AND NOT e.active AND e.parameters->>'suspendedBy' = 'rage'
         AND NOT EXISTS (
           SELECT 1 FROM character_effects a
           WHERE a.campaign_id=e.campaign_id AND a.character_id=e.character_id AND a.effect_code=e.effect_code AND a.active
         )
       RETURNING e.effect_code`,
      [campaignId, characterId],
    )
  ).rows.map(row => conditionLabel(row.effect_code));
  await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND NOT active AND parameters->>'suspendedBy' = 'rage'`, [campaignId, characterId]);
  return back;
}

const GROUNDING = new Set(['prone', 'paralyzed', 'petrified', 'stunned', 'unconscious', 'restrained', 'grappled', 'incapacitated', 'dead']);
type FallHandler = (q: Queryable, campaignId: string, characterId: string, feet: number) => Promise<void>;
let fallHandler: FallHandler | null = null;
export function setFallHandler(handler: FallHandler) {
  fallHandler = handler;
}
async function fallFrom(q: Queryable, campaignId: string, characterId: string, removed: Array<{ effect_code?: string; parameters: any }>) {
  const height = Math.max(0, ...removed.filter(row => !row.effect_code || row.effect_code === 'flying' || row.effect_code === 'dragon_wings').map(row => Number(row.parameters?.height ?? 0)));
  if (height > 0 && fallHandler) await fallHandler(q, campaignId, characterId, height);
}

export async function addCondition(q: Queryable, campaignId: string, characterId: string, code: string, parameters: Record<string, unknown> = {}) {
  const sourceId = typeof parameters.sourceCharacterId === 'string' ? parameters.sourceCharacterId : null;
  if (await conditionImmunity(q, campaignId, characterId, code, sourceId)) return false;
  if (GROUNDING.has(code)) {
    const landed = (
      await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('flying', 'dragon_wings') RETURNING effect_code, parameters`, [campaignId, characterId])
    ).rows as Array<{ effect_code: string; parameters: any }>;
    if (landed.length) {
      await fallFrom(q, campaignId, characterId, landed);
      if (code !== 'prone') await addCondition(q, campaignId, characterId, 'prone', { source: 'fall', sourceName: 'Падение' });
    }
  }
  const existing = (
    await q.query(
      `SELECT id FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code=$3 AND active`,
      [campaignId, characterId, code],
    )
  ).rows[0];
  if (existing) {
    await q.query('UPDATE character_effects SET parameters=$2::jsonb WHERE id=$1', [existing.id, JSON.stringify(parameters)]);
    return false;
  }
  await q.query(
    `INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,$3,$4::jsonb)`,
    [campaignId, characterId, code, JSON.stringify(parameters)],
  );
  if (INCAPACITATING.has(code)) await releaseGrapples(q, campaignId, characterId);
  return true;
}

const INCAPACITATING = new Set(['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious', 'dead']);
export function incapacitates(code: string) {
  return INCAPACITATING.has(code);
}

export async function releaseGrapples(
  q: Queryable, campaignId: string, grapplerId: string, onlyIds?: string[],
): Promise<Array<{ id: string; name: string }>> {
  return (
    await q.query(
      `DELETE FROM character_effects e USING characters c
       WHERE e.campaign_id=$1 AND e.effect_code='grappled' AND e.active
         AND e.parameters->>'sourceCharacterId' = $2
         AND ($3::uuid[] IS NULL OR e.character_id = ANY($3::uuid[]))
         AND c.campaign_id = e.campaign_id AND c.id = e.character_id
       RETURNING c.id, c.name`,
      [campaignId, grapplerId, onlyIds ?? null],
    )
  ).rows as Array<{ id: string; name: string }>;
}

export function releaseNotices(grapplerName: string, freed: Array<{ id: string; name: string }>, why: string): Notice[] {
  return freed.map(entry => ({ title: `${entry.name} больше не схвачен`, detail: `${grapplerName} ${why} — захват кончился.`, characterId: entry.id }));
}

export async function addExhaustion(q: Queryable, campaignId: string, characterId: string, levels = 1) {
  const current = (
    await q.query(`SELECT effect_code FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code LIKE 'exhaustion\\_%'`, [campaignId, characterId])
  ).rows.reduce((top, row) => Math.max(top, Number(String(row.effect_code).split('_')[1] ?? 0)), 0);
  const next = Math.min(6, current + levels);
  await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code LIKE 'exhaustion\\_%'`, [campaignId, characterId]);
  await q.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,$3,'{"source":"frenzy"}')`, [campaignId, characterId, `exhaustion_${next}`]);
  return next;
}

async function lethargy(q: Queryable, campaignId: string, characterId: string) {
  const current = (await q.query('SELECT 1 FROM initiative_entries WHERE campaign_id=$1 AND character_id=$2 AND is_current LIMIT 1', [campaignId, characterId])).rows[0];
  await addCondition(q, campaignId, characterId, 'lethargic', { source: 'spell', sourceName: 'Ускорение', expires: { at: 'end', of: characterId, skip: current ? 1 : 0 } });
}

export async function removeCondition(q: Queryable, campaignId: string, characterId: string, code: string, source?: string) {
  const result = await q.query(
    `DELETE FROM character_effects
     WHERE campaign_id=$1 AND character_id=$2 AND effect_code=$3 AND active
       AND ($4::text IS NULL OR parameters->>'source' = $4)
     RETURNING id, parameters`,
    [campaignId, characterId, code, source ?? null],
  );
  if (code === 'raging' && result.rows.some(row => row.parameters?.frenzy === true)) await addExhaustion(q, campaignId, characterId);
  if (code === 'raging' && result.rows.length) await resumeAfterRage(q, campaignId, characterId);
  if (code === 'wild_shape') for (const row of result.rows) await restoreOwnForm(q, campaignId, characterId, row.parameters);
  if (code === 'hasted' && result.rows.length) await lethargy(q, campaignId, characterId);
  // Ending concentration also removes the spell's persistent zone, otherwise Spike Growth kept hurting.
  if (code === 'concentration' && result.rows.length) {
    await q.query('DELETE FROM scene_triggers WHERE campaign_id=$1 AND caster_id=$2', [campaignId, characterId]);
    const held = (
      await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND active AND parameters->>'concentrationOf' = $2 RETURNING character_id, effect_code, parameters`, [campaignId, characterId])
    ).rows as Array<{ character_id: string; effect_code: string; parameters: any }>;
    for (const row of held.filter(entry => entry.effect_code === 'flying')) await fallFrom(q, campaignId, row.character_id, [row]);
    for (const row of held.filter(entry => entry.effect_code === 'wild_shape')) await restoreOwnForm(q, campaignId, row.character_id, row.parameters);
    for (const row of held.filter(entry => entry.effect_code === 'summoned')) await vanishSummon(q, campaignId, row.character_id);
    for (const row of held.filter(entry => entry.effect_code === 'hasted')) await lethargy(q, campaignId, row.character_id);
  }
  return result.rows.length;
}
