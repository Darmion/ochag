import type { MagicBonuses, Rarity, Recharge } from '../../character/magic-items.ts';

export type MagicItemKind = 'armor' | 'ammunition' | 'weapon' | 'potion' | 'ring' | 'rod' | 'scroll' | 'staff' | 'wand' | 'wondrous';

export type ItemCharges = { max: number; recharge?: Recharge; formula?: string; destroyOnEmpty?: boolean };

// A spell the item casts: its cost in the item's charges (0 = at will), the level it is cast at,
// whether each extra charge raises that level, and a fixed save DC or attack bonus (otherwise the caster's).
export type ItemSpell = { spell: string; charges: number; level?: number; perCharge?: boolean; maxLevel?: number; dc?: number; attack?: number };

export type ItemEffect =
  | { kind: 'heal'; formula: string }
  | { kind: 'temp-hp'; amount: number }
  | { kind: 'condition'; code: string; rounds: number; parameters?: Record<string, unknown> }
  | { kind: 'cure'; codes: string[] };

export type ItemUse =
  | { kind: 'consume'; time: 'action' | 'bonus'; effects: ItemEffect[] }
  | { kind: 'scroll'; level: number; dc: number; attack: number };

export type SrdMagicItem = {
  index: string;
  name: string;
  nameRu: string;
  kind: MagicItemKind;
  kindText: string;
  rarity: Rarity;
  attunement: boolean;
  attunementBy?: string;
  spells: string[];
  description: string;
  charges?: ItemCharges;
  bonuses?: MagicBonuses;
  castable?: ItemSpell[];
  use?: ItemUse;
  legacy?: string[];
};
