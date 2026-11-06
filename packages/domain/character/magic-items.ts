import { abilityModifier } from '../dice/dice.ts';

export const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const;
export type Ability = typeof ABILITIES[number];

export const ABILITY_LABELS: Record<Ability, string> = {
  strength: 'Сила', dexterity: 'Ловкость', constitution: 'Телосложение',
  intelligence: 'Интеллект', wisdom: 'Мудрость', charisma: 'Харизма',
};

export const RARITIES = ['common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact'] as const;
export type Rarity = typeof RARITIES[number];
export const RARITY_LABELS: Record<Rarity, string> = {
  common: 'обычный', uncommon: 'необычный', rare: 'редкий', very_rare: 'очень редкий', legendary: 'легендарный', artifact: 'артефакт',
};

export const MAGIC_ITEM_PRICE_GP: Record<Rarity, number | null> = {
  common: 100, uncommon: 400, rare: 4000, very_rare: 40000, legendary: 100000, artifact: null,
};

export function magicItemPriceCp(rarity: string | null | undefined): number | null {
  const gold = rarity && (RARITIES as readonly string[]).includes(rarity) ? MAGIC_ITEM_PRICE_GP[rarity as Rarity] : null;
  return gold === null ? null : gold * 100;
}

export const DAMAGE_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
] as const;
const DAMAGE_RU: Record<string, string> = {
  acid: 'кислота', bludgeoning: 'дробящий', cold: 'холод', fire: 'огонь', force: 'силовое поле', lightning: 'электричество',
  necrotic: 'некротическая энергия', piercing: 'колющий', poison: 'яд', psychic: 'психическая энергия', radiant: 'излучение',
  slashing: 'рубящий', thunder: 'звук',
};

export const ATTUNEMENT_LIMIT = 3;

export type Recharge = 'dawn' | 'short' | 'long';
export const RECHARGE_LABELS: Record<Recharge, string> = { dawn: 'на рассвете', short: 'после короткого отдыха', long: 'после долгого отдыха' };

export type MagicBonuses = {
  armorClass?: number;
  saves?: number;
  abilities?: Partial<Record<Ability, number>>;
  speed?: number;
  resistances?: string[];
};

export type AppliedBonuses = {
  characterId: string;
  armorClass: number;
  saves: number;
  abilities: Partial<Record<Ability, number>>;
  speed: number;
  resistances: string[];
  hpMax: number;
};

export function bonusProblems(bonuses: MagicBonuses): string[] {
  const problems: string[] = [];
  const integer = (value: unknown, min: number, max: number) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
  if (bonuses.armorClass !== undefined && !integer(bonuses.armorClass, -5, 10)) problems.push('Прибавка к КД — от −5 до 10.');
  if (bonuses.saves !== undefined && !integer(bonuses.saves, -5, 10)) problems.push('Прибавка к спасброскам — от −5 до 10.');
  if (bonuses.speed !== undefined && !integer(bonuses.speed, -30, 120)) problems.push('Прибавка к скорости — от −30 до 120 футов.');
  for (const [ability, value] of Object.entries(bonuses.abilities ?? {})) {
    if (!(ABILITIES as readonly string[]).includes(ability)) problems.push(`Неизвестная характеристика «${ability}».`);
    else if (!integer(value, 1, 30)) problems.push(`${ABILITY_LABELS[ability as Ability]}: значение — от 1 до 30.`);
  }
  for (const type of bonuses.resistances ?? []) {
    if (!(DAMAGE_TYPES as readonly string[]).includes(type)) problems.push(`Неизвестный тип урона «${type}».`);
  }
  return problems;
}

const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));

export function bonusText(bonuses: MagicBonuses): string {
  const parts: string[] = [];
  if (bonuses.armorClass) parts.push(`КД ${signed(bonuses.armorClass)}`);
  if (bonuses.saves) parts.push(`спасброски ${signed(bonuses.saves)}`);
  for (const ability of ABILITIES) {
    const value = bonuses.abilities?.[ability];
    if (value) parts.push(`${ABILITY_LABELS[ability]} ${value}`);
  }
  if (bonuses.speed) parts.push(`скорость ${signed(bonuses.speed)} фут.`);
  if (bonuses.resistances?.length) parts.push(`сопротивление: ${bonuses.resistances.map(type => DAMAGE_RU[type] ?? type).join(', ')}`);
  return parts.join(', ');
}

export function itemActive(item: {
  destroyed: boolean; equipped: boolean; requiresAttunement: boolean; attunedTo: string | null;
  holderId: string | null; holderIsCreature: boolean;
}): boolean {
  if (item.destroyed || !item.equipped || !item.holderId || !item.holderIsCreature) return false;
  return !item.requiresAttunement || item.attunedTo === item.holderId;
}

export type SheetNumbers = {
  armorClass: number;
  speed: number;
  abilities: Record<Ability, number>;
  resistances: string[];
  hpMax: number;
  hpCurrent: number;
  level: number | null;
};

export function applyBonuses(sheet: SheetNumbers, bonuses: MagicBonuses, characterId: string): { sheet: SheetNumbers; applied: AppliedBonuses } {
  const abilities = { ...sheet.abilities };
  const added: Partial<Record<Ability, number>> = {};
  for (const ability of ABILITIES) {
    const target = bonuses.abilities?.[ability];
    if (!target) continue;
    const delta = Math.max(0, Math.min(30, target) - abilities[ability]);
    if (delta > 0) {
      abilities[ability] += delta;
      added[ability] = delta;
    }
  }
  const hpMax = (abilityModifier(abilities.constitution) - abilityModifier(sheet.abilities.constitution)) * Math.max(1, sheet.level ?? 1);
  const resistances = (bonuses.resistances ?? []).filter(type => !sheet.resistances.includes(type));
  const armorClass = bonuses.armorClass ?? 0;
  const speed = bonuses.speed ?? 0;
  return {
    sheet: {
      ...sheet,
      armorClass: sheet.armorClass + armorClass,
      speed: Math.max(0, sheet.speed + speed),
      abilities,
      resistances: [...sheet.resistances, ...resistances],
      hpMax: sheet.hpMax + hpMax,
      hpCurrent: sheet.hpCurrent + Math.max(0, hpMax),
    },
    applied: { characterId, armorClass, saves: bonuses.saves ?? 0, abilities: added, speed, resistances, hpMax },
  };
}

export function revertBonuses(sheet: SheetNumbers, applied: AppliedBonuses): SheetNumbers {
  const abilities = { ...sheet.abilities };
  for (const ability of ABILITIES) {
    const delta = applied.abilities?.[ability];
    if (delta) abilities[ability] = Math.max(1, abilities[ability] - delta);
  }
  const hpMax = Math.max(0, sheet.hpMax - (applied.hpMax ?? 0));
  return {
    ...sheet,
    armorClass: sheet.armorClass - (applied.armorClass ?? 0),
    speed: Math.max(0, sheet.speed - (applied.speed ?? 0)),
    abilities,
    resistances: sheet.resistances.filter(type => !(applied.resistances ?? []).includes(type)),
    hpMax,
    hpCurrent: Math.min(sheet.hpCurrent, hpMax),
  };
}

export function dawnCount(worldMinutes: number): number {
  return worldMinutes < 360 ? 0 : Math.floor((worldMinutes - 360) / 1440) + 1;
}

export type SrdMagicItem = {
  index: string;
  name: string;
  nameRu: string;
  rarity: Rarity;
  attunement: boolean;
  charges?: { max: number; recharge: Recharge; formula?: string; destroyOnEmpty?: boolean };
  bonuses?: MagicBonuses;
  description: string;
};

export const SRD_MAGIC_ITEMS: SrdMagicItem[] = [
  {
    index: 'wand-of-magic-missiles', name: 'Wand of Magic Missiles', nameRu: 'Палочка волшебных стрел', rarity: 'uncommon', attunement: false,
    charges: { max: 7, recharge: 'dawn', formula: '1d6+1', destroyOnEmpty: true },
    description: 'Действием потратить от 1 до 3 зарядов и сотворить «Волшебную стрелу»: 1 заряд — заклинание 1-го уровня, каждый следующий — на уровень выше. На рассвете восстанавливает 1d6+1 заряд. Потрачен последний — к20: на 1 палочка рассыпается в прах.',
  },
  {
    index: 'wand-of-web', name: 'Wand of Web', nameRu: 'Палочка паутины', rarity: 'uncommon', attunement: true,
    charges: { max: 7, recharge: 'dawn', formula: '1d6+1', destroyOnEmpty: true },
    description: 'Настройка — заклинатель. Действием потратить 1 заряд и сотворить «Паутину» (СЛ спасброска 15). На рассвете восстанавливает 1d6+1 заряд. Потрачен последний — к20: на 1 палочка рассыпается в прах.',
  },
  {
    index: 'staff-of-healing', name: 'Staff of Healing', nameRu: 'Посох лечения', rarity: 'rare', attunement: true,
    charges: { max: 10, recharge: 'dawn', formula: '1d6+4', destroyOnEmpty: true },
    description: 'Настройка — бард, жрец или друид. Действием потратить заряды и сотворить: «Лечение ран» (1 заряд за уровень ячейки, до 4-го), «Восстановление» (2 заряда), «Лечение ран массовое» (5 зарядов). На рассвете восстанавливает 1d6+4 заряда. Потрачен последний — к20: на 1 посох исчезает во вспышке света.',
  },
  {
    index: 'ring-of-protection', name: 'Ring of Protection', nameRu: 'Кольцо защиты', rarity: 'rare', attunement: true,
    bonuses: { armorClass: 1, saves: 1 }, description: '+1 к КД и спасброскам, пока кольцо надето.',
  },
  {
    index: 'cloak-of-protection', name: 'Cloak of Protection', nameRu: 'Плащ защиты', rarity: 'uncommon', attunement: true,
    bonuses: { armorClass: 1, saves: 1 }, description: '+1 к КД и спасброскам, пока плащ надет.',
  },
  {
    index: 'bracers-of-defense', name: 'Bracers of Defense', nameRu: 'Наручи защиты', rarity: 'rare', attunement: true,
    bonuses: { armorClass: 2 }, description: '+2 к КД, если на вас нет доспеха и вы не держите щит.',
  },
  {
    index: 'gauntlets-of-ogre-power', name: 'Gauntlets of Ogre Power', nameRu: 'Перчатки силы огра', rarity: 'uncommon', attunement: true,
    bonuses: { abilities: { strength: 19 } }, description: 'Сила становится 19, если она была меньше.',
  },
  {
    index: 'headband-of-intellect', name: 'Headband of Intellect', nameRu: 'Обруч интеллекта', rarity: 'uncommon', attunement: true,
    bonuses: { abilities: { intelligence: 19 } }, description: 'Интеллект становится 19, если он был меньше.',
  },
  {
    index: 'amulet-of-health', name: 'Amulet of Health', nameRu: 'Амулет здоровья', rarity: 'rare', attunement: true,
    bonuses: { abilities: { constitution: 19 } }, description: 'Телосложение становится 19, если оно было меньше (максимум хитов растёт вместе с ним).',
  },
  {
    index: 'ring-of-resistance', name: 'Ring of Resistance', nameRu: 'Кольцо сопротивления (огонь)', rarity: 'rare', attunement: true,
    bonuses: { resistances: ['fire'] }, description: 'Сопротивление одному типу урона, пока кольцо надето (по камню; здесь — огонь, мастер может сменить).',
  },
  {
    index: 'armor-plus-1', name: 'Armor, +1', nameRu: 'Доспех +1', rarity: 'rare', attunement: false,
    bonuses: { armorClass: 1 }, description: '+1 к КД сверх обычного доспеха, пока он надет.',
  },
  {
    index: 'boots-of-striding-and-springing', name: 'Boots of Striding and Springing', nameRu: 'Сапоги ходьбы и прыжков', rarity: 'uncommon', attunement: true,
    bonuses: { speed: 10 }, description: 'Скорость ходьбы не меньше 30 футов (здесь — +10 футов; поправьте под персонажа), прыжки втрое дальше.',
  },
];
