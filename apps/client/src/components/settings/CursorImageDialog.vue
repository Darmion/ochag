<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import {
  MAX_CUSTOM_CURSORS, addCustomCursor, cursorCss, cursorLabel, cursorPrefs, cursorSource, prepareCursorImage, setHotspot,
  storedUpload, type Hotspot,
} from '../../settings/cursorSettings';
import { useEscapeClose } from '../../ui/escapeStack';
import { t } from '../../i18n/i18n';
import { libraryArt } from '../../art/itemArt';
import { artLibraryGroups } from '../../art/artPacks';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{ choice?: string | null }>();
const emit = defineEmits<{ close: []; added: [choice: string] }>();
useEscapeClose(() => emit('close'));

type LibraryItem = { path: string; label: string };
type LibraryGroup = { id: string; label: string; section: string; items: LibraryItem[] };

const source = ref<'library' | 'upload'>('library');
const library = ref<LibraryGroup[]>([]);
const search = ref('');
const section = ref('Интерфейс');
const error = ref('');
const busy = ref(false);

const picked = ref<{ src: string; stored: string; label: string } | null>(null);
const label = ref('');
const spot = ref<Hotspot>({ x: 0, y: 0 });
const auto = ref<Hotspot>({ x: 0, y: 0 });
const preview = ref<{ src: string; width: number; height: number } | null>(null);
const tryCss = ref('');

const editing = computed(() => Boolean(props.choice));
const title = computed(() => (editing.value ? t('Точка нажатия: {name}', { name: t(cursorLabel(props.choice!)) }) : t('Своя картинка курсора')));
const full = computed(() => !editing.value && cursorPrefs.customs.length >= MAX_CUSTOM_CURSORS);

onMounted(async () => {
  if (props.choice) {
    const src = cursorSource(props.choice);
    if (src) await open(src, cursorPrefs.hotspots[props.choice] ?? null);
    return;
  }
  try {
    library.value = await artLibraryGroups();
  } catch {
    error.value = t('Библиотека картинок не загрузилась.');
  }
});

const sections = computed(() => [...new Set(library.value.map(group => group.section))]);
const items = computed(() => {
  const query = search.value.trim().toLowerCase();
  const found: Array<LibraryItem & { group: string }> = [];
  for (const group of library.value) {
    if (!query && section.value && group.section !== section.value) continue;
    for (const item of group.items) {
      if (query && !`${t(item.label)} ${item.label} ${t(group.label)}`.toLowerCase().includes(query)) continue;
      found.push({ ...item, group: group.label });
    }
  }
  return found.slice(0, 300);
});

async function open(src: string, hotspot: Hotspot | null) {
  error.value = '';
  try {
    const { canvas, auto: guess } = await prepareCursorImage(src);
    const scale = Math.min(224 / canvas.width, 224 / canvas.height);
    preview.value = { src: canvas.toDataURL('image/png'), width: Math.round(canvas.width * scale), height: Math.round(canvas.height * scale) };
    auto.value = guess;
    spot.value = hotspot ?? guess;
  } catch (failure) {
    error.value = failure instanceof Error ? t(failure.message) : String(failure);
    preview.value = null;
  }
}

async function pickLibrary(item: LibraryItem) {
  const src = libraryArt(item.path);
  picked.value = { src, stored: `library:${item.path}`, label: t(item.label) };
  label.value = t(item.label);
  await open(src, null);
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(t('Файл не прочитался.')));
    reader.readAsDataURL(file);
  });
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  error.value = '';
  if (file.size > 5 * 1024 * 1024) {
    error.value = t('Файл больше 5 МБ — для курсора хватит маленькой картинки.');
    return;
  }
  busy.value = true;
  try {
    const stored = await storedUpload(await readFile(file));
    picked.value = { src: stored, stored, label: file.name.replace(/\.[^.]+$/, '') };
    label.value = picked.value.label;
    await open(stored, null);
  } catch {
    error.value = t('Это не картинка или формат не поддерживается: подойдут PNG, WebP, GIF, SVG, ICO.');
  } finally {
    busy.value = false;
  }
}

function setPoint(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  spot.value = {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

const currentSrc = computed(() => picked.value?.src ?? (props.choice ? cursorSource(props.choice) : null));
watch([currentSrc, spot, () => cursorPrefs.size], async () => {
  if (!currentSrc.value) return void (tryCss.value = '');
  try {
    tryCss.value = `${await cursorCss(currentSrc.value, cursorPrefs.size, spot.value)}, auto`;
  } catch {
    tryCss.value = '';
  }
}, { immediate: true, deep: true });

function back() {
  picked.value = null;
  preview.value = null;
}

function save() {
  if (props.choice) {
    const isAuto = Math.abs(spot.value.x - auto.value.x) < 0.001 && Math.abs(spot.value.y - auto.value.y) < 0.001;
    setHotspot(props.choice, isAuto ? null : spot.value);
    emit('close');
    return;
  }
  if (!picked.value) return;
  const choice = addCustomCursor(label.value || picked.value.label, picked.value.stored, spot.value);
  if (!choice) {
    error.value = t('Своих курсоров уже {limit} — удалите один, чтобы добавить новый.', { limit: MAX_CUSTOM_CURSORS });
    return;
  }
  emit('added', choice);
  emit('close');
}

const markStyle = computed(() => ({ left: `${spot.value.x * 100}%`, top: `${spot.value.y * 100}%` }));
</script>

<template>
  <div class="modal-overlay cursor-dialog" role="dialog" aria-modal="true" :aria-label="title" @click.self="emit('close')">
    <div class="modal-card">
      <header class="modal-header">
        <h3>{{ title }}</h3>
        <button type="button" class="modal-close" :aria-label="t('Закрыть')" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>

      <p v-if="full" class="problem">{{ t('Своих курсоров уже {limit} — удалите один, чтобы добавить новый.', { limit: MAX_CUSTOM_CURSORS }) }}</p>

      <template v-else-if="!editing && !picked">
        <div class="source-switch" role="radiogroup" :aria-label="t('Откуда картинка')">
          <button type="button" role="radio" :aria-checked="source === 'library'" :aria-pressed="source === 'library'" @click="source = 'library'">{{ t('Из библиотеки') }}</button>
          <button type="button" role="radio" :aria-checked="source === 'upload'" :aria-pressed="source === 'upload'" @click="source = 'upload'">{{ t('Свой файл') }}</button>
        </div>

        <template v-if="source === 'library'">
          <div class="library-filters">
            <input v-model="search" type="search" :placeholder="t('Поиск картинки…')" :aria-label="t('Поиск картинки')" />
            <select v-model="section" :aria-label="t('Раздел библиотеки')" :disabled="Boolean(search.trim())">
              <option value="">{{ t('Все разделы') }}</option>
              <option v-for="name in sections" :key="name" :value="name">{{ t(name) }}</option>
            </select>
          </div>
          <ul class="library-grid">
            <li v-for="item in items" :key="item.path">
              <button type="button" :title="`${t(item.label)} — ${t(item.group)}`" @click="pickLibrary(item)">
                <img :src="libraryArt(item.path)" :alt="t(item.label)" loading="lazy" />
              </button>
            </li>
          </ul>
          <p v-if="library.length && !items.length" class="hint">{{ t('Ничего не нашлось.') }}</p>
        </template>

        <div v-else class="upload">
          <label class="upload-button">
            <span>{{ t('Выбрать файл…') }}</span>
            <input type="file" accept="image/png,image/webp,image/gif,image/svg+xml,image/x-icon,.ico,.cur,image/jpeg" :disabled="busy" @change="onFile" />
          </label>
          <p class="hint">{{ t('PNG, WebP, GIF, SVG или ICO. Прозрачные поля обрезаются, картинка уменьшается до размера курсора; хранится на этом компьютере.') }}</p>
        </div>
      </template>

      <template v-else-if="preview">
        <div class="hotspot-editor">
          <div class="hotspot-frame">
            <div class="hotspot-image" :style="{ width: `${preview.width}px`, height: `${preview.height}px` }" :title="t('Щёлкните — сюда курсор будет нажимать')" @click="setPoint">
              <img :src="preview.src" alt="" draggable="false" />
              <span class="hotspot-mark" :style="markStyle" aria-hidden="true" />
            </div>
          </div>
          <div class="hotspot-side">
            <p class="hint">{{ t('Щёлкните по картинке туда, куда курсор нажимает: кончик стрелки, палец, остриё.') }}</p>
            <div class="presets">
              <button type="button" @click="spot = { ...auto }">{{ t('Сам — по верхнему краю') }}</button>
              <button type="button" @click="spot = { x: 0, y: 0 }">{{ t('Левый верхний угол') }}</button>
              <button type="button" @click="spot = { x: 0.5, y: 0 }">{{ t('Верх, середина') }}</button>
              <button type="button" @click="spot = { x: 0.5, y: 0.5 }">{{ t('Центр') }}</button>
            </div>
            <label v-if="!editing" class="name-field">
              {{ t('Название') }}
              <input v-model="label" maxlength="60" />
            </label>
            <div class="try-area" :style="tryCss ? { cursor: tryCss } : undefined">{{ t('Наведите сюда — так курсор будет выглядеть и нажимать') }}</div>
          </div>
        </div>
        <footer class="dialog-actions">
          <button v-if="!editing" type="button" @click="back">{{ t('← Другая картинка') }}</button>
          <button type="button" class="primary" @click="save">{{ editing ? t('Сохранить') : t('Добавить курсор') }}</button>
        </footer>
      </template>

      <p v-if="error" class="problem" role="alert">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.cursor-dialog{position:fixed;inset:0;z-index:3100;background:#000a;display:flex;align-items:center;justify-content:center;padding:20px}
.modal-card{width:min(620px,100%);max-height:90vh;overflow-y:auto;padding:24px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 16px 40px #0008}
.modal-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
.modal-header h3{margin:0}
.modal-close{min-height:32px;width:32px;padding:0}
.source-switch{display:flex;gap:8px;margin-bottom:12px}
.source-switch button{min-height:34px;padding:4px 14px}
.library-filters{display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:10px}
.library-filters input,.library-filters select{min-height:34px}
.library-grid{list-style:none;margin:0;padding:6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(56px,1fr));gap:6px;max-height:min(46vh,360px);overflow-y:auto;border:1px solid var(--brass-light);border-radius:4px}
.library-grid button{width:100%;aspect-ratio:1;min-height:0;padding:4px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--ink) 6%,transparent)}
.library-grid img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}
.upload{display:flex;flex-direction:column;gap:8px}
.upload-button{position:relative;display:inline-flex;align-self:flex-start;align-items:center;margin:0;min-height:38px;padding:6px 16px;border:1px solid var(--button-border);border-radius:3px;background:linear-gradient(var(--button-bg-from),var(--button-bg-to));font-weight:600}
.upload-button input{position:absolute;inset:0;opacity:0}
.hint{margin:0;font-size:13px;color:var(--muted-ink)}
.problem{margin:10px 0 0;font-size:13px;color:#c0392b}
.hotspot-editor{display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:start}
.hotspot-frame{padding:10px;border:1px solid var(--brass-light);border-radius:4px;background:repeating-conic-gradient(#0000 0 25%,#8882 0 50%) 0 0/16px 16px}
.hotspot-image{position:relative}
.hotspot-image img{display:block;width:100%;height:100%;image-rendering:pixelated;pointer-events:none;user-select:none}
.hotspot-mark{position:absolute;width:15px;height:15px;margin:-7px 0 0 -7px;border:2px solid #e03c31;border-radius:50%;box-shadow:0 0 0 1px #fff;pointer-events:none}
.hotspot-mark::after{content:'';position:absolute;left:50%;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;background:#e03c31;border-radius:50%}
.hotspot-side{display:flex;flex-direction:column;gap:10px;min-width:0}
.presets{display:flex;flex-wrap:wrap;gap:6px}
.presets button{min-height:30px;padding:2px 10px;font-size:13px}
.name-field{display:flex;flex-direction:column;gap:4px;margin:0}
.try-area{display:flex;align-items:center;justify-content:center;min-height:84px;padding:10px;text-align:center;font-size:13px;border:1px dashed var(--brass);border-radius:4px;background:color-mix(in srgb,var(--ink) 5%,transparent)}
.dialog-actions{display:flex;justify-content:space-between;gap:10px;margin-top:16px}
@media(max-width:560px){.hotspot-editor{grid-template-columns:1fr}.hotspot-frame{justify-self:center}}
</style>
