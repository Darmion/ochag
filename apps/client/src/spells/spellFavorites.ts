import { reactive } from 'vue';

const KEY = 'ochag.spellFavorites.v1';

function load(): Record<string, string[]> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([, ids]) => Array.isArray(ids))
      .map(([characterId, ids]) => [characterId, (ids as unknown[]).filter((id): id is string => typeof id === 'string').slice(0, 200)]));
  } catch {
    return {};
  }
}

const favorites = reactive<Record<string, string[]>>(load());

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(favorites));
  } catch {
  }
}

export function isFavoriteSpell(characterId: string, entryId: string): boolean {
  return (favorites[characterId] ?? []).includes(entryId);
}

export function toggleFavoriteSpell(characterId: string, entryId: string) {
  const list = favorites[characterId] ?? [];
  favorites[characterId] = list.includes(entryId) ? list.filter(id => id !== entryId) : [...list, entryId];
  if (!favorites[characterId].length) delete favorites[characterId];
  save();
}
