import type { Queryable } from '../../../db.ts';
import { classFeaturesFor } from '../../../../../../packages/domain/character/class-features.ts';
import type { PathGrid } from '../../../../../../packages/domain/map/pathfinding.ts';
import { deadCreatures } from '../../combat/loot-routes.ts';
import { characterClassLevels } from '../../../../../../packages/domain/character/classes.ts';
import { placementFactions, placementsHostile, placementsRestricted } from '../../../campaign/factions.ts';
import { type DiagonalRule, DIAGONAL_RULE_KEY } from '../../../../../../packages/domain/map/measure.ts';
import { SIZES, occupiedCells, footprintCells } from '../../../../../../packages/domain/map/footprint.ts';
import { areaCells } from '../../../../../../packages/domain/map/areas.ts';
import { areaOf } from '../scene-triggers.ts';
import { campaignFlag } from '../../rolls/dice.ts';
import { sceneWalls } from '../board.ts';
import { blockingPlacements, loadPlacements } from '../placements.ts';
import { climbSpeedFrom, swimSpeedFrom } from './speed.ts';
import { cellHeight } from '../../../../../../packages/domain/map/relief.ts';
import { sceneHeights } from '../board.ts';
import type { Placement } from '../../shared.ts';

export async function diagonalRule(q: Queryable, campaignId: string): Promise<DiagonalRule> {
  const diagonal = (
    await q.query(`SELECT value FROM campaign_rules WHERE campaign_id=$1 AND kind='flag' AND key=$2`, [campaignId, DIAGONAL_RULE_KEY])
  ).rows[0];
  return diagonal?.value === true ? '5-10-5' : 'phb';
}

export async function movementGrid(
  q: Queryable, campaignId: string, scene: any, isMover: (placement: Placement) => boolean, size: string | null, rule: DiagonalRule,
  creatures = false,
): Promise<PathGrid> {
  const all = await loadPlacements(q, campaignId, scene.id);
  const placements = all.filter(placement => !isMover(placement));
  const walls = await sceneWalls(q, campaignId, scene.id);
  const blockers = await blockingPlacements(q, campaignId, scene, placements, 'move');
  const walker = all.find(placement => isMover(placement) && !placement.parent_object_id && placement.kind !== 'object');
  const moves = walker ? await terrainMoves(q, campaignId, walker.character_id) : { flying: false, landStride: false, swims: false, climbs: false };
  const heights = sceneHeights(scene);
  const freeStride = moves.flying || moves.landStride;
  const water = Array.isArray(scene.water_cells) ? scene.water_cells as number[][] : [];
  const difficult = new Set(
    freeStride ? [] : [
      ...(Array.isArray(scene.difficult_cells) ? scene.difficult_cells : []).map((cell: number[]) => `${cell[0]}:${cell[1]}`),
      ...water.filter(cell => cell[2] === 1).map(cell => `${cell[0]}:${cell[1]}`),
    ],
  );
  const deep = new Set(water.filter(cell => cell[2] === 2).map(cell => `${cell[0]}:${cell[1]}`));
  if (!freeStride) {
    const zones = (await q.query(
      `SELECT shape, x, z, direction, size_feet::float8 AS size_feet, caster_id, (spell->>'spares')::boolean IS TRUE AS spares FROM scene_triggers
       WHERE campaign_id=$1 AND scene_id=$2 AND enabled AND (spell->>'difficult')::boolean IS TRUE`,
      [campaignId, scene.id],
    )).rows;
    for (const zone of zones) {
      const caster = zone.spares ? all.find(placement => placement.character_id === zone.caster_id && !placement.parent_object_id) : undefined;
      if (zone.spares && walker && (walker.character_id === zone.caster_id || (caster && !placementsHostile(caster, walker)))) continue;
      for (const cell of areaCells(areaOf(zone, Number(scene.feet_per_unit || 5)), { widthCells: scene.width_cells, heightCells: scene.height_cells })) difficult.add(`${cell.col}:${cell.row}`);
    }
  }
  const hostileCells = new Set<string>();
  const self = creatures ? all.find(placement => isMover(placement) && !placement.parent_object_id) : undefined;
  if (self && placementFactions(self).length && (await campaignFlag(q, campaignId, 'hostile_blocks')) !== false) {
    const rank = (value: string | null | undefined) => Math.max(0, SIZES.indexOf((value ?? 'medium') as (typeof SIZES)[number]));
    const enemies = placements.filter(placement =>
      !placement.parent_object_id && !placement.hidden && placement.kind !== 'object' &&
      (placementsHostile(placement, self) || placementsRestricted(placement, self, 'block-passage')) &&
      Math.abs(rank(placement.size) - rank(size)) < 2);
    const fallen = enemies.length ? await deadCreatures(q, campaignId, enemies.map(placement => placement.character_id)) : new Set<string>();
    for (const enemy of enemies) {
      if (fallen.has(enemy.character_id)) continue;
      for (const cell of occupiedCells(scene, enemy.world_x, enemy.world_z, footprintCells(enemy.size))) hostileCells.add(`${cell.col}:${cell.row}`);
    }
  }
  return {
    widthCells: scene.width_cells, heightCells: scene.height_cells, size: footprintCells(size ?? 'medium'), rule,
    edges: [...walls, ...blockers.flatMap(blocker => blocker.edges)], walls,
    isDifficult: cell => difficult.has(`${cell.col}:${cell.row}`),
    isDeepWater: cell => deep.has(`${cell.col}:${cell.row}`),
    swims: moves.flying || moves.swims,
    ...(heights.size && !moves.flying ? { groundAt: (cell: { col: number; row: number }) => cellHeight(heights, cell), feetPerCell: Number(scene.feet_per_unit || 5), climbs: moves.climbs } : {}),
    blockedCells: new Set(blockers.flatMap(blocker => blocker.cells.map(cell => `${cell.col}:${cell.row}`))),
    hostileCells,
  };
}

// A flyer ignores every kind of ground; Land's Stride only difficult terrain, so it still swims in deep water.
export async function terrainMoves(q: Queryable, campaignId: string, characterId: string) {
  const row = (await q.query('SELECT level, class_name, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
  if (!row) return { flying: false, landStride: false, swims: false, climbs: false };
  const landStride = classFeaturesFor(characterClassLevels(row).classes).some(feature => feature.id === 'lands-stride' || feature.id === 'lands-stride-ranger');
  const active = new Set((await q.query(
    `SELECT effect_code FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code IN ('dragon_wings', 'flying', 'spider_climb') AND active`,
    [campaignId, characterId],
  )).rows.map(effect => String(effect.effect_code)));
  const flying = active.has('flying') || active.has('dragon_wings');
  return { flying, landStride, swims: swimSpeedFrom(row.sheet_extra) > 0, climbs: climbSpeedFrom(row.sheet_extra) > 0 || active.has('spider_climb') };
}
