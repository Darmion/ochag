import { ARMOR } from './armor.ts';
import { WEAPONS } from './weapons.ts';
import { POTIONS } from './potions.ts';
import { RINGS } from './rings.ts';
import { RODSSTAFFSWANDS } from './rods-staffs-wands.ts';
import { SCROLLS } from './scrolls.ts';
import { WONDROUS } from './wondrous.ts';
import type { SrdMagicItem } from './types.ts';

export type { SrdMagicItem } from './types.ts';

export const SRD_MAGIC_ITEM_LIST: SrdMagicItem[] = [...ARMOR, ...WEAPONS, ...POTIONS, ...RINGS, ...RODSSTAFFSWANDS, ...SCROLLS, ...WONDROUS];
