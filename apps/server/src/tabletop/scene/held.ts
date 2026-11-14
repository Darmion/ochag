import type { Queryable } from '../../db.ts';
import { gearLight, heldLook, type HeldLight, type HeldView } from '../../../../../packages/domain/character/held.ts';
import { handsNeeded } from '../../../../../packages/domain/character/inventory.ts';

export type Held = { items: HeldView[]; light: HeldLight | null };

// What each creature holds in its hands, and the light a held torch or lantern gives: the item's own light wins, an unlit one gives none.
export async function loadHeld(q: Queryable, campaignId: string, holderIds: string[]): Promise<Map<string, Held>> {
  const result = new Map<string, Held>();
  if (!holderIds.length) return result;
  const rows = (await q.query(
    `SELECT i.container_id, i.equipped_slot, i.name, i.item_srd, i.item_category, i.image_asset_id, i.item_grip,
            s.lit, s.light_bright_feet, s.light_dim_feet, s.light_cone, s.light_open_flame
       FROM characters i LEFT JOIN object_states s ON s.campaign_id=i.campaign_id AND s.character_id=i.id
      WHERE i.campaign_id=$1 AND i.kind='object' AND i.equipped_slot IN ('main_hand', 'off_hand') AND i.container_id = ANY($2::uuid[])
      ORDER BY i.equipped_slot, i.name`,
    [campaignId, holderIds],
  )).rows as Array<Record<string, any>>;
  for (const row of rows) {
    const item = { name: String(row.name), srd: row.item_srd ?? null, category: row.item_category ?? null, grip: row.item_grip ?? null };
    const held = result.get(row.container_id) ?? { items: [], light: null };
    held.items.push({
      hand: row.equipped_slot === 'main_hand' ? 'main' : 'off', name: item.name, srd: item.srd, imageAssetId: row.image_asset_id ?? null,
      look: heldLook(item), twoHanded: handsNeeded(item) === 2,
    });
    const set = Number(row.light_bright_feet ?? 0) + Number(row.light_dim_feet ?? 0) > 0;
    const light = set
      ? (row.lit === false ? null : { bright: Number(row.light_bright_feet ?? 0), dim: Number(row.light_dim_feet ?? 0), cone: row.light_cone === true, openFlame: row.light_open_flame === true })
      : gearLight(item);
    if (light && (!held.light || light.bright + light.dim > held.light.bright + held.light.dim)) held.light = light;
    result.set(row.container_id, held);
  }
  return result;
}
