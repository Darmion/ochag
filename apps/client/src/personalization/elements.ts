import { computed, nextTick, reactive, ref, type ComputedRef, type Ref } from 'vue';

import {
  NO_ART, artSource, defaultItemArt, defaultRarityFrame, defaultSchoolArt, itemArt, itemArtKey, rarityFrame, schoolArt,
} from '../art/itemArt';
import { addCustomName, artPrefs, removeCustomName, resetArt } from '../art/artPersonalization';
import { campaignArt, campaignArtValue } from '../art/campaignArt';
import { buildElementGroups, queryWords, type ArtElement, type ElementGroup, type ElementSources } from './catalog';

export type ArtStatus = 'custom' | 'none' | 'gm' | 'gmnone' | 'default' | 'missing';

export function useArtElements({ weapons, gear, magic, forAll, layer, campaignReady, notice, onSelect }: {
  weapons: Ref<ElementSources['weapons']>;
  gear: Ref<ElementSources['gear']>;
  magic: Ref<ElementSources['magic']>;
  forAll: ComputedRef<boolean>;
  layer: ComputedRef<Record<string, string>>;
  campaignReady: ComputedRef<boolean>;
  notice: Ref<string>;
  onSelect: (element: ArtElement) => void;
}) {
  const groups = computed<ElementGroup[]>(() => buildElementGroups({
    weapons: weapons.value, gear: gear.value, magic: magic.value, customNames: artPrefs.customNames,
  }));
  const allElements = computed(() => groups.value.flatMap(group => group.elements));

  const defaultArt = (element: ArtElement) => element.kind === 'school' ? defaultSchoolArt(element.school)
    : element.kind === 'rarity' ? defaultRarityFrame(element.rarity) : defaultItemArt(element.name, element.srdIndex);
  const currentArt = (element: ArtElement) => {
    if (forAll.value) {
      const value = campaignArtValue(element.key);
      return value !== undefined ? artSource(value) : defaultArt(element);
    }
    return element.kind === 'school' ? schoolArt(element.school)
      : element.kind === 'rarity' ? rarityFrame(element.rarity) : itemArt(element.name, element.srdIndex);
  };
  const statusOf = (element: ArtElement): ArtStatus => {
    const own = layer.value[element.key];
    if (own === NO_ART) return 'none';
    if (own !== undefined && currentArt(element)) return 'custom';
    if (!forAll.value && campaignReady.value) {
      const fromGm = campaignArt.overrides[element.key];
      if (fromGm === NO_ART) return 'gmnone';
      if (fromGm !== undefined && currentArt(element)) return 'gm';
    }
    return defaultArt(element) ? 'default' : 'missing';
  };
  const statusLabel = (status: ArtStatus) => ({
    custom: forAll.value ? 'для всех' : 'своя', none: 'без картинки', gm: 'от мастера', gmnone: 'мастер: без картинки', default: '', missing: 'нет картинки',
  })[status];

  const query = ref('');
  const filter = ref<'all' | 'missing' | 'changed'>('all');
  const counts = computed(() => ({
    all: allElements.value.length,
    missing: allElements.value.filter(element => !currentArt(element)).length,
    changed: allElements.value.filter(element => layer.value[element.key] !== undefined).length,
  }));
  const visibleGroups = computed(() => {
    const words = queryWords(query.value);
    return groups.value.map(group => ({
      ...group,
      total: group.elements.length,
      withArt: group.elements.filter(element => currentArt(element)).length,
      elements: group.elements.filter(element => {
        if (filter.value === 'missing' && currentArt(element)) return false;
        if (filter.value === 'changed' && layer.value[element.key] === undefined) return false;
        return words.every(word => element.search.includes(word));
      }),
    })).filter(group => group.elements.length);
  });
  const filtering = computed(() => Boolean(query.value.trim()) || filter.value !== 'all');
  const open = reactive<Record<string, boolean>>({});
  const isOpen = (id: string) => filtering.value || open[id] === true;

  const selectedKey = ref('');
  const selected = computed(() => allElements.value.find(element => element.key === selectedKey.value) ?? null);
  function select(element: ArtElement) {
    selectedKey.value = element.key;
    open[groups.value.find(group => group.elements.includes(element))?.id ?? ''] = true;
    onSelect(element);
  }
  function selectFirst() {
    const first = visibleGroups.value[0]?.elements[0];
    if (first) select(first);
  }
  function removeName(element: ArtElement) {
    resetArt(element.key);
    removeCustomName(element.name);
    if (selectedKey.value === element.key) selectedKey.value = '';
  }

  const customName = ref('');
  function addName() {
    const name = customName.value;
    const existing = name.trim() ? allElements.value.find(element => element.key === itemArtKey(name)) : undefined;
    if (existing) {
      customName.value = '';
      select(existing);
      notice.value = `«${existing.name}» уже есть в разделе «${existing.group}» — открыт он.`;
      return;
    }
    if (!addCustomName(name)) {
      notice.value = name.trim() ? `«${name.trim()}» уже есть в списке.` : '';
      return;
    }
    customName.value = '';
    open.custom = true;
    void nextTick(() => {
      const element = allElements.value.find(entry => entry.custom && entry.name === name.replace(/\s+/g, ' ').trim());
      if (element) select(element);
    });
  }

  // Mutable on purpose: the list and the card write query, filter, open and customName through v-model.
  return reactive({
    allElements, defaultArt, currentArt, statusOf, statusLabel, query, filter, counts, visibleGroups,
    open, isOpen, selectedKey, selected, select, selectFirst, removeName, customName, addName,
  });
}

export type ArtElements = ReturnType<typeof useArtElements>;
