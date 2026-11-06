import { computed, nextTick, reactive, ref, watch, type Ref } from 'vue';
import type { SrdSpell } from '../rules/srd';
import { spellDamageTypes, spellPurposes, type DamageType, type SpellPurpose } from '../spells/spellPurpose';
import { isFavoriteSpell } from '../spells/spellFavorites';
import {
  defaultFilters, filterCatalog, filtersActive as anyFilter, groupByLevel, ownSpellLists, spellListsLabel, toggleLevel as withLevel, toggleValue,
  type CatalogFilters,
} from './catalog';
import { mechanicsOf, spellName } from './spellInfo';
import type { AnySpell, BrowseItem, CampaignSpell, CharacterSpellEntry, Spellcasting } from './types';

const VIEW_KEY = 'ochag.spellView.v1';
function readView(): 'list' | 'grid' {
  try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch { return 'list'; }
}

function classesOf(spell: AnySpell | null): string[] {
  if (!spell) return [];
  return Array.isArray(spell.classes) ? spell.classes : String(spell.classes ?? '').split(/[\s,;]+/).filter(Boolean);
}

const traitsCache = new WeakMap<object, { purposes: SpellPurpose[]; damageTypes: DamageType[] }>();
function traitsOf(spell: AnySpell | null) {
  if (!spell) return { purposes: [] as SpellPurpose[], damageTypes: [] as DamageType[] };
  let cached = traitsCache.get(spell);
  if (!cached) {
    const source = {
      name: spell.name, desc: spell.desc, descRu: 'descRu' in spell ? spell.descRu : null,
      damageFormula: spell.damageFormula, healingFormula: spell.healingFormula, mechanics: mechanicsOf(spell),
    };
    cached = { purposes: spellPurposes(source), damageTypes: spellDamageTypes(source) };
    traitsCache.set(spell, cached);
  }
  return cached;
}

function makeItem(key: string, source: 'srd' | 'custom', spell: AnySpell | null, entry: CharacterSpellEntry | null): BrowseItem {
  const traits = traitsOf(spell);
  return {
    key, source, spell, entry, name: spellName(spell),
    alt: spell && 'nameRu' in spell && spell.nameRu ? spell.name : '',
    level: spell?.level ?? 0, school: spell?.school ?? '', classes: classesOf(spell), ...traits,
  };
}

type BrowserInput = {
  props: { characterId: string; currentUserId: string; readOnly: boolean };
  known: Ref<CharacterSpellEntry[]>;
  srdLibrary: Ref<SrdSpell[]>;
  customLibrary: Ref<CampaignSpell[]>;
  casting: Ref<Spellcasting | null>;
};

export function useSpellBrowser({ props, known, srdLibrary, customLibrary, casting }: BrowserInput) {
  const knownSrdIndices = computed(() => new Set(known.value.filter(k => k.source === 'srd').map(k => k.srdIndex)));
  const knownCustomIds = computed(() => new Set(known.value.filter(k => k.source === 'custom').map(k => k.customSpellId)));

  const browseItems = computed<BrowseItem[]>(() => {
    const items = known.value.map(entry => makeItem(`e:${entry.id}`, entry.source, entry.spell, entry));
    if (!props.readOnly) {
      for (const spell of srdLibrary.value) if (!knownSrdIndices.value.has(spell.index)) items.push(makeItem(`srd:${spell.index}`, 'srd', spell, null));
      for (const spell of customLibrary.value) {
        if (knownCustomIds.value.has(spell.id) || !(spell.status === 'approved' || spell.createdBy === props.currentUserId)) continue;
        items.push(makeItem(`custom:${spell.id}`, 'custom', spell, null));
      }
    }
    return items;
  });

  const viewMode = ref<'list' | 'grid'>(readView());
  watch(viewMode, value => { try { localStorage.setItem(VIEW_KEY, value); } catch {  } });

  const filters = reactive<CatalogFilters>(defaultFilters());
  const filtersActive = computed(() => anyFilter(filters));
  function resetFilters() {
    Object.assign(filters, defaultFilters());
  }
  function toggleLevel(level: number) {
    filters.levels = withLevel(filters.levels, level);
  }
  function togglePurpose(purpose: SpellPurpose) {
    filters.purposes = toggleValue(filters.purposes, purpose);
  }

  const ownLists = computed(() => ownSpellLists(casting.value?.classes ?? []));
  const ownListsLabel = computed(() => spellListsLabel(ownLists.value));
  const isFavorite = (item: BrowseItem) => Boolean(item.entry && isFavoriteSpell(props.characterId, item.entry.id));

  const filtered = computed(() => filterCatalog(browseItems.value, filters, ownLists.value, isFavorite));

  const collapsed = ref<number[]>([]);
  function toggleGroup(level: number) {
    collapsed.value = toggleValue(collapsed.value, level);
  }
  const groups = computed(() => groupByLevel(filtered.value, isFavorite));

  const selectedKey = ref('');
  const selected = computed(() => filtered.value.find(item => item.key === selectedKey.value) ?? groups.value[0]?.items[0] ?? null);
  function select(item: BrowseItem) {
    selectedKey.value = item.key;
  }
  function onListKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const visible = groups.value.filter(group => !collapsed.value.includes(group.level)).flatMap(group => group.items);
    if (!visible.length) return;
    event.preventDefault();
    const list = event.currentTarget as HTMLElement;
    const at = visible.findIndex(item => item.key === selected.value?.key);
    const next = visible[Math.max(0, Math.min(visible.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]!;
    selectedKey.value = next.key;
    void nextTick(() => list.querySelector(`[data-key="${CSS.escape(next.key)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }

  const knownSummary = computed(() => ({
    total: known.value.length,
    cantrips: known.value.filter(entry => (entry.spell?.level ?? 0) === 0).length,
    prepared: known.value.filter(entry => (entry.spell?.level ?? 0) > 0 && entry.prepared).length,
  }));

  return reactive({
    knownCustomIds, viewMode, filters, filtersActive, resetFilters, toggleLevel, togglePurpose, ownListsLabel, isFavorite,
    filtered, collapsed, toggleGroup, groups, selectedKey, selected, select, onListKey, knownSummary,
  });
}

export type SpellBrowser = ReturnType<typeof useSpellBrowser>;
