import type { Queryable } from '../../../db.ts';
import { reject } from '../../shared.ts';

const node = (value: number, cells: number) => Math.max(-cells / 2, Math.min(cells / 2, Math.round(value + cells / 2) - cells / 2));

export function wallLine(scene: { width_cells: number; height_cells: number; feet_per_unit: number }, template: { x: number; z: number; direction: number; size_feet: number }) {
  const length = Number(template.size_feet) / Number(scene.feet_per_unit || 5);
  const angle = (Number(template.direction ?? 0) * Math.PI) / 180;
  const x1 = node(Number(template.x), scene.width_cells), z1 = node(Number(template.z), scene.height_cells);
  const x2 = node(Number(template.x) + Math.cos(angle) * length, scene.width_cells), z2 = node(Number(template.z) + Math.sin(angle) * length, scene.height_cells);
  return { x1, z1, x2, z2 };
}

export async function raiseWall(
  q: Queryable, campaignId: string, scene: any, template: any, values: Record<string, unknown>, userId: string,
): Promise<string[]> {
  const line = wallLine(scene, template);
  if (line.x1 === line.x2 && line.z1 === line.z2) reject(400, 'Стена получилась нулевой длины — протяните линию дальше.');
  const blocks = Array.isArray(values.blocks) ? values.blocks as string[] : ['move'];
  const kind = blocks.includes('sight') ? 'wall' : 'window';
  const hp = Number(values.hp ?? 0) > 0 ? Math.round(Number(values.hp)) : null;
  const row = (await q.query(
    `INSERT INTO scene_walls (campaign_id, scene_id, x1, z1, x2, z2, style, created_by, kind, hp, hp_max)
     VALUES ($1,$2,$3,$4,$5,$6,'plain',$7,$8,$9,$9) RETURNING id`,
    [campaignId, scene.id, line.x1, line.z1, line.x2, line.z2, userId, kind, hp],
  )).rows[0];
  await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [scene.id]);
  return [row.id as string];
}
