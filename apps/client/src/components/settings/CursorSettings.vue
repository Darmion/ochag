<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { confirmAction } from '../../ui/confirmDialog';
import {
  BUILT_IN_CURSORS, CURSOR_SIZES, MAX_CUSTOM_CURSORS, cursorLabel, cursorPrefs, cursorPreviews, cursorSource, cursorState, cursorStorage,
  prepareCursorImage, removeCustomCursor, resetCursor,
} from '../../settings/cursorSettings';
import { t } from '../../i18n/i18n';
import CursorImageDialog from './CursorImageDialog.vue';
import GameIcon from '../game/GameIcon.vue';

const dialog = ref<{ choice: string | null } | null>(null);

const choices = computed(() => [
  ...BUILT_IN_CURSORS.map(entry => `builtin:${entry.id}`),
  ...cursorPrefs.customs.map(entry => `custom:${entry.id}`),
]);
const pointerChoices = computed(() => ['same', 'system', ...choices.value]);

watch(choices, list => {
  for (const choice of list) {
    const src = cursorSource(choice);
    if (src && !cursorPreviews[src]) void prepareCursorImage(src).catch(() => undefined);
  }
}, { immediate: true });
const tileImage = (choice: string) => {
  const src = cursorSource(choice);
  return src ? cursorPreviews[src] ?? src : '';
};

function choiceName(choice: string): string {
  if (choice === 'system') return t('Системный');
  if (choice === 'same') return t('Как обычный');
  return t(cursorLabel(choice));
}
function pointerName(choice: string): string {
  return choice === 'system' ? t('Системная рука') : choiceName(choice);
}
function sizeName(size: number): string {
  return size === 32 ? t('{size} px — как у системного', { size }) : `${size} px`;
}

const hotspotChoice = computed(() => (cursorPrefs.main !== 'system' ? cursorPrefs.main : cursorPrefs.pointer.startsWith('builtin:') || cursorPrefs.pointer.startsWith('custom:') ? cursorPrefs.pointer : null));
const customised = computed(() => cursorPrefs.main !== 'system' || cursorPrefs.pointer !== 'same' || cursorPrefs.size !== 32);

async function remove(choice: string) {
  const id = choice.slice(7);
  if (!(await confirmAction(t('Удалить свой курсор «{name}»?', { name: cursorLabel(choice) }), { title: t('Удалить курсор'), confirmLabel: t('Удалить'), danger: true }))) return;
  removeCustomCursor(id);
}

function onAdded(choice: string) {
  cursorPrefs.main = choice;
}
</script>

<template>
  <div class="cursor-settings">
    <h4>{{ t('Курсор') }}</h4>
    <div class="cursor-tiles" role="radiogroup" :aria-label="t('Обычный курсор')">
      <button
        type="button" role="radio" class="cursor-tile system"
        :aria-checked="cursorPrefs.main === 'system'" :aria-pressed="cursorPrefs.main === 'system'" :title="t('Системный — как в Windows')"
        @click="cursorPrefs.main = 'system'"
      >
        <span class="tile-art system-art" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 2 L5 19 L9.5 15 L12.5 22 L15.5 20.7 L12.6 14 L18.5 14 Z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round" /></svg>
        </span>
        <small>{{ t('Системный') }}</small>
      </button>
      <span v-for="choice in choices" :key="choice" class="tile-wrap">
        <button
          type="button" role="radio" class="cursor-tile"
          :aria-checked="cursorPrefs.main === choice" :aria-pressed="cursorPrefs.main === choice" :title="choiceName(choice)"
          @click="cursorPrefs.main = choice"
        >
          <span class="tile-art"><img :src="tileImage(choice)" alt="" /></span>
          <small>{{ choiceName(choice) }}</small>
        </button>
        <button
          v-if="choice.startsWith('custom:')" type="button" class="tile-remove"
          :aria-label="t('Удалить свой курсор «{name}»', { name: cursorLabel(choice) })" :title="t('Удалить')" @click="remove(choice)"
        ><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </span>
      <button
        type="button" class="cursor-tile add" :disabled="cursorPrefs.customs.length >= MAX_CUSTOM_CURSORS"
        :title="t('Картинка из библиотеки или свой файл')" @click="dialog = { choice: null }"
      >
        <span class="tile-art" aria-hidden="true">＋</span>
        <small>{{ t('Своя…') }}</small>
      </button>
    </div>

    <div class="cursor-row">
      <label>
        {{ t('Над кнопками и ссылками') }}
        <select v-model="cursorPrefs.pointer">
          <option v-for="choice in pointerChoices" :key="choice" :value="choice">{{ pointerName(choice) }}</option>
        </select>
      </label>
      <label>
        {{ t('Размер') }}
        <select v-model.number="cursorPrefs.size">
          <option v-for="size in CURSOR_SIZES" :key="size" :value="size">{{ sizeName(size) }}</option>
        </select>
      </label>
    </div>

    <div class="cursor-try">
      <span>{{ t('Проба:') }}</span>
      <button type="button" tabindex="-1">{{ t('Кнопка') }}</button>
      <input type="text" tabindex="-1" :placeholder="t('Поле ввода')" :aria-label="t('Поле ввода')" />
      <span class="try-text">{{ t('просто текст') }}</span>
    </div>

    <div class="cursor-actions">
      <button type="button" :disabled="!hotspotChoice" @click="dialog = { choice: hotspotChoice }">{{ t('Точка нажатия…') }}</button>
      <button type="button" :disabled="!customised" @click="resetCursor()">{{ t('Сбросить курсор') }}</button>
    </div>
    <small class="muted">{{ t('Только на этом компьютере. Поля ввода оставляют текстовый курсор, инструменты стола — свои (перекрестие, стирание). Курсор больше 32 px у самого края окна браузер подменяет системным.') }}</small>
    <p v-if="cursorState.error || cursorStorage.error" class="cursor-error" role="alert">{{ t(cursorState.error || cursorStorage.error) }}</p>

    <CursorImageDialog v-if="dialog" :choice="dialog.choice" @close="dialog = null" @added="onAdded" />
  </div>
</template>

<style scoped>
.cursor-settings h4{margin:0 0 8px}
.cursor-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px;margin-bottom:12px}
.tile-wrap{position:relative;display:flex}
.cursor-tile{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:4px;min-height:84px;width:100%;padding:8px 4px 6px;font-weight:600}
.cursor-tile small{display:block;margin:0;font-size:11px;line-height:1.2;text-align:center;overflow-wrap:anywhere}
.tile-art{display:flex;align-items:center;justify-content:center;width:40px;height:40px;font-size:22px}
.tile-art img{max-width:34px;max-height:34px;object-fit:contain;image-rendering:pixelated}
.tile-remove{position:absolute;top:2px;right:2px;min-height:20px;width:20px;padding:0;font-size:11px;line-height:1;border-radius:50%}
.cursor-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.cursor-row label{margin:0}
.cursor-try{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:12px 0 10px;padding:10px;border:1px dashed var(--brass-light);border-radius:4px;font-size:13px}
.cursor-try button{min-height:30px;padding:2px 12px;font-size:13px}
.cursor-try input{width:140px;min-height:30px}
.cursor-actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
.cursor-actions button{min-height:30px;padding:2px 12px;font-size:13px}
.cursor-error{margin:6px 0 0;font-size:12px;color:var(--burgundy)}
@media(max-width:520px){.cursor-row{grid-template-columns:1fr}}
</style>
