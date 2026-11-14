import type { Queryable } from '../../../db.ts';
import { footprintCells, occupiedCells } from '../../../../../../packages/domain/map/footprint.ts';
import { itemCategory } from '../../../../../../packages/domain/character/inventory.ts';
import { asItem, ITEM_COLUMNS } from '../../../characters/inventory-state.ts';
import type { Notice } from '../scene-triggers.ts';
import { swimSpeedFrom } from './speed.ts';

export function inDeepWater(scene: any, x: number, z: number, size: string | null) {
  const deep = new Set((Array.isArray(scene.water_cells) ? scene.water_cells as number[][] : []).filter(cell => cell[2] === 2).map(cell => `${cell[0]}:${cell[1]}`));
  if (!deep.size) return false;
  return occupiedCells(scene, x, z, footprintCells(size ?? 'medium')).some(cell => deep.has(`${cell.col}:${cell.row}`));
}

// The rules leave armor in deep water to the GM, so the game only tells the GM once the swimmer goes in.
export async function armorSwimNotice(
  q: Queryable, campaignId: string, scene: any, actor: { characterId: string; name: string; size: string | null },
  from: { x: number; z: number }, to: { x: number; z: number },
): Promise<Notice | null> {
  if (!inDeepWater(scene, to.x, to.z, actor.size) || inDeepWater(scene, from.x, from.z, actor.size)) return null;
  const row = (await q.query('SELECT sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, actor.characterId])).rows[0];
  if (!row || swimSpeedFrom(row.sheet_extra) > 0) return null;
  const aloft = (await q.query(
    `SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('flying', 'dragon_wings') LIMIT 1`,
    [campaignId, actor.characterId],
  )).rows[0];
  if (aloft) return null;
  const worn = (await q.query(`SELECT ${ITEM_COLUMNS} FROM characters c WHERE c.campaign_id=$1 AND c.container_id=$2 AND c.equipped_slot='body'`, [campaignId, actor.characterId])).rows;
  const armor = worn.find(item => itemCategory(asItem(item)) === 'armor');
  if (!armor) return null;
  return {
    title: `${actor.name} в доспехе в глубокой воде`,
    detail: `${armor.name}: мастер решает, нужна ли проверка Силы (Атлетика), чтобы удержаться на плаву.`,
    secret: true,
  };
}
