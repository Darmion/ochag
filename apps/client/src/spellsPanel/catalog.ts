import type { DamageType, SpellPurpose } from '../spells/spellPurpose.ts';
import { SPELL_CLASSES } from '../spells/spellText.ts';

export type CatalogFilters = {
  text: string; levels: number[]; school: string; element: DamageType | '';
  spellList: string;
  showKnown: boolean; showUnknown: boolean; onlyPrepared: boolean; purposes: SpellPurpose[]; onlyFavorites: boolean;
};

export type CatalogItem = {
  key: string; name: string; alt: string; level: number; school: string; classes: string[];
  purposes: SpellPurpose[]; damageTypes: DamageType[];
  entry: { prepared: boolean; granted?: boolean } | null;
};

export function defaultFilters(): CatalogFilters {
  return { text: '', levels: [], school: '', element: '', spellList: 'mine', showKnown: true, showUnknown: false, onlyPrepared: false, purposes: [], onlyFavorites: false };
}

export function filtersActive(filters: CatalogFilters): boolean {
  return Boolean(filters.text.trim() || filters.levels.length || filters.school || filters.element
    || filters.spellList !== 'mine' || !filters.showKnown || filters.showUnknown || filters.onlyPrepared || filters.purposes.length || filters.onlyFavorites);
}

export function toggleLevel(levels: number[], level: number): number[] {
  return levels.includes(level) ? levels.filter(value => value !== level) : [...levels, level].sort((a, b) => a - b);
}

export function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

export function ownSpellLists(classes: string[]): Set<string> {
  return new Set(classes.map(id => id.toLowerCase())
    .filter(id => SPELL_CLASSES.some(option => option.id.toLowerCase() === id)));
}

export function spellListsLabel(lists: Set<string>): string {
  return [...lists].map(id => SPELL_CLASSES.find(option => option.id.toLowerCase() === id)?.label ?? id).join(', ');
}

const onList = (item: CatalogItem, list: string) => item.classes.some(entry => entry.toLowerCase() === list.toLowerCase());

export function filterCatalog<T extends CatalogItem>(items: T[], filters: CatalogFilters, ownLists: Set<string>, isFavorite: (item: T) => boolean): T[] {
  const text = filters.text.trim().toLowerCase();
  return items.filter(item => {
    if (item.entry) {
      if (!filters.showKnown) return false;
      if (filters.onlyPrepared && !(item.entry.prepared || item.level === 0)) return false;
    } else {
      if (!filters.showUnknown || filters.onlyPrepared) return false;
      if (filters.spellList === 'mine' && ownLists.size && !item.classes.some(entry => ownLists.has(entry.toLowerCase()))) return false;
    }
    if (filters.spellList && filters.spellList !== 'mine' && !onList(item, filters.spellList)) return false;
    if (filters.levels.length && !filters.levels.includes(item.level)) return false;
    if (filters.school && item.school !== filters.school) return false;
    if (filters.element && !item.damageTypes.includes(filters.element)) return false;
    if (filters.purposes.length && !filters.purposes.some(purpose => item.purposes.includes(purpose))) return false;
    if (filters.onlyFavorites && !isFavorite(item)) return false;
    if (text && !item.name.toLowerCase().includes(text) && !item.alt.toLowerCase().includes(text)) return false;
    return true;
  });
}

export function groupByLevel<T extends CatalogItem>(items: T[], isFavorite: (item: T) => boolean) {
  const byLevel = new Map<number, T[]>();
  for (const item of items) {
    if (!byLevel.has(item.level)) byLevel.set(item.level, []);
    byLevel.get(item.level)!.push(item);
  }
  const rank = (item: T) => (item.entry ? (isFavorite(item) ? 0 : 1) : 2);
  return [...byLevel.entries()].sort(([a], [b]) => a - b).map(([level, group]) => ({
    level,
    items: group.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ru')),
    known: group.filter(item => item.entry).length,
  }));
}

export type SpellStatus = { label: string; tone: 'known' | 'unprepared' | 'granted' | 'unknown' };
export function statusOf(item: CatalogItem): SpellStatus {
  if (!item.entry) return { label: 'Неизвестно', tone: 'unknown' };
  if (item.entry.granted) return { label: 'Дарованное', tone: 'granted' };
  if (item.level > 0 && !item.entry.prepared) return { label: 'Не подготовлено', tone: 'unprepared' };
  return { label: 'Известно', tone: 'known' };
}
