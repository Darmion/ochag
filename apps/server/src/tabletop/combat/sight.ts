import type { Queryable } from '../../db.ts';
import { pathBlocked } from '../../../../../packages/domain/map/blockers.ts';
import { loadConditionState } from '../../rules/conditions.ts';
import { conditionState } from '../../../../../packages/domain/combat/conditions.ts';
import type { WallSegment } from '../../../../../packages/domain/map/los.ts';
import { DEVILS_SIGHT_FEET, seenThrough, type LightLevel, type SeenLight } from '../../../../../packages/domain/map/light.ts';
import { weatherRules } from '../../../../../packages/domain/world/clock.ts';

import type { TableContext } from '../context.ts';
import { notifyCampaign } from '../live/notify.ts';
import { feetBetween, getScene, packCell, sceneWalls } from '../scene/board.ts';
import { blockingPlacements, loadPlacements } from '../scene/placements.ts';
import { devilsSightIds, illuminationOf } from '../scene/vision.ts';
import type { Illumination, Placement } from '../shared.ts';

export const WEATHER_REASON: Record<string, string> = { storm: 'ливень', snow: 'снегопад', fog: 'туман' };
export async function obscuredSight(q: Queryable, campaignId: string, sceneId: string, characterId: string): Promise<string[]> {
  const scene: any = await getScene(q, campaignId, sceneId, false);
  if (weatherRules(scene.weather).perceptionDisadvantage) return [WEATHER_REASON[scene.weather] ?? 'непогода'];
  const placements = await loadPlacements(q, campaignId, sceneId);
  const self = placements.find(placement => placement.character_id === characterId);
  if (!self) return [];
  const walls = await sceneWalls(q, campaignId, sceneId, 'sight');
  const sightWalls = [...walls, ...(await blockingPlacements(q, campaignId, scene, placements, 'sight')).flatMap(blocker => blocker.edges)];
  const illumination = await illuminationOf(q, campaignId, scene, placements, sightWalls);
  const index = packCell(scene, self.world_x, self.world_z);
  const devilsSightFeet = (await devilsSightIds(q, campaignId, [characterId])).has(characterId) ? DEVILS_SIGHT_FEET : 0;
  const seen = seenThrough(illumination[index] as LightLevel, 0, Number((self as any).darkvision_feet ?? 0), { magicalDarkness: illumination.darkness.has(index), devilsSightFeet });
  if (seen === 'bright') return [];
  return [seen === null ? 'темнота' : 'полумрак'];
}

export type SceneSight = {
  scene: any; placements: Placement[]; walls: WallSegment[]; blockers: Array<{ id: string; edges: WallSegment[] }>;
  sightWalls: WallSegment[]; illumination: Illumination;
  devilsSight: Set<string>;
};

export async function sceneSight(q: Queryable, campaignId: string, scene: any, placements?: Placement[]): Promise<SceneSight> {
  const all = placements ?? await loadPlacements(q, campaignId, scene.id);
  const walls = await sceneWalls(q, campaignId, scene.id, 'sight');
  const blockers = (await blockingPlacements(q, campaignId, scene, all, 'sight')).map(blocker => ({ id: blocker.id, edges: blocker.edges }));
  const sightWalls = [...walls, ...blockers.flatMap(blocker => blocker.edges)];
  const illumination = await illuminationOf(q, campaignId, scene, all, sightWalls);
  const devilsSight = await devilsSightIds(q, campaignId, all.filter(placement => placement.kind !== 'object').map(placement => placement.character_id));
  return { scene, placements: all, walls, blockers, sightWalls, illumination, devilsSight };
}

export function seenFrom(sight: SceneSight, observer: Placement, x: number, z: number, ignore?: string): SeenLight | null {
  const { scene } = sight;
  const walls = ignore ? [...sight.walls, ...sight.blockers.filter(blocker => blocker.id !== ignore).flatMap(blocker => blocker.edges)] : sight.sightWalls;
  if (pathBlocked({ x: observer.world_x, z: observer.world_z }, { x, z }, walls)) return null;
  const feet = Math.hypot(x - observer.world_x, z - observer.world_z) * scene.feet_per_unit;
  const fogLimit = weatherRules(scene.weather).sightFeet;
  if (fogLimit !== null && feet > fogLimit + 1e-9) return null;
  const index = packCell(scene, x, z);
  const level = sight.illumination[index] as LightLevel;
  return seenThrough(level ?? 2, feet, Number((observer as any).darkvision_feet ?? 0), {
    magicalDarkness: sight.illumination.darkness.has(index),
    devilsSightFeet: sight.devilsSight.has(observer.character_id) ? DEVILS_SIGHT_FEET : 0,
  });
}

export async function seesCreature(q: Queryable, campaignId: string, sight: SceneSight, observer: Placement, target: Placement) {
  if ((await loadConditionState(q, campaignId, target.character_id)).codes.has('invisible')) {
    return perceivesInvisible(q, campaignId, sight, observer, target);
  }
  if ((await loadConditionState(q, campaignId, observer.character_id)).codes.has('blinded')) return false;
  return seenFrom(sight, observer, target.world_x, target.world_z) !== null;
}

export async function invisibleSenses(q: Queryable, campaignId: string, characterId: string) {
  const row = (
    await q.query(
      `SELECT (sheet_extra->>'truesightFeet')::float8 AS truesight, (sheet_extra->>'blindsightFeet')::float8 AS blindsight
         FROM characters WHERE campaign_id=$1 AND id=$2`,
      [campaignId, characterId],
    )
  ).rows[0] as any;
  const effects = (
    await q.query(
      `SELECT effect_code, parameters FROM character_effects
         WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('see_invisibility', 'truesight')`,
      [campaignId, characterId],
    )
  ).rows as Array<{ effect_code: string; parameters: any }>;
  const fromEffect = Math.max(0, ...effects.filter(entry => entry.effect_code === 'truesight').map(entry => Number(entry.parameters?.feet ?? 120)));
  return {
    see: effects.some(entry => entry.effect_code === 'see_invisibility'),
    truesight: Math.max(Number(row?.truesight ?? 0), fromEffect),
    blindsight: Number(row?.blindsight ?? 0),
  };
}

export async function perceivesInvisible(q: Queryable, campaignId: string, sight: SceneSight, observer: Placement, target: Placement) {
  const senses = await invisibleSenses(q, campaignId, observer.character_id);
  if (!senses.see && senses.truesight <= 0 && senses.blindsight <= 0) return false;
  const from = { x: observer.world_x, z: observer.world_z };
  const to = { x: target.world_x, z: target.world_z };
  if (pathBlocked(from, to, sight.sightWalls)) return false;
  const feet = feetBetween(sight.scene, observer, target);
  if (senses.blindsight > 0 && feet <= senses.blindsight) return true;
  if ((await loadConditionState(q, campaignId, observer.character_id)).codes.has('blinded')) return false;
  if (senses.truesight > 0 && feet <= senses.truesight) return true;
  return senses.see && seenFrom(sight, observer, target.world_x, target.world_z) !== null;
}

export async function invisibilitySeen<S extends ReturnType<typeof conditionState>>(
  q: Queryable, campaignId: string, sceneId: string | null, attackerId: string, targetId: string, own: S, target: S | null,
): Promise<{ own: S; target: S | null }> {
  const ownInvisible = own.codes.has('invisible');
  const targetInvisible = Boolean(target?.codes.has('invisible'));
  if (!sceneId || (!ownInvisible && !targetInvisible)) return { own, target };
  const scene = await getScene(q, campaignId, sceneId, false);
  const sight = await sceneSight(q, campaignId, scene);
  const pick = (id: string) => sight.placements.find(entry => entry.character_id === id && !entry.parent_object_id);
  const attacker = pick(attackerId);
  const defender = pick(targetId);
  if (!attacker || !defender) return { own, target };
  const strip = (state: S) => conditionState([...state.codes].filter(code => code !== 'invisible')) as S;
  return {
    own: ownInvisible && (await perceivesInvisible(q, campaignId, sight, defender, attacker)) ? strip(own) : own,
    target: target && targetInvisible && (await perceivesInvisible(q, campaignId, sight, attacker, defender)) ? strip(target) : target,
  };
}

export async function breakInvisibility(q: Queryable, campaignId: string, characterId: string) {
  const removed = await q.query(
    `DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='invisible' AND active
         AND parameters->>'endsOnAttack' = 'true' RETURNING id`,
    [campaignId, characterId],
  );
  return removed.rows.length > 0;
}

export function announceVisible(ctx: TableContext, campaignId: string, characterId: string, name: string) {
  void notifyCampaign(ctx, campaignId, { type: 'notice', title: `${name} снова видим`, detail: 'Атака или заклинание обрывают «Невидимость».', tone: 'info' });
  void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
  void notifyCampaign(ctx, campaignId, { type: 'changed' });
}
