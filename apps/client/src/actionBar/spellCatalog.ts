import { computed, type Ref } from 'vue';
import { isFavoriteSpell } from '../spells/spellFavorites';
import type { SpellEntry, ActionBarProps } from './types';

export type SpellCatalogDeps = {
  props: ActionBarProps;
  spellQuery: Ref<string>;
  spellCircle: Ref<number | null>;
  spells: Ref<SpellEntry[]>;
};

export function spellName(entry: SpellEntry) {
  return entry.spell ? entry.spell.nameRu || entry.spell.name : '(удалено)';
}

export function useSpellCatalog({ props, spellQuery, spellCircle, spells }: SpellCatalogDeps) {
  const favoriteSpell = (entry: SpellEntry) => Boolean(props.actor?.characterId && isFavoriteSpell(props.actor.characterId, entry.id));
  const sortedSpells = computed<SpellEntry[]>(() => [...spells.value]
    .filter(entry => entry.spell)
    .sort((a, b) => Number(favoriteSpell(b)) - Number(favoriteSpell(a)) || (a.spell!.level - b.spell!.level) || spellName(a).localeCompare(spellName(b), 'ru')));

  const spellCircles = computed(() => [...new Set(sortedSpells.value.map(entry => entry.spell!.level))].sort((a, b) => a - b));
  const visibleSpells = computed(() => sortedSpells.value.filter(entry =>
    (spellCircle.value === null || entry.spell!.level === spellCircle.value)
    && spellName(entry).toLocaleLowerCase('ru').includes(spellQuery.value.trim().toLocaleLowerCase('ru'))));

  return { spellName, favoriteSpell, sortedSpells, spellCircles, visibleSpells };
}
