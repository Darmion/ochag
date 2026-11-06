import type { Queryable } from '../../db.ts';
import { wildShapeBeasts } from '../../rules/class-features.ts';
import { classFeaturesFor, classLevelOf, HOLY_NIMBUS_FEET, DRACONIC_PRESENCE_FEET, DRACONIC_PRESENCE_COST, INTIMIDATING_PRESENCE_FEET } from '../../../../../packages/domain/character/class-features.ts';
import { reachablePositions, positionOf, centerOf } from '../../../../../packages/domain/map/pathfinding.ts';
import { deadCreatures } from '../combat/loot-routes.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { placementFactions, placementsHostile } from '../../campaign/factions.ts';
import { findMonster } from '../../../../../packages/domain/world/bestiary.ts';
import { type MultiattackRoutine, multiattackText, multiattackRoutines } from '../../../../../packages/domain/combat/multiattack.ts';
import { loadConditionState } from '../../rules/conditions.ts';
import { incapacitatedReason } from '../../../../../packages/domain/combat/conditions.ts';
import { occupiedCells } from '../../../../../packages/domain/map/footprint.ts';

import { INITIATIVE_ORDER } from '../combat/initiative.ts';
import { detectOpportunities } from '../combat/opportunity.ts';
import type { TableContext } from '../context.ts';
import { feetBetween, getScene } from '../scene/board.ts';
import { creatureCells, flySpeedFrom, movementRules, movementState, releaseDistantGrapples, spendMovement } from '../scene/movement.ts';
import { loadPlacements } from '../scene/placements.ts';
import type { Placement } from '../shared.ts';

export async function npcFeatures(ctx: TableContext, campaignId: string, sceneId: string, characterId: string) {
  const { db } = ctx;
  const row = (await db.query('SELECT id, level, class_name, sheet_extra, hp_current, hp_max FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
  const classes = row ? characterClassLevels(row).classes : [];
  const features = new Set(classFeaturesFor(classes).map(feature => feature.id));
  const resources = new Map(
    (await db.query('SELECT name, current FROM character_resources WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId])).rows.map(entry => [entry.name as string, Number(entry.current)]),
  );
  const entry = (await db.query('SELECT action_surged FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3', [campaignId, sceneId, characterId])).rows[0];
  const effects = new Set((await db.query(`SELECT effect_code FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active`, [campaignId, characterId])).rows.map(entry => entry.effect_code as string));
  const left = (name: string) => resources.has(name) ? resources.get(name)! > 0 : true;
  const need: Record<string, string> = { rage: 'Ярость', 'second-wind': 'Второе дыхание', 'action-surge': 'Всплеск действий', 'flurry-of-blows': 'Ци' };
  return {
    has: (id: string) => features.has(id as any) && (!need[id] || left(need[id]!)) && !(id === 'action-surge' && entry?.action_surged),
    raging: effects.has('raging'), hp: Number(row?.hp_current ?? 0), hpMax: Math.max(1, Number(row?.hp_max ?? 1)),
  };
}

export async function cunningRetreat(ctx: TableContext, campaignId: string, sceneId: string, userId: string, characterId: string, entryId: string, headers: Record<string, string>) {
  const { app, db, triggers } = ctx;
  const placements = await loadPlacements(db, campaignId, sceneId);
  const scene = await getScene(db, campaignId, sceneId, false);
  const self = placements.find(entry => entry.character_id === characterId && !entry.parent_object_id);
  if (!self || !placementFactions(self).length) return null;
  const foes = placements.filter(entry => !entry.parent_object_id && placementsHostile(entry, self));
  const fallen = await deadCreatures(db, campaignId, foes.map(entry => entry.character_id));
  const near = foes.filter(entry => !fallen.has(entry.character_id) && feetBetween(scene, self, entry) <= 5)
    .sort((a, b) => feetBetween(scene, self, a) - feetBetween(scene, self, b))[0];
  if (!near) return null;
  const act = await app.inject({ method: 'POST', url: `/campaigns/${campaignId}/scenes/${sceneId}/initiative/${entryId}/act`, headers, payload: { action: 'disengage', using: 'bonus' } });
  if (act.statusCode >= 300) return null;
  const fled = await db.transaction(async q => fleeFrom(ctx, q, campaignId, userId, await getScene(q, campaignId, sceneId, true), self, near, false));
  if (fled) triggers.send(campaignId, fled.notices);
  return fled ? near.name : null;
}

export async function bonusUsed(ctx: TableContext, campaignId: string, sceneId: string, characterId: string) {
  const { db } = ctx;
  return Boolean((await db.query('SELECT bonus_used FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3', [campaignId, sceneId, characterId])).rows[0]?.bonus_used);
}

export async function autoWildShape(ctx: TableContext, campaignId: string, sceneId: string, headers: Record<string, string>) {
  const { app, db } = ctx;
  const current = (
    await db.query(
      `SELECT ie.character_id, ie.action_used, c.kind, c.level, c.class_name, c.sheet_extra, c.disposition FROM initiative_entries ie
         JOIN characters c ON c.campaign_id = ie.campaign_id AND c.id = ie.character_id
         WHERE ie.campaign_id=$1 AND ie.scene_id=$2 AND ie.is_current AND c.kind='npc'
         ORDER BY ${INITIATIVE_ORDER} LIMIT 1`,
      [campaignId, sceneId],
    )
  ).rows[0] as any;
  if (!current || current.action_used) return null;
  const classes = characterClassLevels(current).classes;
  if (!classFeaturesFor(classes).some(feature => feature.id === 'wild-shape')) return null;
  const state = await loadConditionState(db, campaignId, current.character_id);
  if (state.codes.has('wild_shape') || incapacitatedReason(state)) return null;
  const left = (await db.query(`SELECT current FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name='Дикий облик'`, [campaignId, current.character_id])).rows[0];
  if (left && Number(left.current) <= 0) return null;
  const all = wildShapeBeasts(classLevelOf(classes, 'druid', current.level));
  const fighters = all.filter(entry => Math.max(0, ...entry.attacks.map(attack => attack.average ?? 0)) >= 3);
  const beast = [...(fighters.length ? fighters : all)].sort((a, b) => b.hp - a.hp || b.cr - a.cr)[0];
  if (!beast) return null;
  const done = await app.inject({
    method: 'POST', url: `/campaigns/${campaignId}/characters/${current.character_id}/features/wild-shape`, headers, payload: { sceneId, beast: beast.index },
  });
  return done.statusCode < 300 ? beast.nameRu : null;
}

export async function foesAround(ctx: TableContext, campaignId: string, sceneId: string, characterId: string) {
  const { db } = ctx;
  const placements = await loadPlacements(db, campaignId, sceneId);
  const scene = await getScene(db, campaignId, sceneId, false);
  const self = placements.find(entry => entry.character_id === characterId && !entry.parent_object_id);
  if (!self || !placementFactions(self).length) return [];
  const foes = placements.filter(entry => !entry.parent_object_id && placementsHostile(entry, self));
  const fallen = await deadCreatures(db, campaignId, foes.map(entry => entry.character_id));
  return foes.filter(entry => !fallen.has(entry.character_id))
    .map(entry => ({ id: entry.character_id, name: entry.name, feet: feetBetween(scene, self, entry) }))
    .sort((a, b) => a.feet - b.feet);
}

export const AUTO_HOVER_FEET = 5;

export async function autoOpening(ctx: TableContext, campaignId: string, sceneId: string, headers: Record<string, string>) {
  const { app, db } = ctx;
  const none = { flew: null as number | null, descended: null as number | null, aura: null as string | null };
  const current = (
    await db.query(
      `SELECT ie.character_id, ie.action_used, c.level, c.class_name, c.sheet_extra FROM initiative_entries ie
         JOIN characters c ON c.campaign_id = ie.campaign_id AND c.id = ie.character_id
         WHERE ie.campaign_id=$1 AND ie.scene_id=$2 AND ie.is_current AND c.kind='npc'
         ORDER BY ${INITIATIVE_ORDER} LIMIT 1`,
      [campaignId, sceneId],
    )
  ).rows[0] as any;
  if (!current) return none;
  const state = await loadConditionState(db, campaignId, current.character_id);
  if (incapacitatedReason(state)) return none;
  const foes = await foesAround(ctx, campaignId, sceneId, current.character_id);
  if (!foes.length) return none;
  const result = { ...none };
  const melee = Boolean((
    await db.query(`SELECT 1 FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND weapon_kind IS DISTINCT FROM 'ranged' LIMIT 1`, [campaignId, current.character_id])
  ).rows[0]);
  const fly = (height: number) => app.inject({ method: 'PUT', url: `/campaigns/${campaignId}/characters/${current.character_id}/flying`, headers, payload: { on: true, height } });
  if (flySpeedFrom(current.sheet_extra) > 0 && !['flying', 'dragon_wings', 'prone', 'grappled', 'restrained'].some(code => state.codes.has(code))) {
    const done = await fly(melee ? AUTO_HOVER_FEET : 10);
    if (done.statusCode < 300) result.flew = Number(done.json().height ?? 10);
  } else if (melee && (state.codes.has('flying') || state.codes.has('dragon_wings'))) {
    const height = Number((
      await db.query(`SELECT MAX(COALESCE((parameters->>'height')::float8, 0)) AS height FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('flying', 'dragon_wings')`, [campaignId, current.character_id])
    ).rows[0]?.height ?? 0);
    if (height > AUTO_HOVER_FEET && (await fly(AUTO_HOVER_FEET)).statusCode < 300) result.descended = AUTO_HOVER_FEET;
  }
  if (current.action_used) return result;
  const features = new Set(classFeaturesFor(characterClassLevels(current).classes).map(feature => feature.id as string));
  const left = async (name: string) => {
    const row = (await db.query('SELECT current FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name=$3', [campaignId, current.character_id, name])).rows[0];
    return row ? Number(row.current) : Infinity;
  };
  const call = (id: string, body: Record<string, unknown> = {}) => app.inject({
    method: 'POST', url: `/campaigns/${campaignId}/characters/${current.character_id}/features/${id}`, headers, payload: { sceneId, ...body },
  });
  const near = (feet: number) => foes.filter(foe => foe.feet <= feet).length;
  if (features.has('holy-nimbus') && !state.codes.has('holy_nimbus') && near(HOLY_NIMBUS_FEET) >= 1 && (await left('Святой нимб')) >= 1) {
    if ((await call('holy-nimbus')).statusCode < 300) result.aura = 'зажигает «Святой нимб»';
  } else if (features.has('draconic-presence') && !state.codes.has('draconic_presence') && !state.codes.has('concentration')
    && near(DRACONIC_PRESENCE_FEET) >= 2 && (await left('Очки чародейства')) >= DRACONIC_PRESENCE_COST) {
    if ((await call('draconic-presence', { mode: 'fear' })).statusCode < 300) result.aura = 'раскрывает «Драконье присутствие» (аура страха)';
  }
  return result;
}

export async function autoIntimidate(ctx: TableContext, campaignId: string, sceneId: string, characterId: string, call: (id: string, body?: Record<string, unknown>) => Promise<{ statusCode: number }>) {
  const { db } = ctx;
  const foes = (await foesAround(ctx, campaignId, sceneId, characterId)).filter(foe => foe.feet <= INTIMIDATING_PRESENCE_FEET);
  for (const foe of foes) {
    const resisted = (
      await db.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='presence_resisted' AND parameters->>'sourceCharacterId' = $3`, [campaignId, foe.id, characterId])
    ).rows[0];
    if (resisted) continue;
    return (await call('intimidating-presence', { targetId: foe.id })).statusCode < 300 ? foe.name : null;
  }
  return null;
}

export async function dreadSource(q: Queryable, campaignId: string, characterId: string, code: 'turned' | 'frightened', placements: Placement[]) {
  const ids = (
    await q.query(
      `SELECT parameters->>'sourceCharacterId' AS source_id FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code=$3 AND active`,
      [campaignId, characterId, code],
    )
  ).rows.map(row => row.source_id as string | null).filter((id): id is string => Boolean(id));
  return placements.find(entry => ids.includes(entry.character_id) && !entry.parent_object_id) ?? null;
}

export async function fleeFrom(ctx: TableContext, q: Queryable, campaignId: string, userId: string, scene: any, npc: Placement, source: Placement, dash: boolean) {
  const { actionEconomy, triggers } = ctx;
  const from = { x: npc.world_x, z: npc.world_z };
  let state = await movementState(q, campaignId, scene, npc.character_id, true);
  let dashed = false;
  if (dash && state) {
    const entry = (await q.query('SELECT id, action_used FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3', [campaignId, scene.id, npc.character_id])).rows[0];
    if (entry && !entry.action_used) {
      await actionEconomy.spend(q, campaignId, npc.character_id, 'action', { kind: 'other' }, { enforce: false, sceneId: scene.id });
      await q.query('UPDATE initiative_entries SET dashes=dashes+1 WHERE id=$1', [entry.id]);
      dashed = true;
      state = await movementState(q, campaignId, scene, npc.character_id, true);
    }
  }
  const rules = await movementRules(q, campaignId, scene, npc.character_id);
  const grid = state ? state.grid : rules.grid;
  const feetPerCell = state ? state.feetPerCell : rules.feetPerCell;
  const left = state ? state.left : rules.speed.feet * (dash ? 2 : 1);
  if (left <= 0) return null;
  const occupied = (await creatureCells(q, campaignId, scene, npc.id)) ?? new Set<string>();
  const start = feetBetween(scene, npc, source);
  let best: { to: { x: number; z: number }; away: number; cost: number } | null = null;
  for (const [, { cell, cost }] of reachablePositions(grid, positionOf(grid, from.x, from.z), left / feetPerCell)) {
    if (cost === 0) continue;
    const to = centerOf(grid, cell);
    if (occupiedCells(scene, to.x, to.z, grid.size).some(part => occupied.has(`${part.col}:${part.row}`))) continue;
    const away = feetBetween(scene, { ...npc, world_x: to.x, world_z: to.z }, source);
    if (away <= start + 1e-9) continue;
    if (!best || away > best.away + 1e-9 || (Math.abs(away - best.away) < 1e-9 && cost < best.cost)) best = { to, away, cost };
  }
  if (!best) return null;
  if (state) await spendMovement(ctx, q, campaignId, scene, npc.character_id, from, best.to);
  await q.query('UPDATE scene_objects SET x=$3, z=$4, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, npc.id, best.to.x, best.to.z]);
  await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [scene.id]);
  const notices = await triggers.fireEnter(q, campaignId, scene, userId, { characterId: npc.character_id, name: npc.name, size: npc.size }, from, best.to);
  notices.push(...await releaseDistantGrapples(q, campaignId, scene, npc.character_id));
  const provoked = await detectOpportunities(q, campaignId, scene, npc.character_id, from, best.to);
  return { from, to: best.to, dashed, notices, provoked, from_name: source.name };
}

export async function routinesOf(q: Queryable, campaignId: string, characterId: string, weapons: any[]): Promise<MultiattackRoutine[]> {
  const row = (await q.query('SELECT sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
  const own = multiattackText(row?.sheet_extra?.text?.actions?.value);
  const monster = typeof row?.sheet_extra?.srdMonster === 'string' ? findMonster(row.sheet_extra.srdMonster) : undefined;
  const text = own ?? monster?.multiattack?.text ?? null;
  if (!text) return [];
  return multiattackRoutines(text, weapons.map(weapon => ({ id: weapon.id, name: weapon.name, kind: weapon.weapon_kind === 'ranged' ? 'ranged' : 'melee' })));
}
