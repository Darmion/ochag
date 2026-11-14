import type { ItemSpell } from '../srd/magic-items/types.ts';

// A spell cast from an item has no row of its own: its id names the item and the spell, «item-<item uuid>-<spell index>».
const ITEM_SPELL_ID = /^item-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([a-z0-9-]{1,64})$/;
export const ITEM_SPELL_ID_PATTERN = ITEM_SPELL_ID.source;

export function itemSpellId(itemId: string, spell: string): string {
  return `item-${itemId}-${spell}`;
}

export function parseItemSpellId(id: string): { itemId: string; spell: string } | null {
  const match = ITEM_SPELL_ID.exec(id);
  return match ? { itemId: match[1]!, spell: match[2]! } : null;
}

export type ItemSpellLevel = { level: number; cost: number };

// The levels a spell can be cast at from the item and what each costs in its charges (none at will, none on a scroll).
export function itemSpellLevels(cast: Pick<ItemSpell, 'charges' | 'level' | 'perCharge' | 'maxLevel'>, spellLevel: number, chargesLeft: number | null): ItemSpellLevel[] {
  const base = Math.max(spellLevel, cast.level ?? spellLevel);
  const left = chargesLeft ?? Infinity;
  if (!cast.perCharge) return cast.charges <= left ? [{ level: base, cost: cast.charges }] : [];
  const top = Math.min(9, cast.maxLevel ?? 9);
  const levels: ItemSpellLevel[] = [];
  for (let level = base; level <= top; level++) {
    const cost = cast.charges + (level - base);
    if (cost <= left) levels.push({ level, cost });
  }
  return levels;
}
