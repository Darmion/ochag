export type SrdWeaponProperty =
  | 'ammunition' | 'finesse' | 'heavy' | 'light' | 'loading' | 'reach' | 'special' | 'thrown' | 'two-handed' | 'versatile';

export type SrdWeapon = {
  index: string;
  name: string;
  nameRu: string;
  category: 'simple' | 'martial';
  kind: 'melee' | 'ranged';
  damage: string | null;
  damageType: 'bludgeoning' | 'piercing' | 'slashing' | null;
  properties: SrdWeaponProperty[];
  range?: [number, number];
  versatile?: string;
};

export const SRD_WEAPONS: SrdWeapon[] = [
  { index: 'club', name: 'Club', nameRu: 'Дубинка', category: 'simple', kind: 'melee', damage: '1d4', damageType: 'bludgeoning', properties: ['light'] },
  { index: 'dagger', name: 'Dagger', nameRu: 'Кинжал', category: 'simple', kind: 'melee', damage: '1d4', damageType: 'piercing', properties: ['finesse', 'light', 'thrown'], range: [20, 60] },
  { index: 'greatclub', name: 'Greatclub', nameRu: 'Палица', category: 'simple', kind: 'melee', damage: '1d8', damageType: 'bludgeoning', properties: ['two-handed'] },
  { index: 'handaxe', name: 'Handaxe', nameRu: 'Ручной топор', category: 'simple', kind: 'melee', damage: '1d6', damageType: 'slashing', properties: ['light', 'thrown'], range: [20, 60] },
  { index: 'javelin', name: 'Javelin', nameRu: 'Метательное копьё', category: 'simple', kind: 'melee', damage: '1d6', damageType: 'piercing', properties: ['thrown'], range: [30, 120] },
  { index: 'light-hammer', name: 'Light hammer', nameRu: 'Лёгкий молот', category: 'simple', kind: 'melee', damage: '1d4', damageType: 'bludgeoning', properties: ['light', 'thrown'], range: [20, 60] },
  { index: 'mace', name: 'Mace', nameRu: 'Булава', category: 'simple', kind: 'melee', damage: '1d6', damageType: 'bludgeoning', properties: [] },
  { index: 'quarterstaff', name: 'Quarterstaff', nameRu: 'Боевой посох', category: 'simple', kind: 'melee', damage: '1d6', damageType: 'bludgeoning', properties: ['versatile'], versatile: '1d8' },
  { index: 'sickle', name: 'Sickle', nameRu: 'Серп', category: 'simple', kind: 'melee', damage: '1d4', damageType: 'slashing', properties: ['light'] },
  { index: 'spear', name: 'Spear', nameRu: 'Копьё', category: 'simple', kind: 'melee', damage: '1d6', damageType: 'piercing', properties: ['thrown', 'versatile'], range: [20, 60], versatile: '1d8' },
  { index: 'crossbow-light', name: 'Crossbow, light', nameRu: 'Лёгкий арбалет', category: 'simple', kind: 'ranged', damage: '1d8', damageType: 'piercing', properties: ['ammunition', 'loading', 'two-handed'], range: [80, 320] },
  { index: 'dart', name: 'Dart', nameRu: 'Дротик', category: 'simple', kind: 'ranged', damage: '1d4', damageType: 'piercing', properties: ['finesse', 'thrown'], range: [20, 60] },
  { index: 'shortbow', name: 'Shortbow', nameRu: 'Короткий лук', category: 'simple', kind: 'ranged', damage: '1d6', damageType: 'piercing', properties: ['ammunition', 'two-handed'], range: [80, 320] },
  { index: 'sling', name: 'Sling', nameRu: 'Праща', category: 'simple', kind: 'ranged', damage: '1d4', damageType: 'bludgeoning', properties: ['ammunition'], range: [30, 120] },
  { index: 'battleaxe', name: 'Battleaxe', nameRu: 'Боевой топор', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'slashing', properties: ['versatile'], versatile: '1d10' },
  { index: 'flail', name: 'Flail', nameRu: 'Цеп', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'bludgeoning', properties: [] },
  { index: 'glaive', name: 'Glaive', nameRu: 'Глефа', category: 'martial', kind: 'melee', damage: '1d10', damageType: 'slashing', properties: ['heavy', 'reach', 'two-handed'] },
  { index: 'greataxe', name: 'Greataxe', nameRu: 'Секира', category: 'martial', kind: 'melee', damage: '1d12', damageType: 'slashing', properties: ['heavy', 'two-handed'] },
  { index: 'greatsword', name: 'Greatsword', nameRu: 'Двуручный меч', category: 'martial', kind: 'melee', damage: '2d6', damageType: 'slashing', properties: ['heavy', 'two-handed'] },
  { index: 'halberd', name: 'Halberd', nameRu: 'Алебарда', category: 'martial', kind: 'melee', damage: '1d10', damageType: 'slashing', properties: ['heavy', 'reach', 'two-handed'] },
  { index: 'lance', name: 'Lance', nameRu: 'Кавалерийское копьё', category: 'martial', kind: 'melee', damage: '1d12', damageType: 'piercing', properties: ['reach', 'special'] },
  { index: 'longsword', name: 'Longsword', nameRu: 'Длинный меч', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'slashing', properties: ['versatile'], versatile: '1d10' },
  { index: 'maul', name: 'Maul', nameRu: 'Молот', category: 'martial', kind: 'melee', damage: '2d6', damageType: 'bludgeoning', properties: ['heavy', 'two-handed'] },
  { index: 'morningstar', name: 'Morningstar', nameRu: 'Моргенштерн', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'piercing', properties: [] },
  { index: 'pike', name: 'Pike', nameRu: 'Пика', category: 'martial', kind: 'melee', damage: '1d10', damageType: 'piercing', properties: ['heavy', 'reach', 'two-handed'] },
  { index: 'rapier', name: 'Rapier', nameRu: 'Рапира', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'piercing', properties: ['finesse'] },
  { index: 'scimitar', name: 'Scimitar', nameRu: 'Скимитар', category: 'martial', kind: 'melee', damage: '1d6', damageType: 'slashing', properties: ['finesse', 'light'] },
  { index: 'shortsword', name: 'Shortsword', nameRu: 'Короткий меч', category: 'martial', kind: 'melee', damage: '1d6', damageType: 'piercing', properties: ['finesse', 'light'] },
  { index: 'trident', name: 'Trident', nameRu: 'Трезубец', category: 'martial', kind: 'melee', damage: '1d6', damageType: 'piercing', properties: ['thrown', 'versatile'], range: [20, 60], versatile: '1d8' },
  { index: 'war-pick', name: 'War pick', nameRu: 'Боевая кирка', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'piercing', properties: [] },
  { index: 'warhammer', name: 'Warhammer', nameRu: 'Боевой молот', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'bludgeoning', properties: ['versatile'], versatile: '1d10' },
  { index: 'whip', name: 'Whip', nameRu: 'Кнут', category: 'martial', kind: 'melee', damage: '1d4', damageType: 'slashing', properties: ['finesse', 'reach'] },
  { index: 'blowgun', name: 'Blowgun', nameRu: 'Духовая трубка', category: 'martial', kind: 'ranged', damage: '1d1', damageType: 'piercing', properties: ['ammunition', 'loading'], range: [25, 100] },
  { index: 'crossbow-hand', name: 'Crossbow, hand', nameRu: 'Ручной арбалет', category: 'martial', kind: 'ranged', damage: '1d6', damageType: 'piercing', properties: ['ammunition', 'light', 'loading'], range: [30, 120] },
  { index: 'crossbow-heavy', name: 'Crossbow, heavy', nameRu: 'Тяжёлый арбалет', category: 'martial', kind: 'ranged', damage: '1d10', damageType: 'piercing', properties: ['ammunition', 'heavy', 'loading', 'two-handed'], range: [100, 400] },
  { index: 'longbow', name: 'Longbow', nameRu: 'Длинный лук', category: 'martial', kind: 'ranged', damage: '1d8', damageType: 'piercing', properties: ['ammunition', 'heavy', 'two-handed'], range: [150, 600] },
  { index: 'net', name: 'Net', nameRu: 'Сеть', category: 'martial', kind: 'ranged', damage: null, damageType: null, properties: ['special', 'thrown'], range: [5, 15] },
];

export function srdWeaponFields(weapon: SrdWeapon) {
  const melee = weapon.kind === 'melee';
  return {
    name: weapon.nameRu,
    ability: weapon.properties.includes('finesse') ? 'finesse' : melee ? 'strength' : 'dexterity',
    damageFormula: weapon.damage ? `${weapon.damage}+@mod` : null,
    damageType: weapon.damageType,
    weaponKind: weapon.kind,
    rangeFeet: melee ? (weapon.properties.includes('reach') ? 10 : 5) : weapon.range?.[0] ?? 80,
    longRangeFeet: weapon.range?.[1] ?? null,
    thrownRangeFeet: melee && weapon.properties.includes('thrown') ? weapon.range?.[0] ?? null : null,
    versatileFormula: weapon.versatile ? `${weapon.versatile}+@mod` : null,
    properties: weapon.properties,
    srdIndex: weapon.index,
  } as const;
}

export function findSrdWeapon(index: string) {
  return SRD_WEAPONS.find(weapon => weapon.index === index);
}
