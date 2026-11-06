import type { Queryable } from '../../db.ts';
import { cellCutByWall } from '../../../../../packages/domain/map/blockers.ts';
import { type WallSegment, isLatticePoint } from '../../../../../packages/domain/map/los.ts';
import { effectiveLighting } from '../../../../../packages/domain/world/clock.ts';
import { isFootprintCenter, occupiedCells, footprintCells } from '../../../../../packages/domain/map/footprint.ts';

import { type Placement, reject, WALLS_MOVE, WALLS_SIGHT } from '../shared.ts';

export async function getScene(
  q: Queryable,
  campaignId: string,
  sceneId: string,
  lock = true,
) {
  const { rows } = await q.query(
    `SELECT id, name, revision, width_cells, height_cells,
              feet_per_unit::float8 AS feet_per_unit, background_asset_id, background_rotation,
              default_vision_radius_feet::float8 AS default_vision_radius_feet,
              combat_round, playlist, mood_playlists, lighting, difficult_cells, sky, weather, rest, grid, ambience,
              (SELECT world_minutes FROM campaigns c WHERE c.id = scenes.campaign_id) AS world_minutes
       FROM scenes
       WHERE campaign_id=$1
         AND id=$2
         AND scene_document->>'kind'='shared-grid-v1'
       ${lock ? 'FOR UPDATE' : ''}`,
    [campaignId, sceneId],
  );

  if (!rows[0]) reject(404, 'Сцена не найдена.');

  rows[0].world_minutes = Number(rows[0].world_minutes ?? 0);
  rows[0].effective_lighting = effectiveLighting(rows[0], rows[0].world_minutes);
  return rows[0];
}

export function halfBoundsFor(scene: any) {
  return {
    halfWidth: scene.width_cells / 2,
    halfHeight: scene.height_cells / 2,
  };
}

export function assertOnBoard(
  scene: any,
  x: number,
  z: number,
) {
  const { halfWidth, halfHeight } = halfBoundsFor(scene);

  if (
    x < -halfWidth + 0.5 || x > halfWidth - 0.5 ||
    z < -halfHeight + 0.5 || z > halfHeight - 0.5
  ) {
    reject(400, 'Координаты выходят за пределы карты.');
  }
}

// Cell centres are half-integers on even boards and integers on odd ones (as in the client's grid.ts).
export function assertOnCells(scene: any, x: number, z: number, footprint: number) {
  if (!isFootprintCenter(x, scene.width_cells, footprint) || !isFootprintCenter(z, scene.height_cells, footprint)) {
    reject(400, footprint === 1
      ? 'При включённой привязке объект должен быть в центре клетки.'
      : `При включённой привязке объект ${footprint}×${footprint} клетки должен стоять ровно по клеткам и целиком на карте.`);
  }
}

export async function sceneWalls(q: Queryable, campaignId: string, sceneId: string, use: 'move' | 'sight' = 'move') {
  return (
    await q.query<WallSegment>(`SELECT x1, z1, x2, z2 FROM scene_walls WHERE campaign_id=$1 AND scene_id=$2 ${use === 'sight' ? WALLS_SIGHT : WALLS_MOVE}`, [campaignId, sceneId])
  ).rows;
}

export function anyCellCutByWall(scene: any, x: number, z: number, footprint: number, walls: WallSegment[]) {
  if (!walls.length) return false;
  return occupiedCells(scene, x, z, footprint).some(({ col, row }) =>
    cellCutByWall(col - scene.width_cells / 2 + 0.5, row - scene.height_cells / 2 + 0.5, walls));
}

export function assertCellsClear(scene: any, x: number, z: number, footprint: number, walls: WallSegment[]) {
  if (anyCellCutByWall(scene, x, z, footprint, walls)) {
    reject(400, footprint === 1
      ? 'Клетку по диагонали срезает стена — сюда не встать.'
      : `Клетку по диагонали срезает стена — объект ${footprint}×${footprint} клетки сюда не встаёт.`);
  }
}

export function assertLatticePoint(scene: any, x: number, z: number) {
  const { halfWidth, halfHeight } = halfBoundsFor(scene);

  if (x < -halfWidth || x > halfWidth || z < -halfHeight || z > halfHeight) {
    reject(400, 'Координаты выходят за пределы карты.');
  }

  if (
    !isLatticePoint(x, scene.width_cells) ||
    !isLatticePoint(z, scene.height_cells)
  ) {
    reject(400, 'Конец стены должен быть в узле сетки.');
  }
}

export type CellSet = { has(index: number): boolean };

// Nearest cell for fog bucketing; not for exact placement.
export function packCell(scene: any, x: number, z: number): number {
  const col = Math.round(x + scene.width_cells / 2 - 0.5);
  const row = Math.round(z + scene.height_cells / 2 - 0.5);
  return row * scene.width_cells + col;
}

export function unpackCell(scene: any, index: number): { x: number; z: number } {
  const col = index % scene.width_cells;
  const row = Math.floor(index / scene.width_cells);

  return {
    x: col - scene.width_cells / 2 + 0.5,
    z: row - scene.height_cells / 2 + 0.5,
  };
}

export function formatFeet(feet: number) {
  return Number.isInteger(feet) ? String(feet) : feet.toFixed(1).replace('.', ',');
}

export function feetBetween(scene: any, a: Placement, b: Placement) {
  const side = (placement: Placement) => footprintCells(placement.size);
  const gapX = Math.max(0, Math.abs(a.world_x - b.world_x) - side(a) / 2 - side(b) / 2);
  const gapZ = Math.max(0, Math.abs(a.world_z - b.world_z) - side(a) / 2 - side(b) / 2);
  const lowA = Number(a.altitude_feet ?? 0) / scene.feet_per_unit;
  const lowB = Number(b.altitude_feet ?? 0) / scene.feet_per_unit;
  const gapY = Math.max(0, Math.max(lowA, lowB) - Math.min(lowA + side(a), lowB + side(b)));
  return Math.round((Math.max(gapX, gapZ, gapY) + 1) * scene.feet_per_unit * 1000) / 1000;
}
