import { abilityModifier } from '../dice/dice.ts';
import { SRD_MAGIC_ITEM_LIST, type SrdMagicItem } from '../srd/magic-items/index.ts';

export type { SrdMagicItem } from '../srd/magic-items/index.ts';
export type { ItemEffect, ItemSpell, ItemUse, MagicItemKind } from '../srd/magic-items/types.ts';

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
  slashing: 'рубящий', thunder: 'звук', nonmagical: 'немагическое оружие',
};

export const ATTUNEMENT_LIMIT = 3;

export type Recharge = 'dawn' | 'short' | 'long';
export const RECHARGE_LABELS: Record<Recharge, string> = { dawn: 'на рассвете', short: 'после короткого отдыха', long: 'после долгого отдыха' };

export type MagicBonuses = {
  armorClass?: number;
  saves?: number;
  abilities?: Partial<Record<Ability, number>>;
  abilityRaise?: Partial<Record<Ability, number>>;
  speed?: number;
  resistances?: string[];
  immunities?: string[];
  spellAttack?: number;
  spellDc?: number;
  weapon?: number;
};

export const ABILITY_RAISE_MAX = 20;

export type AppliedBonuses = {
  characterId: string;
  armorClass: number;
  saves: number;
  abilities: Partial<Record<Ability, number>>;
  speed: number;
  resistances: string[];
  hpMax: number;
  immunities?: string[];
  spellAttack?: number;
  spellDc?: number;
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
  for (const [ability, value] of Object.entries(bonuses.abilityRaise ?? {})) {
    if (!(ABILITIES as readonly string[]).includes(ability)) problems.push(`Неизвестная характеристика «${ability}».`);
    else if (!integer(value, 1, 10)) problems.push(`${ABILITY_LABELS[ability as Ability]}: прибавка — от 1 до 10.`);
  }
  for (const type of [...(bonuses.resistances ?? []), ...(bonuses.immunities ?? [])]) {
    if (type !== 'nonmagical' && !(DAMAGE_TYPES as readonly string[]).includes(type)) problems.push(`Неизвестный тип урона «${type}».`);
  }
  if (bonuses.spellAttack !== undefined && !integer(bonuses.spellAttack, -5, 10)) problems.push('Прибавка к атаке заклинаниями — от −5 до 10.');
  if (bonuses.spellDc !== undefined && !integer(bonuses.spellDc, -5, 10)) problems.push('Прибавка к СЛ заклинаний — от −5 до 10.');
  if (bonuses.weapon !== undefined && !integer(bonuses.weapon, -5, 10)) problems.push('Бонус оружия — от −5 до 10.');
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
  for (const ability of ABILITIES) {
    const value = bonuses.abilityRaise?.[ability];
    if (value) parts.push(`${ABILITY_LABELS[ability]} ${signed(value)} (до ${ABILITY_RAISE_MAX})`);
  }
  if (bonuses.speed) parts.push(`скорость ${signed(bonuses.speed)} фут.`);
  if (bonuses.weapon) parts.push(`атака и урон ${signed(bonuses.weapon)}`);
  if (bonuses.spellAttack) parts.push(`атака заклинаниями ${signed(bonuses.spellAttack)}`);
  if (bonuses.spellDc) parts.push(`СЛ заклинаний ${signed(bonuses.spellDc)}`);
  if (bonuses.resistances?.length) parts.push(`сопротивление: ${bonuses.resistances.map(type => DAMAGE_RU[type] ?? type).join(', ')}`);
  if (bonuses.immunities?.length) parts.push(`иммунитет: ${bonuses.immunities.map(type => DAMAGE_RU[type] ?? type).join(', ')}`);
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
  immunities?: string[];
  spellBonus?: { attack: number; dc: number };
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
  for (const ability of ABILITIES) {
    const raise = bonuses.abilityRaise?.[ability];
    if (!raise) continue;
    const delta = Math.max(0, Math.min(ABILITY_RAISE_MAX, abilities[ability] + raise) - abilities[ability]);
    if (delta > 0) {
      abilities[ability] += delta;
      added[ability] = (added[ability] ?? 0) + delta;
    }
  }
  const hpMax = (abilityModifier(abilities.constitution) - abilityModifier(sheet.abilities.constitution)) * Math.max(1, sheet.level ?? 1);
  const resistances = (bonuses.resistances ?? []).filter(type => !sheet.resistances.includes(type));
  const immunities = (bonuses.immunities ?? []).filter(type => !(sheet.immunities ?? []).includes(type));
  const armorClass = bonuses.armorClass ?? 0;
  const speed = bonuses.speed ?? 0;
  const spellAttack = bonuses.spellAttack ?? 0;
  const spellDc = bonuses.spellDc ?? 0;
  const spellBonus = sheet.spellBonus ?? { attack: 0, dc: 0 };
  return {
    sheet: {
      ...sheet,
      armorClass: sheet.armorClass + armorClass,
      speed: Math.max(0, sheet.speed + speed),
      abilities,
      resistances: [...sheet.resistances, ...resistances],
      ...(immunities.length ? { immunities: [...(sheet.immunities ?? []), ...immunities] } : {}),
      ...(spellAttack || spellDc ? { spellBonus: { attack: spellBonus.attack + spellAttack, dc: spellBonus.dc + spellDc } } : {}),
      hpMax: sheet.hpMax + hpMax,
      hpCurrent: sheet.hpCurrent + Math.max(0, hpMax),
    },
    applied: {
      characterId, armorClass, saves: bonuses.saves ?? 0, abilities: added, speed, resistances, hpMax,
      ...(immunities.length ? { immunities } : {}), ...(spellAttack ? { spellAttack } : {}), ...(spellDc ? { spellDc } : {}),
    },
  };
}

export function revertBonuses(sheet: SheetNumbers, applied: AppliedBonuses): SheetNumbers {
  const abilities = { ...sheet.abilities };
  for (const ability of ABILITIES) {
    const delta = applied.abilities?.[ability];
    if (delta) abilities[ability] = Math.max(1, abilities[ability] - delta);
  }
  const hpMax = Math.max(0, sheet.hpMax - (applied.hpMax ?? 0));
  const spellBonus = sheet.spellBonus ?? { attack: 0, dc: 0 };
  return {
    ...sheet,
    armorClass: sheet.armorClass - (applied.armorClass ?? 0),
    speed: Math.max(0, sheet.speed - (applied.speed ?? 0)),
    abilities,
    resistances: sheet.resistances.filter(type => !(applied.resistances ?? []).includes(type)),
    ...(applied.immunities?.length ? { immunities: (sheet.immunities ?? []).filter(type => !applied.immunities!.includes(type)) } : {}),
    ...(applied.spellAttack || applied.spellDc
      ? { spellBonus: { attack: spellBonus.attack - (applied.spellAttack ?? 0), dc: spellBonus.dc - (applied.spellDc ?? 0) } }
      : {}),
    hpMax,
    hpCurrent: Math.min(sheet.hpCurrent, hpMax),
  };
}

export function dawnCount(worldMinutes: number): number {
  return worldMinutes < 360 ? 0 : Math.floor((worldMinutes - 360) / 1440) + 1;
}

export const SRD_MAGIC_ITEMS: SrdMagicItem[] = SRD_MAGIC_ITEM_LIST;

const BY_INDEX = new Map<string, SrdMagicItem>();
for (const item of SRD_MAGIC_ITEMS) {
  BY_INDEX.set(item.index, item);
  for (const old of item.legacy ?? []) BY_INDEX.set(old, item);
}

export function findSrdMagicItem(index: string | null | undefined): SrdMagicItem | null {
  return index ? BY_INDEX.get(index) ?? null : null;
}

// The button for an item that is used up: potions are drunk, oils and ointments put on.
export function magicUseLabel(index: string | null | undefined): string | null {
  const item = findSrdMagicItem(index);
  if (item?.use?.kind !== 'consume') return null;
  return item.kind === 'potion' && !/^Масло/.test(item.nameRu) ? 'Выпить' : 'Нанести';
}
