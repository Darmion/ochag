import { SRD_GEAR_BY_INDEX } from '../srd/gear.ts';
import { SRD_WEAPONS } from '../srd/weapons.ts';
import { catalogEntry } from './inventory.ts';
import type { SrdMagicItem } from '../srd/magic-items/types.ts';
import type { ItemCategory } from './inventory.ts';

// The ordinary item a magic weapon or armor is made from: it gives the attack or the armor class, the item adds its bonus on top.
export type MagicItemBase = { ref: string; name: string; category: 'weapon' | 'armor' | 'shield'; weightLb: number | null };

const GENERIC = /^(weapon|armor)-\d$/;
const SHIELD = /щит/i;

export function magicBaseOptions(item: SrdMagicItem): MagicItemBase[] {
  if (item.kind === 'weapon') {
    return SRD_WEAPONS.filter(weapon => weapon.damage).map(weapon => ({ ref: `weapon:${weapon.index}`, name: weapon.nameRu, category: 'weapon' as const, weightLb: catalogEntry(`weapon:${weapon.index}`)?.weightLb ?? null }));
  }
  if (item.kind !== 'armor') return [];
  const shield = SHIELD.test(item.kindText);
  return [...SRD_GEAR_BY_INDEX.values()]
    .filter(gear => gear.armor && (gear.armor.kind === 'shield') === shield)
    .map(gear => ({ ref: `gear:${gear.index}`, name: gear.nameRu, category: shield ? 'shield' as const : 'armor' as const, weightLb: gear.weightLb ?? null }));
}

export function magicItemBase(item: SrdMagicItem, ref: string | null | undefined): { base: MagicItemBase | null; name: string } | { problem: string } {
  if (!ref) return { base: null, name: item.nameRu };
  const base = magicBaseOptions(item).find(option => option.ref === ref);
  if (!base) return { problem: `«${item.nameRu}» нельзя сделать из этого предмета — выберите ${item.kind === 'weapon' ? 'оружие' : 'доспех'} из списка.` };
  const plus = /\+\d$/.exec(item.nameRu)?.[0];
  return { base, name: GENERIC.test(item.index) && plus ? `${base.name} ${plus}` : item.nameRu };
}

// Where the item goes in the inventory when it has no base: names alone mislead («Палочка волшебных стрел» is no arrow).
export function magicItemCategory(item: SrdMagicItem): ItemCategory | null {
  if (item.kind === 'potion' || item.kind === 'scroll') return 'consumable';
  if (item.kind === 'ammunition') return 'ammo';
  if (item.kind === 'wand' || item.kind === 'staff' || item.kind === 'rod') return 'focus';
  return null;
}
