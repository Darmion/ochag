import { itemArtKey, normalizeItemName, rarityArtKey, schoolArtKey } from '../art/itemArt.ts';

export type ArtKind = 'item' | 'school' | 'rarity';
export type ArtElement = {
  key: string; name: string; kind: ArtKind; group: string;
  srdIndex?: string | null; rarity?: string; school?: string;
  section: string; search: string; custom?: boolean;
};
export type LibraryItem = { path: string; label: string };
export type LibraryGroup = { id: string; label: string; section: string; items: LibraryItem[] };

export type ElementGroup = { id: string; label: string; elements: ArtElement[] };
export type ElementSources = {
  weapons: Array<{ index: string; nameRu: string; name?: string; category: string; kind: string }>;
  gear: Array<{ index: string; nameRu: string; category: string }>;
  magic: Array<{ index: string; nameRu: string; name?: string; rarity: string }>;
  customNames: string[];
};

export const SCHOOLS: Array<[string, string]> = [
  ['Abjuration', 'Ограждение'], ['Conjuration', 'Вызов'], ['Divination', 'Прорицание'], ['Enchantment', 'Очарование'],
  ['Evocation', 'Воплощение'], ['Illusion', 'Иллюзия'], ['Necromancy', 'Некромантия'], ['Transmutation', 'Преобразование'],
];
export const RARITIES: Array<[string, string]> = [
  ['common', 'Обычный'], ['uncommon', 'Необычный'], ['rare', 'Редкий'], ['very_rare', 'Очень редкий'], ['legendary', 'Легендарный'], ['artifact', 'Артефакт'],
];
export const RARITY_LABELS: Record<string, string> = Object.fromEntries(RARITIES.map(([id, label]) => [id, label.toLowerCase()]));
export const COMMON_THINGS = [
  'Ключ', 'Свиток', 'Карта', 'Письмо', 'Записка', 'Книга', 'Компас', 'Монеты', 'Золотая монета', 'Серебряная монета', 'Кошель',
  'Самоцвет', 'Рубин', 'Сапфир', 'Изумруд', 'Алмаз', 'Жемчужина', 'Золотой слиток', 'Зелье', 'Яд', 'Хлеб', 'Яблоко', 'Сыр', 'Мясо',
  'Рыба', 'Пирог', 'Похлёбка', 'Сундук', 'Бочка', 'Ящик', 'Ваза', 'Котелок', 'Кость', 'Кирка', 'Скипетр', 'Волшебная палочка', 'Посох',
  'Меч', 'Лук', 'Стрела', 'Колчан', 'Мимик',
];
export const GEAR_GROUPS: Record<string, [string, string]> = {
  armor: ['Доспехи и щиты', ''], gear: ['Снаряжение', 'Вещи'], ammo: ['Боеприпасы', 'Боеприпасы'], tools: ['Инструменты', 'Вещи'],
  consumable: ['Расходники', 'Вещи'], focus: ['Фокусировки', 'Магия'], clothes: ['Одежда', 'Вещи'],
};
export const WEAPON_GROUPS: Record<string, string> = {
  'simple/melee': 'Оружие · простое рукопашное', 'simple/ranged': 'Оружие · простое дальнобойное',
  'martial/melee': 'Оружие · воинское рукопашное', 'martial/ranged': 'Оружие · воинское дальнобойное',
};

export const searchText = (...parts: Array<string | null | undefined>) => normalizeItemName(parts.filter(Boolean).join(' '));

export const queryWords = (query: string) => normalizeItemName(query).split(' ').filter(Boolean);
export const matchesWords = (text: string, words: string[]) => words.every(word => normalizeItemName(text).includes(word));
export const searchLibrary = (library: LibraryGroup[], section: string, words: string[]) => library
  .filter(group => !section || group.section === section || group.id === section)
  .map(group => ({ ...group, items: group.items.filter(item => matchesWords(`${item.label} ${item.path.split('/').pop()}`, words)) }))
  .filter(group => group.items.length);

export function buildElementGroups({ weapons, gear, magic, customNames }: ElementSources): ElementGroup[] {
  const list: ElementGroup[] = [];
  const add = (id: string, label: string, elements: ArtElement[]) => {
    if (elements.length) list.push({ id, label, elements: elements.sort((a, b) => a.name.localeCompare(b.name, 'ru')) });
  };
  for (const [id, label] of Object.entries(WEAPON_GROUPS)) {
    add(id, label, weapons.filter(entry => `${entry.category}/${entry.kind}` === id).map(entry => ({
      key: itemArtKey(entry.nameRu), name: entry.nameRu, kind: 'item', group: label, srdIndex: entry.index, section: 'Оружие',
      search: searchText(entry.nameRu, entry.name, entry.index, label),
    })));
  }
  for (const [id, [label, section]] of Object.entries(GEAR_GROUPS)) {
    add(`gear-${id}`, label, gear.filter(entry => entry.category === id).map(entry => ({
      key: itemArtKey(entry.nameRu), name: entry.nameRu, kind: 'item', group: label, section, search: searchText(entry.nameRu, entry.index, label),
    })));
  }
  add('magic', 'Магические предметы', magic.map(entry => ({
    key: itemArtKey(entry.nameRu), name: entry.nameRu, kind: 'item', group: 'Магические предметы', srdIndex: entry.index, rarity: entry.rarity,
    section: 'Магия', search: searchText(entry.nameRu, entry.name, entry.index, 'магический'),
  })));
  add('schools', 'Школы магии', SCHOOLS.map(([school, name]) => ({
    key: schoolArtKey(school), name, kind: 'school', group: 'Школы магии', school, section: 'Магия', search: searchText(name, school, 'школа магии'),
  })));
  add('rarity', 'Рамки редкости', RARITIES.map(([rarity, name]) => ({
    key: rarityArtKey(rarity), name, kind: 'rarity', group: 'Рамки редкости', rarity, section: 'Интерфейс', search: searchText(name, rarity, 'рамка редкость'),
  })));
  const taken = new Set(list.flatMap(group => group.elements.map(element => element.key)));
  add('common', 'Прочие вещи', COMMON_THINGS.filter(name => !taken.has(itemArtKey(name))).map(name => ({
    key: itemArtKey(name), name, kind: 'item', group: 'Прочие вещи', section: 'Вещи', search: searchText(name, 'прочее'),
  })));
  add('custom', 'Свои названия', customNames.map(name => ({
    key: itemArtKey(name), name, kind: 'item', group: 'Свои названия', section: 'Вещи', search: searchText(name, 'своё'), custom: true,
  })));
  return list;
}

export function appliesText(element: ArtElement, forAll: boolean) {
  const who = forAll ? ' — у всех участников кампании' : '';
  if (element.kind === 'school') return `Заклинания школы «${element.name}» — в листе, библиотеке и заявках${who}.`;
  if (element.kind === 'rarity') return `Рамка магических предметов редкости «${element.name.toLowerCase()}»${who}.`;
  return `Вещи и оружие с названием «${element.name.replace(/\s*\([^)]*\)/g, '')}» (и «+1», «+2» к нему) — в листе, панели «Атака», лавке, добыче${who}.`;
}
