import type { EquipSlot, ItemCategory } from '../../../../packages/domain/character/inventory';
import type { GameIconName } from '../ui/gameIcons';

export const CATEGORY_ICONS: Record<ItemCategory, GameIconName> = {
  weapon: 'sword', armor: 'helm', shield: 'shield', ammo: 'bow', consumable: 'potion', tools: 'pickaxe', focus: 'orb',
  clothes: 'hooded', gear: 'pouch', treasure: 'coins', book: 'book', other: 'more',
};

export const SLOT_ICONS: Record<EquipSlot, GameIconName> = {
  head: 'helm', neck: 'chain', cloak: 'hooded', body: 'person', main_hand: 'sword', off_hand: 'shield', hands: 'hand',
  ring_1: 'orb', ring_2: 'orb', belt: 'pouch', feet: 'run', ammo: 'bow',
};

export function srdArtIndex(srd: string | null): string | null {
  return srd ? srd.replace(/^(gear|weapon):/, '') : null;
}

export function priceLabel(cp: number | null): string {
  if (cp === null) return '—';
  const gold = Math.floor(cp / 100), silver = Math.floor((cp % 100) / 10), copper = Math.round(cp % 10);
  return [gold && `${gold} зм`, silver && `${silver} см`, copper && `${copper} мм`].filter(Boolean).join(' ') || '0 мм';
}

export function weightLabel(lb: number | null): string {
  if (lb === null) return 'вес не указан';
  const rounded = Math.round(lb * 100) / 100;
  return `${String(rounded).replace('.', ',')} фнт.`;
}
