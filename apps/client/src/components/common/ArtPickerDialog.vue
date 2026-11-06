<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { useEscapeClose } from '../../ui/escapeStack';
import { t } from '../../i18n/i18n';
import { libraryArt } from '../../art/itemArt';
import { artLibraryGroups } from '../../art/artPacks';
import GameIcon from '../game/GameIcon.vue';

const props = withDefaults(defineProps<{
  title: string;
  sections?: string[];
  firstSections?: string[];
  suggested?: string[];
  busy?: boolean;
  error?: string;
}>(), { sections: () => [], firstSections: () => [], suggested: () => [], busy: false, error: '' });
const emit = defineEmits<{ close: []; pick: [path: string] }>();
useEscapeClose(() => emit('close'));

type LibraryItem = { path: string; label: string };
type LibraryGroup = { id: string; label: string; section: string; items: LibraryItem[] };

const library = ref<LibraryGroup[]>([]);
const loadError = ref('');
const search = ref('');
const groupId = ref('');

onMounted(async () => {
  try {
    const groups: LibraryGroup[] = await artLibraryGroups();
    const shown = props.sections.length ? groups.filter(group => props.sections.includes(group.section)) : groups;
    const rank = (group: LibraryGroup) => (props.firstSections.includes(group.section) ? 0 : 1);
    library.value = [...shown].sort((a, b) => rank(a) - rank(b));
  } catch {
    loadError.value = t('Библиотека картинок не загрузилась.');
  }
});

const labels = computed(() => new Map(library.value.flatMap(group => group.items.map(item => [item.path, item.label] as const))));
const suggestedItems = computed(() => props.suggested
  .filter(path => labels.value.has(path))
  .map(path => ({ path, label: labels.value.get(path)! })));

const items = computed(() => {
  const query = search.value.trim().toLowerCase();
  const found: Array<LibraryItem & { group: string }> = [];
  for (const group of library.value) {
    if (!query && groupId.value && group.id !== groupId.value) continue;
    for (const item of group.items) {
      if (query && !`${t(item.label)} ${item.label} ${t(group.label)}`.toLowerCase().includes(query)) continue;
      found.push({ ...item, group: group.label });
    }
  }
  return found.slice(0, 400);
});

function pick(path: string) {
  if (!props.busy) emit('pick', path);
}
</script>

<template>
  <div class="art-picker" role="dialog" aria-modal="true" :aria-label="title" @click.self="emit('close')">
    <div class="picker-card">
      <header class="picker-header">
        <h3>{{ title }}</h3>
        <button type="button" class="picker-close" :aria-label="t('Закрыть')" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>

      <section v-if="suggestedItems.length" class="suggested" :aria-label="t('Подходящие')">
        <h4>{{ t('Подходящие') }}</h4>
        <ul class="picker-grid large">
          <li v-for="item in suggestedItems" :key="item.path">
            <button type="button" :title="t(item.label)" :disabled="busy" @click="pick(item.path)">
              <img :src="libraryArt(item.path)" :alt="t(item.label)" />
              <span>{{ t(item.label) }}</span>
            </button>
          </li>
        </ul>
      </section>

      <div class="picker-filters">
        <input v-model="search" type="search" :placeholder="t('Поиск картинки…')" :aria-label="t('Поиск картинки')" />
        <select v-model="groupId" :aria-label="t('Раздел библиотеки')" :disabled="Boolean(search.trim())">
          <option value="">{{ t('Все разделы') }}</option>
          <option v-for="group in library" :key="group.id" :value="group.id">{{ t(group.label) }}</option>
        </select>
      </div>
      <ul class="picker-grid">
        <li v-for="item in items" :key="item.path">
          <button type="button" :title="`${t(item.label)} — ${t(item.group)}`" :disabled="busy" @click="pick(item.path)">
            <img :src="libraryArt(item.path)" :alt="t(item.label)" loading="lazy" />
          </button>
        </li>
      </ul>
      <p v-if="library.length && !items.length" class="hint">{{ t('Ничего не нашлось.') }}</p>
      <p v-if="busy" class="hint" role="status">{{ t('Загрузка…') }}</p>
      <p v-if="loadError || error" class="problem" role="alert">{{ loadError || error }}</p>
    </div>
  </div>
</template>

<style scoped>
.art-picker{position:fixed;inset:0;z-index:3100;background:#000a;display:flex;align-items:center;justify-content:center;padding:20px}
.picker-card{width:min(680px,100%);max-height:90vh;overflow-y:auto;padding:22px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 16px 40px #0008}
.picker-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.picker-header h3{margin:0}
.picker-close{min-height:32px;width:32px;padding:0}
.suggested h4{margin:0 0 6px;font-size:13px;color:var(--muted-ink)}
.suggested{margin-bottom:12px}
.picker-filters{display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:10px}
.picker-filters input,.picker-filters select{min-height:34px;min-width:0}
.picker-grid{list-style:none;margin:0;padding:6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px;max-height:min(46vh,380px);overflow-y:auto;border:1px solid var(--brass-light);border-radius:4px}
.picker-grid.large{grid-template-columns:repeat(auto-fill,minmax(92px,1fr));max-height:none;overflow:visible}
.picker-grid button{width:100%;aspect-ratio:1;min-height:0;padding:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:color-mix(in srgb,var(--ink) 6%,transparent)}
.picker-grid.large button{aspect-ratio:auto;padding:6px 4px}
.picker-grid img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}
.picker-grid.large img{width:72px;height:72px}
.picker-grid.large span{font-size:11px;line-height:1.2;text-align:center}
.hint{margin:8px 0 0;font-size:13px;color:var(--muted-ink)}
.problem{margin:10px 0 0;font-size:13px;color:#c0392b}
</style>
