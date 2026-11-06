<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';

import { useEscapeClose } from '../../ui/escapeStack';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{
  sceneName: string;
  widthCells: number;
  heightCells: number;
  feetPerUnit: number;
  backgroundUrl: string | null;
  hasBackground: boolean;
  rotation: number;
  busy: boolean;
  focus?: 'size' | 'picture';
}>();
const emit = defineEmits<{
  close: [];
  saveSize: [size: { widthCells: number; heightCells: number; feetPerUnit: number }];
  upload: [file: File];
  rotate: [delta: number];
  clearBackground: [];
}>();
useEscapeClose(() => emit('close'));

const width = ref(props.widthCells);
const height = ref(props.heightCells);
const feet = ref(props.feetPerUnit);
watch(() => [props.widthCells, props.heightCells, props.feetPerUnit], () => {
  width.value = props.widthCells;
  height.value = props.heightCells;
  feet.value = props.feetPerUnit;
});
const sizeDirty = () => width.value !== props.widthCells || height.value !== props.heightCells || feet.value !== props.feetPerUnit;
const sizeValid = () => Number.isInteger(width.value) && width.value >= 1 && width.value <= 200
  && Number.isInteger(height.value) && height.value >= 1 && height.value <= 200
  && Number(feet.value) > 0 && Number(feet.value) <= 100;

function saveSize() {
  if (!sizeValid()) return;
  emit('saveSize', { widthCells: width.value, heightCells: height.value, feetPerUnit: Number(feet.value) });
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) emit('upload', file);
}

const sizeSection = ref<HTMLElement | null>(null);
const pictureSection = ref<HTMLElement | null>(null);
onMounted(async () => {
  await nextTick();
  const target = props.focus === 'picture' ? pictureSection.value : sizeSection.value;
  target?.scrollIntoView({ block: 'nearest' });
  if (props.focus !== 'picture') target?.querySelector<HTMLElement>('input')?.focus();
});
</script>

<template>
  <div class="map-dialog" role="dialog" aria-modal="true" :aria-label="`Настройки карты: ${sceneName}`" @click.self="emit('close')">
    <div class="map-card">
      <header class="map-header">
        <h3>Настройки карты <small>«{{ sceneName }}»</small></h3>
        <button type="button" class="map-close" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>

      <section ref="sizeSection" class="map-section" :class="{ focused: focus !== 'picture' }">
        <h4>Размер</h4>
        <div class="size-grid">
          <label>Ширина, клеток<input v-model.number="width" type="number" min="1" max="200" step="1" :disabled="busy" /></label>
          <label>Высота, клеток<input v-model.number="height" type="number" min="1" max="200" step="1" :disabled="busy" /></label>
          <label>Футов на клетку<input v-model.number="feet" type="number" min="0.5" max="100" step="0.5" :disabled="busy" /></label>
        </div>
        <p class="hint">Карта — {{ Math.round(width * feet) }}×{{ Math.round(height * feet) }} фут. Дальность обзора и освещение — в окне «Свет».</p>
        <button type="button" class="primary" :disabled="busy || !sizeDirty() || !sizeValid()" @click="saveSize">Сохранить размер</button>
      </section>

      <section ref="pictureSection" class="map-section" :class="{ focused: focus === 'picture' }">
        <h4>Картинка карты</h4>
        <div class="picture-row">
          <span class="picture-preview" aria-hidden="true">
            <img v-if="backgroundUrl" :src="backgroundUrl" alt="" :style="rotation ? { transform: `rotate(${rotation}deg)` } : undefined" />
            <span v-else>{{ hasBackground ? '…' : 'нет картинки' }}</span>
          </span>
          <div class="picture-actions">
            <label class="upload-button">
              {{ hasBackground ? 'Другая картинка…' : 'Выбрать картинку…' }}
              <input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="onFile" />
            </label>
            <template v-if="hasBackground">
              <span class="rotate-row" role="group" aria-label="Поворот картинки карты">
                <button type="button" :disabled="busy" title="Повернуть на 90° против часовой" @click="emit('rotate', -90)">⟲ 90°</button>
                <span class="muted">{{ rotation }}°</span>
                <button type="button" :disabled="busy" title="Повернуть на 90° по часовой" @click="emit('rotate', 90)">⟳ 90°</button>
              </span>
              <button type="button" :disabled="busy" @click="emit('clearBackground')">Убрать картинку</button>
            </template>
          </div>
        </div>
        <p class="hint">PNG, JPEG или WebP, до 10 МБ. Картинка растягивается на всю карту.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.map-dialog{position:fixed;inset:0;z-index:3100;background:#000a;display:flex;align-items:center;justify-content:center;padding:20px}
.map-card{width:min(560px,100%);max-height:90vh;overflow-y:auto;padding:22px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 16px 40px #0008}
.map-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.map-header h3{margin:0}
.map-header small{font-weight:400;opacity:.75}
.map-close{min-height:32px;width:32px;padding:0}
.map-section{display:flex;flex-direction:column;gap:8px;padding:12px;margin-bottom:10px;border:1px solid var(--brass-light);border-radius:4px}
.map-section.focused{border-color:var(--brass)}
.map-section h4{margin:0}
.size-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.size-grid label{display:flex;flex-direction:column;gap:4px;margin:0;font-size:13px}
.size-grid input{min-width:0}
.map-section > .primary{align-self:flex-start}
.picture-row{display:flex;gap:12px;align-items:flex-start}
.picture-preview{flex:none;display:grid;place-items:center;width:132px;height:96px;overflow:hidden;border:1px solid var(--brass-light);border-radius:3px;background:#0003;font-size:12px;color:var(--muted-ink)}
.picture-preview img{width:100%;height:100%;object-fit:cover}
.picture-actions{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.upload-button{position:relative;display:inline-flex;align-items:center;margin:0;min-height:36px;padding:6px 14px;border:1px solid var(--button-border);border-radius:3px;background:linear-gradient(var(--button-bg-from),var(--button-bg-to));font-weight:600;cursor:pointer}
.upload-button input{position:absolute;inset:0;opacity:0;cursor:pointer}
.rotate-row{display:flex;align-items:center;gap:6px}
.hint{margin:0;font-size:12px;color:var(--muted-ink)}
@media(max-width:520px){.size-grid{grid-template-columns:1fr}.picture-row{flex-direction:column}}
</style>
