<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import { shownText } from '../../i18n/domTranslate';
import { searchPalette } from '../../ui/paletteSearch';
import GameIcon from './GameIcon.vue';
import type { GameIconName } from '../../ui/gameIcons';

export type PaletteItem = {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: GameIconName;
  keywords?: string;
  hotkey?: string;
  userText?: boolean;
  run: () => unknown;
};

const props = defineProps<{ open: boolean; items: PaletteItem[]; initialQuery?: string }>();
const emit = defineEmits<{ close: [] }>();

const query = ref('');
const index = ref(0);
const input = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);

watch(() => props.open, async value => {
  if (!value) return;
  query.value = props.initialQuery ?? '';
  index.value = 0;
  await nextTick();
  input.value?.focus();
  const end = query.value.length;
  input.value?.setSelectionRange(end, end);
});

const filtered = computed(() => searchPalette(props.items, query.value, shownText));

watch(filtered, () => { index.value = 0; });

const grouped = computed(() => {
  const groups: Array<{ name: string; items: Array<{ item: PaletteItem; position: number }> }> = [];
  filtered.value.forEach((item, position) => {
    let group = groups.find(entry => entry.name === item.group);
    if (!group) groups.push(group = { name: item.group, items: [] });
    group.items.push({ item, position });
  });
  return groups;
});

function choose(item: PaletteItem | undefined) {
  if (!item) return;
  emit('close');
  void item.run();
}

async function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    // Escape stops here: bubbling on to the table would also deselect, cancel the action step and close windows.
    event.preventDefault();
    event.stopPropagation();
    emit('close');
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const count = filtered.value.length;
    if (!count) return;
    index.value = (index.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
    await nextTick();
    list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    event.preventDefault();
    choose(filtered.value[index.value]);
  }
}
</script>

<template>
  <div v-if="open" class="palette-backdrop" @pointerdown.self="emit('close')">
    <div class="palette g-frame" role="dialog" aria-label="Найти">
      <label class="palette-search">
        <GameIcon name="search" :size="20" />
        <span class="visually-hidden">Найти окно, действие или объект</span>
        <input ref="input" v-model="query" type="text" placeholder="Окно, действие, объект… (например: свет, атака, вид)" @keydown="onKey" />
        <kbd>Esc</kbd>
      </label>
      <div ref="list" class="palette-list" role="listbox">
        <template v-for="group in grouped" :key="group.name">
          <div class="palette-group">{{ group.name }}</div>
          <button
            v-for="{ item, position } in group.items"
            :key="item.id"
            type="button"
            role="option"
            class="palette-item"
            :aria-selected="position === index"
            @pointerenter="index = position"
            @click="choose(item)"
          >
            <GameIcon :name="item.icon" :size="18" />
            <span class="palette-label"><span :translate="item.userText ? 'no' : undefined">{{ item.userText ? shownText(item.label) : item.label }}</span><small v-if="item.sub">{{ item.sub }}</small></span>
            <kbd v-if="item.hotkey">{{ item.hotkey }}</kbd>
          </button>
        </template>
        <p v-if="!filtered.length" class="palette-empty">Ничего не нашлось.</p>
      </div>
      <div class="palette-foot"><span>↑↓ — выбрать</span><span>Enter — открыть</span><span>Ctrl+K — с любого места</span></div>
    </div>
  </div>
</template>

<style scoped>
.palette-backdrop{position:fixed;inset:0;z-index:3000;display:flex;justify-content:center;align-items:flex-start;padding-top:calc(12vh / var(--ui-zoom, 1));background:#0007}
.palette{width:min(640px,calc(92vw / var(--ui-zoom, 1)));max-height:calc(70vh / var(--ui-zoom, 1));display:flex;flex-direction:column;overflow:hidden;padding:0}
.palette-search{display:flex;align-items:center;gap:10px;margin:0;padding:12px 14px;color:var(--g-gold);box-shadow:inset 0 -1px 0 var(--g-gold-lo)}
.palette-search input{flex:1;min-width:0;min-height:36px;font-size:17px;background:transparent;border:none;box-shadow:none;outline:none}
.palette-list{flex:1;min-height:0;overflow-y:auto;padding:6px}
.palette-group{padding:8px 10px 3px;font:600 12px var(--g-title-font);color:var(--g-gold-lo,#8a6a35);letter-spacing:.04em;text-transform:uppercase}
.palette-item{display:flex;align-items:center;gap:10px;width:100%;min-height:38px;padding:6px 10px;text-align:left;justify-content:flex-start;background:transparent;box-shadow:none}
.palette-item[aria-selected="true"]{background:#ffffff14;box-shadow:inset 0 0 0 1px var(--g-gold-lo)}
.palette-label{display:flex;align-items:baseline;gap:8px;flex:1;min-width:0;font-size:14px}
.palette-label small{font-size:12px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
kbd{font:11px Consolas,monospace;opacity:.75;border:1px solid var(--g-gold-lo);border-radius:3px;padding:1px 5px}
.palette-empty{padding:14px;opacity:.75}
.palette-foot{display:flex;gap:16px;padding:8px 14px;font-size:12px;opacity:.75;box-shadow:inset 0 1px 0 var(--g-gold-lo)}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
</style>
