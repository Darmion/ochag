<script setup lang="ts">
import { computed, ref } from 'vue';

import { useEscapeClose } from '../../ui/escapeStack';
import { cropStyle, DEFAULT_CROP, dragCrop, MAX_ZOOM, normalizeCrop, zoomCrop, type ImageCrop } from '../../art/imageCrop';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{
  src: string;
  crop: unknown;
  shape: 'avatar' | 'banner' | 'portrait';
  title: string;
  busy?: boolean;
}>();
const emit = defineEmits<{ close: []; save: [crop: ImageCrop | null] }>();
useEscapeClose(() => emit('close'));

const current = ref<ImageCrop>(normalizeCrop(props.crop) ?? { ...DEFAULT_CROP, ...(props.shape === 'portrait' ? { y: 20 } : {}) });
const style = computed(() => cropStyle(current.value));

const frame = ref<HTMLElement | null>(null);
let last: { x: number; y: number } | null = null;
function down(event: PointerEvent) {
  last = { x: event.clientX, y: event.clientY };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function move(event: PointerEvent) {
  if (!last || !frame.value) return;
  const rect = frame.value.getBoundingClientRect();
  current.value = dragCrop(current.value, event.clientX - last.x, event.clientY - last.y, rect);
  last = { x: event.clientX, y: event.clientY };
}
function up() { last = null; }
function wheel(event: WheelEvent) {
  current.value = zoomCrop(current.value, current.value.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08));
}
function key(event: KeyboardEvent) {
  const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const direction = moves[event.key];
  if (!direction || !frame.value) return;
  event.preventDefault();
  const rect = frame.value.getBoundingClientRect();
  const step = event.shiftKey ? 0.1 : 0.02;
  current.value = dragCrop(current.value, direction[0] * rect.width * step, direction[1] * rect.height * step, rect);
}

const FRAME_LABEL = { avatar: 'Аватар — кружок в списке кампаний и в шапке', banner: 'Баннер — полоса над названием кампании', portrait: 'Портрет — в «Отряде», очереди хода, листе' };
</script>

<template>
  <div class="crop-dialog" role="dialog" aria-modal="true" :aria-label="title" @click.self="emit('close')">
    <div class="crop-card">
      <header class="crop-header">
        <h3>{{ title }}</h3>
        <button type="button" class="crop-close" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <p class="hint">{{ FRAME_LABEL[shape] }}. Тащите картинку мышью, приближайте колесом или ползунком; стрелки — точнее. Картинка остаётся целой.</p>

      <div class="crop-stage">
        <div
          ref="frame" class="crop-frame" :class="shape" tabindex="0"
          role="img" aria-label="Кадр: тащите, чтобы сдвинуть"
          @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @wheel.prevent="wheel" @keydown="key"
        >
          <img :src="src" alt="" draggable="false" :style="style" />
          <span v-if="shape === 'avatar'" class="circle-guide" aria-hidden="true" />
        </div>
        <div v-if="shape !== 'banner'" class="crop-previews" aria-label="Как это будет выглядеть">
          <figure><span class="pv circle"><img :src="src" alt="" :style="style" /></span><figcaption>медаль</figcaption></figure>
          <figure><span class="pv card"><img :src="src" alt="" :style="style" /></span><figcaption>«Отряд»</figcaption></figure>
          <figure><span class="pv square"><img :src="src" alt="" :style="style" /></span><figcaption>лист</figcaption></figure>
        </div>
      </div>

      <label class="zoom-row">
        Приближение
        <input type="range" min="1" :max="MAX_ZOOM" step="0.01" :value="current.zoom" @input="current = zoomCrop(current, Number(($event.target as HTMLInputElement).value))" />
        <b>{{ Math.round(current.zoom * 100) }}%</b>
      </label>

      <footer class="crop-actions">
        <button type="button" :disabled="busy" title="Вся картинка по середине" @click="current = { ...DEFAULT_CROP }">По центру</button>
        <span class="spacer" />
        <button type="button" :disabled="busy" @click="emit('close')">Отмена</button>
        <button type="button" class="primary" :disabled="busy" @click="emit('save', normalizeCrop(current))">Сохранить кадр</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.crop-dialog{position:fixed;inset:0;z-index:3200;background:#000b;display:flex;align-items:center;justify-content:center;padding:20px}
.crop-card{width:min(640px,100%);max-height:92vh;overflow-y:auto;padding:20px 22px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 16px 40px #0008}
.crop-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.crop-header h3{margin:0}
.crop-close{min-height:32px;width:32px;padding:0}
.hint{margin:0 0 12px;font-size:13px;color:var(--muted-ink)}
.crop-stage{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.crop-frame{position:relative;flex:none;overflow:hidden;cursor:grab;touch-action:none;border-radius:4px;background:repeating-conic-gradient(#0000 0 25%,#8882 0 50%) 0 0/16px 16px;box-shadow:inset 0 0 0 2px var(--brass),0 0 0 1px #0008;outline-offset:3px}
.crop-frame:active{cursor:grabbing}
.crop-frame.avatar{width:240px;height:240px}
.crop-frame.portrait{width:220px;height:264px}
.crop-frame.banner{width:min(580px,100%);aspect-ratio:5/1}
.crop-frame img{display:block;width:100%;height:100%;object-fit:cover;user-select:none;pointer-events:none}
.circle-guide{position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 999px #0007,inset 0 0 0 2px #fff8;pointer-events:none}
.crop-previews{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap}
.crop-previews figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11px;color:var(--muted-ink)}
.pv{display:block;overflow:hidden;background:#0003;box-shadow:inset 0 0 0 1px var(--brass)}
.pv img{display:block;width:100%;height:100%;object-fit:cover}
.pv.circle{width:64px;height:64px;border-radius:50%}
.pv.card{width:72px;height:88px;border-radius:4px}
.pv.square{width:56px;height:56px;border-radius:6px}
.zoom-row{display:flex;align-items:center;gap:10px;margin:14px 0 0;font-size:13px}
.zoom-row input{flex:1}
.crop-actions{display:flex;align-items:center;gap:8px;margin-top:16px}
.crop-actions .spacer{flex:1}
</style>
