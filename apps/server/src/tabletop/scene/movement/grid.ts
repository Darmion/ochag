import type { Queryable } from '../../../db.ts';
import { classFeaturesFor } from '../../../../../../packages/domain/character/class-features.ts';
import type { PathGrid } from '../../../../../../packages/domain/map/pathfinding.ts';
import { deadCreatures } from '../../combat/loot-routes.ts';
import { characterClassLevels } from '../../../../../../packages/domain/character/classes.ts';
import { placementFactions, placementsHostile, placementsRestricted } from '../../../campaign/factions.ts';
import { type DiagonalRule, DIAGONAL_RULE_KEY } from '../../../../../../packages/domain/map/measure.ts';
import { SIZES, occupiedCells, footprintCells } from '../../../../../../packages/domain/map/footprint.ts';
import { campaignFlag } from '../../rolls/dice.ts';
import { sceneWalls } from '../board.ts';
import { blockingPlacements, loadPlacements } from '../placements.ts';
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
  const freeStride = walker ? await ignoresTerrain(q, campaignId, walker.character_id) : false;
  const difficult = new Set(
    freeStride ? [] : (Array.isArray(scene.difficult_cells) ? scene.difficult_cells : []).map((cell: number[]) => `${cell[0]}:${cell[1]}`),
  );
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
    blockedCells: new Set(blockers.flatMap(blocker => blocker.cells.map(cell => `${cell.col}:${cell.row}`))),
    hostileCells,
  };
}

export async function ignoresTerrain(q: Queryable, campaignId: string, characterId: string) {
  const row = (await q.query('SELECT level, class_name, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
  if (!row) return false;
  if (classFeaturesFor(characterClassLevels(row).classes).some(feature => feature.id === 'lands-stride' || feature.id === 'lands-stride-ranger')) return true;
  return Boolean((await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code IN ('dragon_wings', 'flying') AND active`, [campaignId, characterId])).rows[0]);
}
