import { SRD_GEAR, type SrdGear } from '../srd/gear.ts';
import { SRD_WEAPONS, type SrdWeapon } from '../srd/weapons.ts';
import { unarmoredDefense } from './class-features/common.ts';
import type { ClassLevel } from './classes.ts';

export const ITEM_CATEGORIES = ['weapon', 'armor', 'shield', 'ammo', 'consumable', 'tools', 'focus', 'clothes', 'gear', 'treasure', 'book', 'other'] as const;
export type ItemCategory = typeof ITEM_CATEGORIES[number];

export const ITEM_CATEGORY_LABELS: Record<ItemCategory, string> = {
  weapon: 'Оружие', armor: 'Доспех', shield: 'Щит', ammo: 'Боеприпасы', consumable: 'Расходник', tools: 'Инструменты',
  focus: 'Фокусировка', clothes: 'Одежда', gear: 'Снаряжение', treasure: 'Ценность', book: 'Книга', other: 'Прочее',
};

export const EQUIP_SLOTS = ['head', 'neck', 'cloak', 'body', 'main_hand', 'off_hand', 'hands', 'ring_1', 'ring_2', 'belt', 'feet', 'ammo'] as const;
export type EquipSlot = typeof EQUIP_SLOTS[number];

export const SLOT_LABELS: Record<EquipSlot, string> = {
  head: 'Голова', neck: 'Шея', cloak: 'Плечи', body: 'Тело', main_hand: 'Основная рука', off_hand: 'Вторая рука',
  hands: 'Кисти', ring_1: 'Кольцо', ring_2: 'Второе кольцо', belt: 'Пояс', feet: 'Ноги', ammo: 'Колчан',
};

export const WEAR_FAMILIES = ['head', 'neck', 'cloak', 'body', 'hand', 'hands', 'ring', 'belt', 'feet', 'ammo'] as const;
export type WearFamily = typeof WEAR_FAMILIES[number];

const FAMILY_SLOTS: Record<WearFamily, EquipSlot[]> = {
  head: ['head'], neck: ['neck'], cloak: ['cloak'], body: ['body'], hand: ['main_hand', 'off_hand'], hands: ['hands'],
  ring: ['ring_1', 'ring_2'], belt: ['belt'], feet: ['feet'], ammo: ['ammo'],
};

export type ItemRef = `gear:${string}` | `weapon:${string}`;

export type InventoryItem = {
  id: string;
  name: string;
  containerId: string | null;
  quantity: number;
  weightLb: number | null;
  priceCp: number | null;
  category: ItemCategory | null;
  srd: string | null;
  wear: WearFamily | null;
  slot: EquipSlot | null;
  grip: 'one' | 'two' | null;
  infinite: boolean;
};

const WEAR_PATTERNS: Array<[WearFamily, RegExp]> = [
  ['ring', /кольц|перстен|ring\b/iu],
  ['neck', /амулет|ожерель|медальон|подвеск|кулон|талисман|amulet|necklace|periapt|medallion/iu],
  ['cloak', /плащ|накидк|мантия|cloak|cape|mantle/iu],
  ['feet', /сапог|ботин|туфл|сандал|boots|slippers/iu],
  ['hands', /перчат|рукавиц|наруч|браслет|gloves|gauntlets|bracers/iu],
  ['belt', /пояс|кушак|belt|girdle/iu],
  ['head', /шлем|шляп|капюшон|корон|диадем|венец|обруч|очки|повязк|шапк|helm|hat|circlet|crown|goggles|headband/iu],
  ['hand', /факел|фонар|лампа|свеч|torch|lantern|lamp(?![a-z])|candle/iu],
];

export function catalogEntry(ref: string | null): CatalogEntry | null {
  return ref ? CATALOG_BY_REF.get(ref) ?? null : null;
}

export function catalogByName(name: string): CatalogEntry | null {
  return CATALOG_BY_NAME.get(name.trim().toLocaleLowerCase('ru-RU')) ?? null;
}

export function srdWeaponOf(item: Pick<InventoryItem, 'srd' | 'name'>): SrdWeapon | null {
  if (item.srd?.startsWith('weapon:')) return SRD_WEAPONS.find(weapon => weapon.index === item.srd!.slice(7)) ?? null;
  const name = item.name.trim().toLocaleLowerCase('ru-RU');
  return SRD_WEAPONS.find(weapon => weapon.nameRu.toLocaleLowerCase('ru-RU') === name) ?? null;
}

export function srdArmorOf(item: Pick<InventoryItem, 'srd' | 'name'>): NonNullable<SrdGear['armor']> | null {
  if (item.srd?.startsWith('gear:')) return SRD_GEAR.find(gear => gear.index === item.srd!.slice(5))?.armor ?? null;
  const name = item.name.trim().toLocaleLowerCase('ru-RU');
  return SRD_GEAR.find(gear => gear.armor && gear.nameRu.toLocaleLowerCase('ru-RU') === name)?.armor ?? null;
}

export function itemCategory(item: Pick<InventoryItem, 'category' | 'srd' | 'name'>): ItemCategory {
  if (item.category) return item.category;
  const entry = catalogEntry(item.srd) ?? catalogByName(item.name);
  if (entry) return entry.category;
  if (srdWeaponOf(item)) return 'weapon';
  const armor = srdArmorOf(item);
  if (armor) return armor.kind === 'shield' ? 'shield' : 'armor';
  const source = item.name.toLocaleLowerCase('ru-RU');
  if (/(^|[^а-яё])щит|shield/u.test(source)) return 'shield';
  if (/досп|кольчуг|латы|кираса|armor|armour/u.test(source)) return 'armor';
  if (/стрел|болт|снаряд|игл.*духов|arrow|bolt|bullet/u.test(source)) return 'ammo';
  if (/зель|свиток|потион|potion|scroll|эликсир/u.test(source)) return 'consumable';
  if (/книг|гримуар|дневник|book|tome/u.test(source)) return 'book';
  if (/драгоцен|самоцвет|рубин|сапфир|изумруд|алмаз|жемчуг|слиток|gem|jewel/u.test(source)) return 'treasure';
  if (WEAR_PATTERNS.some(([, pattern]) => pattern.test(source))) return 'gear';
  return 'other';
}

export function wearFamily(item: Pick<InventoryItem, 'category' | 'srd' | 'name' | 'wear'>): WearFamily | null {
  if (item.wear) return item.wear;
  const category = itemCategory(item);
  if (category === 'weapon' || category === 'shield') return 'hand';
  if (category === 'armor' || category === 'clothes') return 'body';
  if (category === 'ammo') return 'ammo';
  const source = item.name.toLocaleLowerCase('ru-RU');
  const found = WEAR_PATTERNS.find(([, pattern]) => pattern.test(source));
  if (found) return found[0];
  if (category === 'focus') return /амулет|символ|amulet|emblem/u.test(source) ? 'neck' : 'hand';
  return null;
}

export function itemSlots(item: Pick<InventoryItem, 'category' | 'srd' | 'name' | 'wear'>): EquipSlot[] {
  const family = wearFamily(item);
  if (!family) return [];
  if (itemCategory(item) === 'shield') return ['off_hand'];
  return FAMILY_SLOTS[family];
}

export function isContainer(item: Pick<InventoryItem, 'category' | 'srd' | 'name'>): boolean {
  if (itemCategory(item) === 'focus') return false;
  return /рюкзак|мешок|сумк|сундук|ящик|короб|кошел|колчан|футляр|ларец|шкатулк|backpack|sack|bag|chest|case|quiver/iu.test(item.name);
}

export function handsNeeded(item: Pick<InventoryItem, 'category' | 'srd' | 'name' | 'grip'>): 1 | 2 {
  const weapon = srdWeaponOf(item);
  if (weapon?.properties.includes('two-handed')) return 2;
  return item.grip === 'two' ? 2 : 1;
}

export function slotLabel(slot: string): string {
  return (SLOT_LABELS as Record<string, string>)[slot] ?? slot;
}

// A two-handed weapon in the main hand also takes the other hand.
export function occupiedSlots(items: InventoryItem[]): Map<EquipSlot, InventoryItem> {
  const taken = new Map<EquipSlot, InventoryItem>();
  for (const item of items) {
    if (!item.slot) continue;
    taken.set(item.slot, item);
    if ((item.slot === 'main_hand' || item.slot === 'off_hand') && handsNeeded(item) === 2) taken.set(item.slot === 'main_hand' ? 'off_hand' : 'main_hand', item);
  }
  return taken;
}

export type EquipPlan = { slot: EquipSlot; displaced: InventoryItem[] } | { error: string };

export function planEquip(item: InventoryItem, worn: InventoryItem[], wanted: EquipSlot | null): EquipPlan {
  const slots = itemSlots(item);
  if (!slots.length) return { error: `«${item.name}» не надевают: у предмета нет места на теле.` };
  const others = worn.filter(entry => entry.id !== item.id && entry.slot);
  const taken = occupiedSlots(others);
  const slot = wanted ?? slots.find(candidate => !taken.has(candidate)) ?? slots[0]!;
  if (!slots.includes(slot)) return { error: `«${item.name}» не надевают сюда: подходит ${slots.map(slotLabel).join(' или ')}.` };
  const two = (slot === 'main_hand' || slot === 'off_hand') && handsNeeded(item) === 2;
  const needed = two ? ['main_hand', 'off_hand'] as EquipSlot[] : [slot];
  const displaced = [...new Set(needed.map(entry => taken.get(entry)).filter((entry): entry is InventoryItem => Boolean(entry)))];
  return { slot, displaced };
}

export type GearAcInput = {
  worn: InventoryItem[];
  dexterity: number;
  constitution: number;
  wisdom: number;
  classes: ClassLevel[];
  defenseStyle: boolean;
};

export type GearAc = { value: number; parts: string[]; armor: string | null; shield: string | null };

const mod = (score: number) => Math.floor((score - 10) / 2);

export function gearArmorClass({ worn, dexterity, constitution, wisdom, classes, defenseStyle }: GearAcInput): GearAc {
  const bodyItem = worn.find(item => item.slot === 'body' && srdArmorOf(item) && srdArmorOf(item)!.kind !== 'shield') ?? null;
  const shieldItem = worn.find(item => item.slot === 'off_hand' && itemCategory(item) === 'shield') ?? null;
  const armor = bodyItem ? srdArmorOf(bodyItem) : null;
  const dex = mod(dexterity);
  const parts: string[] = [];
  let value: number;
  if (armor) {
    const bonus = armor.dex === 'full' ? dex : armor.dex === 'max2' ? Math.min(2, dex) : 0;
    value = armor.ac + bonus;
    parts.push(`${bodyItem!.name} ${armor.ac}${bonus ? ` ${bonus > 0 ? '+' : '−'}${Math.abs(bonus)} Лов` : ''}`);
  } else {
    const unarmored = unarmoredDefense(classes, { dexterity, constitution, wisdom });
    const usable = unarmored && (unarmored.shield || !shieldItem) ? unarmored : null;
    value = usable ? usable.ac : 10 + dex;
    parts.push(usable ? `защита без доспехов ${usable.ac}` : `без доспеха 10 ${dex >= 0 ? '+' : '−'} ${Math.abs(dex)} Лов`);
  }
  if (shieldItem) {
    value += 2;
    parts.push(`${shieldItem.name} +2`);
  }
  if (armor && defenseStyle) {
    value += 1;
    parts.push('боевой стиль «Защита» +1');
  }
  return { value, parts, armor: bodyItem?.name ?? null, shield: shieldItem?.name ?? null };
}

export function heavyArmorSlow(worn: InventoryItem[], strength: number): number {
  const body = worn.find(item => item.slot === 'body');
  const armor = body ? srdArmorOf(body) : null;
  return armor?.strength && strength < armor.strength ? 10 : 0;
}

export type Encumbrance = {
  pounds: number;
  unknown: number;
  capacity: number;
  level: 'light' | 'loaded' | 'heavy' | 'over';
  penalty: number;
  thresholds: [number, number, number];
};

const SIZE_FACTOR: Record<string, number> = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 4, gargantuan: 8 };

export function carriedWeight(rootId: string, items: Array<Pick<InventoryItem, 'id' | 'containerId' | 'quantity' | 'weightLb'>>, coins = 0) {
  const children = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.containerId) continue;
    children.set(item.containerId, [...(children.get(item.containerId) ?? []), item]);
  }
  let pounds = coins / 50;
  let unknown = 0;
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (depth > 8) return;
    for (const item of children.get(id) ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (item.weightLb === null) unknown += 1;
      else pounds += item.weightLb * Math.max(0, item.quantity);
      walk(item.id, depth + 1);
    }
  };
  walk(rootId, 0);
  return { pounds: Math.round(pounds * 100) / 100, unknown };
}

export function encumbrance(pounds: number, unknown: number, strength: number, size: string | null): Encumbrance {
  const unit = Math.max(1, strength) * (SIZE_FACTOR[size ?? 'medium'] ?? 1);
  const thresholds: [number, number, number] = [unit * 5, unit * 10, unit * 15];
  const level = pounds > thresholds[2] ? 'over' : pounds > thresholds[1] ? 'heavy' : pounds > thresholds[0] ? 'loaded' : 'light';
  return { pounds, unknown, capacity: thresholds[2], level, penalty: level === 'loaded' ? 10 : level === 'heavy' ? 20 : 0, thresholds };
}

export function encumberedSpeed(feet: number, load: Pick<Encumbrance, 'level' | 'penalty'>): number {
  if (feet <= 0) return feet;
  if (load.level === 'over') return Math.min(feet, 5);
  return Math.max(0, feet - load.penalty);
}

export const ENCUMBRANCE_LABELS: Record<Encumbrance['level'], string> = {
  light: 'Лёгкая нагрузка', loaded: 'Нагрузка', heavy: 'Тяжёлая нагрузка', over: 'Перегрузка',
};

export type AmmoKind = 'arrow' | 'bolt' | 'bullet' | 'needle';

const WEAPON_AMMO: Record<string, AmmoKind> = {
  shortbow: 'arrow', longbow: 'arrow', 'crossbow-light': 'bolt', 'crossbow-hand': 'bolt', 'crossbow-heavy': 'bolt', sling: 'bullet', blowgun: 'needle',
};

export function weaponAmmo(weapon: { srd_index?: string | null; name: string; properties?: unknown }): AmmoKind | null {
  const properties = Array.isArray(weapon.properties) ? weapon.properties as string[] : [];
  const srd = weapon.srd_index ?? SRD_WEAPONS.find(entry => entry.nameRu.toLocaleLowerCase('ru-RU') === weapon.name.trim().toLocaleLowerCase('ru-RU'))?.index ?? null;
  if (srd && WEAPON_AMMO[srd]) return WEAPON_AMMO[srd]!;
  if (!properties.includes('ammunition')) return null;
  const name = weapon.name.toLocaleLowerCase('ru-RU');
  if (/арбалет|crossbow/u.test(name)) return 'bolt';
  if (/пращ|sling/u.test(name)) return 'bullet';
  if (/духов|blowgun/u.test(name)) return 'needle';
  return 'arrow';
}

export function itemAmmo(item: Pick<InventoryItem, 'name' | 'srd' | 'category'>): AmmoKind | null {
  if (item.srd === 'gear:arrows-20') return 'arrow';
  if (item.srd === 'gear:crossbow-bolts-20') return 'bolt';
  if (item.srd === 'gear:sling-bullets-20') return 'bullet';
  if (item.srd === 'gear:blowgun-needles-50') return 'needle';
  const name = item.name.toLocaleLowerCase('ru-RU');
  if (/болт|bolt/u.test(name)) return 'bolt';
  if (/снаряд.*пращ|пул[ья]|bullet/u.test(name)) return 'bullet';
  if (/игл|needle/u.test(name)) return 'needle';
  if (/стрел|arrow/u.test(name)) return 'arrow';
  return null;
}

export const AMMO_LABELS: Record<AmmoKind, string> = { arrow: 'Стрелы', bolt: 'Болты', bullet: 'Снаряды', needle: 'Иглы' };

export type CatalogEntry = {
  ref: ItemRef;
  nameRu: string;
  name: string;
  category: ItemCategory;
  pack: number;
  priceCp: number | null;
  weightLb: number | null;
  desc: string | null;
  armor: SrdGear['armor'] | null;
  weapon: SrdWeapon | null;
};

const gp = (value: number) => Math.round(value * 100);
const sp = (value: number) => value * 10;

// SRD 5.1 weapon table: cost in copper, weight in pounds.
const WEAPON_PRICES: Record<string, [number, number]> = {
  club: [sp(1), 2], dagger: [gp(2), 1], greatclub: [sp(2), 10], handaxe: [gp(5), 2], javelin: [sp(5), 2], 'light-hammer': [gp(2), 2],
  mace: [gp(5), 4], quarterstaff: [sp(2), 4], sickle: [gp(1), 2], spear: [gp(1), 3], 'crossbow-light': [gp(25), 5], dart: [5, 0.25],
  shortbow: [gp(25), 2], sling: [sp(1), 0], battleaxe: [gp(10), 4], flail: [gp(10), 2], glaive: [gp(20), 6], greataxe: [gp(30), 7],
  greatsword: [gp(50), 6], halberd: [gp(20), 6], lance: [gp(10), 6], longsword: [gp(15), 3], maul: [gp(10), 10], morningstar: [gp(15), 4],
  pike: [gp(5), 18], rapier: [gp(25), 2], scimitar: [gp(25), 3], shortsword: [gp(10), 2], trident: [gp(5), 4], 'war-pick': [gp(5), 2],
  warhammer: [gp(15), 2], whip: [gp(2), 3], blowgun: [gp(10), 1], 'crossbow-hand': [gp(75), 3], 'crossbow-heavy': [gp(50), 18],
  longbow: [gp(50), 2], net: [gp(1), 3],
};

function gearCategory(gear: SrdGear): ItemCategory {
  if (gear.armor) return gear.armor.kind === 'shield' ? 'shield' : 'armor';
  if (gear.index === 'spellbook') return 'book';
  return gear.category === 'gear' ? 'gear' : gear.category;
}

const PACK = /\s*\((?:[^)]*?,\s*)?(\d+)\)$/u;
const PACK_NAMES: Record<string, string> = {
  'arrows-20': 'Стрелы', 'crossbow-bolts-20': 'Арбалетные болты', 'sling-bullets-20': 'Снаряды для пращи', 'caltrops-bag-of-20': 'Колтропы',
};

export const INVENTORY_CATALOG: CatalogEntry[] = [
  ...SRD_GEAR.map(gear => {
    const pack = gear.category === 'ammo' || gear.index === 'caltrops-bag-of-20' ? Number(PACK.exec(gear.nameRu)?.[1] ?? 1) : 1;
    return {
      ref: `gear:${gear.index}` as ItemRef, nameRu: pack > 1 ? PACK_NAMES[gear.index] ?? gear.nameRu.replace(PACK, '') : gear.nameRu, name: gear.index,
      category: gearCategory(gear), pack, priceCp: gear.priceCp, weightLb: gear.weightLb, desc: gear.desc ?? null, armor: gear.armor ?? null, weapon: null,
    };
  }),
  ...SRD_WEAPONS.map(weapon => ({
    ref: `weapon:${weapon.index}` as ItemRef, nameRu: weapon.nameRu, name: weapon.name, category: 'weapon' as const, pack: 1,
    priceCp: WEAPON_PRICES[weapon.index]?.[0] ?? null, weightLb: WEAPON_PRICES[weapon.index]?.[1] ?? null, desc: null, armor: null, weapon,
  })),
];

const CATALOG_BY_REF = new Map(INVENTORY_CATALOG.map(entry => [entry.ref as string, entry]));
const CATALOG_BY_NAME = new Map(INVENTORY_CATALOG.flatMap(entry => {
  const names = [entry.nameRu];
  const gear = entry.ref.startsWith('gear:') ? SRD_GEAR.find(item => `gear:${item.index}` === entry.ref) : null;
  if (gear && gear.nameRu !== entry.nameRu) names.push(gear.nameRu);
  return names.map(name => [name.toLocaleLowerCase('ru-RU'), entry] as const);
}));

export function unitPrice(entry: Pick<CatalogEntry, 'priceCp' | 'pack'>): number | null {
  return entry.priceCp === null ? null : entry.priceCp / Math.max(1, entry.pack);
}

export function unitWeight(entry: Pick<CatalogEntry, 'weightLb' | 'pack'>): number | null {
  return entry.weightLb === null ? null : entry.weightLb / Math.max(1, entry.pack);
}

export function stackable(item: Pick<InventoryItem, 'category' | 'srd' | 'name'>): boolean {
  const category = itemCategory(item);
  return category === 'ammo' || category === 'consumable' || category === 'treasure' || category === 'gear' && /рацион|факел|свеч|шлямбур|колтроп|бумаг|ration|torch|candle|piton/iu.test(item.name);
}

export type DollPoint = { x: number; y: number; size: number; hidden: boolean };
export type DollPreset = 'humanoid' | 'beast' | 'list';
export type Doll = { preset: DollPreset; dim: number; points: Partial<Record<EquipSlot, DollPoint>> };

const HUMANOID: Record<EquipSlot, [number, number]> = {
  head: [0.5, 0.1], neck: [0.5, 0.24], cloak: [0.78, 0.22], body: [0.5, 0.42], main_hand: [0.14, 0.52], off_hand: [0.86, 0.52],
  hands: [0.14, 0.68], ring_1: [0.1, 0.82], ring_2: [0.9, 0.82], belt: [0.5, 0.6], feet: [0.5, 0.92], ammo: [0.86, 0.68],
};
const BEAST: Partial<Record<EquipSlot, [number, number]>> = {
  head: [0.24, 0.24], neck: [0.34, 0.4], body: [0.58, 0.46], cloak: [0.62, 0.28], belt: [0.62, 0.62], feet: [0.5, 0.88],
};

export function presetDoll(preset: DollPreset): Doll {
  if (preset === 'list') return { preset, dim: 0.35, points: {} };
  const source = preset === 'beast' ? BEAST : HUMANOID;
  const points: Partial<Record<EquipSlot, DollPoint>> = {};
  for (const slot of EQUIP_SLOTS) {
    const at = source[slot];
    points[slot] = at ? { x: at[0], y: at[1], size: 1, hidden: false } : { x: 0.5, y: 0.5, size: 1, hidden: true };
  }
  return { preset, dim: 0.35, points };
}

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function normalizeDoll(raw: unknown, kind: string): Doll {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, any> : null;
  const preset: DollPreset = value && ['humanoid', 'beast', 'list'].includes(value.preset) ? value.preset : kind === 'object' ? 'list' : 'humanoid';
  const base = presetDoll(preset);
  if (!value) return base;
  const points: Partial<Record<EquipSlot, DollPoint>> = {};
  for (const slot of EQUIP_SLOTS) {
    const given = value.points?.[slot];
    const fallback = base.points[slot] ?? { x: 0.5, y: 0.5, size: 1, hidden: true };
    points[slot] = given && typeof given === 'object'
      ? { x: clamp(given.x, 0, 1, fallback.x), y: clamp(given.y, 0, 1, fallback.y), size: clamp(given.size, 0.7, 1.6, 1), hidden: given.hidden === true }
      : fallback;
  }
  return { preset, dim: clamp(value.dim, 0, 0.8, 0.35), points };
}
