// What a creature holds in its hands as the table draws it: a look for the small picture at the hand, the motion of an attack and
// the light the item gives. Looks and motions are generic; the D&D 5e weapons and light sources are data below.
import { SRD_GEAR } from '../srd/gear.ts';
import { itemCategory, srdWeaponOf, type InventoryItem } from './inventory.ts';

export const HELD_LOOKS = ['sword', 'dagger', 'axe', 'hammer', 'spear', 'bow', 'crossbow', 'staff', 'wand', 'shield', 'torch', 'lantern', 'thing'] as const;
export type HeldLook = typeof HELD_LOOKS[number];
export type AttackMotion = 'swing' | 'thrust' | 'shot' | 'throw';
export type HeldLight = { bright: number; dim: number; cone: boolean; openFlame: boolean };
export type HeldHand = 'main' | 'off';
export type HeldView = { hand: HeldHand; name: string; srd: string | null; imageAssetId: string | null; look: HeldLook; twoHanded: boolean };

export const GEAR_LIGHTS: Readonly<Record<string, HeldLight>> = {
  candle: { bright: 5, dim: 5, cone: false, openFlame: true },
  torch: { bright: 20, dim: 20, cone: false, openFlame: true },
  lamp: { bright: 15, dim: 30, cone: false, openFlame: true },
  'lantern-hooded': { bright: 30, dim: 30, cone: false, openFlame: false },
  'lantern-bullseye': { bright: 60, dim: 60, cone: true, openFlame: false },
};

const LOOKS: ReadonlyArray<readonly [HeldLook, RegExp]> = [
  ['crossbow', /арбалет|crossbow/u],
  ['bow', /(^|[^а-яё])лук([^а-яё]|$)|bow(?![a-z])/u],
  ['dagger', /кинжал|нож|стилет|dagger|knife/u],
  ['axe', /топор|секир|axe/u],
  ['hammer', /молот|булав|кистен|дубин|палиц|моргенштерн|hammer|mace|club|flail|maul/u],
  ['spear', /копь|пика|трезуб|алебард|глефа|дротик|spear|pike|trident|halberd|glaive|javelin|dart/u],
  ['staff', /посох|staff/u],
  ['wand', /палочк|жезл|wand|rod(?![a-z])/u],
  ['torch', /факел|torch/u],
  ['lantern', /фонар|ламп|свеч|lantern|lamp|candle/u],
  ['sword', /меч|сабл|рапир|клинок|ятаган|скимитар|sword|rapier|blade|scimitar/u],
];

type ItemLike = Pick<InventoryItem, 'srd' | 'name' | 'category'>;

export function heldLook(item: ItemLike): HeldLook {
  if (itemCategory(item) === 'shield') return 'shield';
  const weapon = srdWeaponOf(item);
  const text = `${weapon?.name ?? ''} ${item.name}`.toLocaleLowerCase('ru-RU');
  const found = LOOKS.find(([, pattern]) => pattern.test(text))?.[0];
  if (found) return found;
  return weapon ? (weapon.kind === 'ranged' ? 'bow' : 'sword') : 'thing';
}

// The light an item gives by its kind; an item's own light (set by the GM) wins over this.
export function gearLight(item: Pick<InventoryItem, 'srd' | 'name'>): HeldLight | null {
  if (item.srd?.startsWith('gear:')) return GEAR_LIGHTS[item.srd.slice(5)] ?? null;
  const name = item.name.trim().toLocaleLowerCase('ru-RU');
  const gear = SRD_GEAR.find(entry => entry.nameRu.toLocaleLowerCase('ru-RU') === name);
  return gear ? GEAR_LIGHTS[gear.index] ?? null : null;
}

export function attackMotion(weapon: { kind: 'melee' | 'ranged'; properties: readonly string[]; damageType: string | null } | null, ranged: boolean): AttackMotion {
  if (!weapon) return ranged ? 'throw' : 'thrust';
  if (ranged && weapon.properties.includes('thrown') && !weapon.properties.includes('ammunition')) return 'throw';
  if (ranged || weapon.kind === 'ranged') return 'shot';
  return weapon.damageType === 'piercing' ? 'thrust' : 'swing';
}
