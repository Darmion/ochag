<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { musicOffTable, setMusicOffTable } from '../../campaign/backgroundMusic';
import { ambienceEnabled, ambienceVolume } from '../../tabletop/ambience';
import { musicOffScene, type AudioState, type LocalAudioSettings } from '../../tabletop/audio';
import { previewSfx } from '../../tabletop/sfx';
import { sfxVolume } from '../../tabletop/sounds';
import GameIcon from './GameIcon.vue';

type AudioAsset = { id: string; original_filename: string | null };
const props = defineProps<{
  state: AudioState | null;
  library: AudioAsset[];
  local: LocalAudioSettings;
  canManage: boolean;
  busy: boolean;
  blocked: boolean;
  sceneId: string;
}>();
const emit = defineEmits<{
  control: [payload: { action: 'play' | 'pause' | 'stop' | 'next' | 'previous'; assetId?: string }];
  'update:local': [value: LocalAudioSettings];
  unlock: [];
  open: [tab: 'music' | 'effects' | 'ambience' | 'events'];
  close: [];
}>();

const trackName = computed(() => {
  const id = props.state?.asset_id;
  if (!id) return '';
  return props.library.find(asset => asset.id === id)?.original_filename ?? props.state?.asset_name ?? 'трек';
});
const paused = computed(() => Boolean(props.state && !props.state.playing && props.state.asset_id && props.state.paused_at_seconds > 0));
const offScene = computed(() => musicOffScene(props.state, props.sceneId));
const queueLong = computed(() => (props.state?.queue?.length ?? 0) > 1);
const status = computed(() => {
  if (props.state?.playing) return `♫ ${trackName.value}`;
  if (paused.value) return `⏸ ${trackName.value} — на паузе`;
  if (props.state?.asset_id) return `⏹ ${trackName.value} — остановлено`;
  return 'Музыка не играет';
});
const scope = computed(() => {
  if (!props.state?.asset_id) return '';
  if (!props.state.scene_id) return 'слышно на всех сценах';
  return offScene.value ? `музыка сцены «${props.state.scene_name ?? '…'}» — здесь не слышно` : 'слышно только на этой сцене';
});

function playPause() {
  if (props.state?.playing) emit('control', { action: 'pause' });
  else if (props.state?.asset_id) emit('control', { action: 'play', assetId: props.state.asset_id });
  else emit('open', 'music');
}
const setLocal = (patch: Partial<LocalAudioSettings>) => emit('update:local', { ...props.local, ...patch });

const root = ref<HTMLElement | null>(null);
function onDocument(event: PointerEvent) {
  const target = event.target as Element | null;
  if (!root.value || !target || root.value.contains(target)) return;
  if (target.closest?.('.game-tool-rail [data-rail="sound"]')) return;
  emit('close');
}
onMounted(() => document.addEventListener('pointerdown', onDocument, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocument, true));
const percent = (value: number) => `${Math.round(value * 100)}%`;
</script>

<template>
  <div ref="root" class="sound-popover" role="dialog" aria-label="Звук" @keydown.esc.stop="emit('close')">
    <header class="sound-head">
      <strong>Звук</strong>
      <button type="button" class="close" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
    </header>

    <button v-if="blocked" type="button" class="unlock" @click="emit('unlock')"><GameIcon class="inline-icon" name="speaker" :size="16" /> Включить звук</button>

    <p class="status" :class="{ off: offScene }" :title="status">{{ status }}</p>
    <small v-if="scope" class="scope">{{ scope }}</small>
    <div v-if="canManage" class="transport" role="group" aria-label="Музыка для всех">
      <button v-if="queueLong" type="button" :disabled="busy" title="Предыдущий трек" @click="emit('control', { action: 'previous' })"><GameIcon class="inline-icon" name="skipBack" :size="16" /></button>
      <button
        type="button" class="main" :disabled="busy"
        :title="state?.playing ? 'Пауза: потом продолжится с этого же места' : paused ? 'Продолжить' : state?.asset_id ? 'Играть' : 'Выбрать музыку…'"
        @click="playPause"
      ><GameIcon class="inline-icon" :name="state?.playing ? 'pause' : 'play'" :size="16" /></button>
      <button type="button" :disabled="busy || !state?.asset_id || (!state.playing && !paused)" title="Стоп: остановить и вернуть трек к началу" @click="emit('control', { action: 'stop' })"><GameIcon class="inline-icon" name="stop" :size="16" /></button>
      <button v-if="queueLong" type="button" :disabled="busy" title="Следующий трек" @click="emit('control', { action: 'next' })"><GameIcon class="inline-icon" name="skipForward" :size="16" /></button>
    </div>

    <div class="volumes">
      <label>
        <span>Музыка <b>{{ percent(local.music) }}</b></span>
        <input type="range" min="0" max="1" step="0.05" :value="local.music" @input="setLocal({ music: Number(($event.target as HTMLInputElement).value) })" />
      </label>
      <label>
        <span>Звуки стола <b>{{ percent(sfxVolume) }}</b></span>
        <input type="range" min="0" max="1" step="0.05" :value="sfxVolume" @input="sfxVolume = Number(($event.target as HTMLInputElement).value)" @change="previewSfx('melee-hit')" />
      </label>
      <label>
        <span>Звуки мастера <b>{{ percent(local.effects) }}</b></span>
        <input type="range" min="0" max="1" step="0.05" :value="local.effects" @input="setLocal({ effects: Number(($event.target as HTMLInputElement).value) })" />
      </label>
      <label>
        <span>
          <input v-model="ambienceEnabled" type="checkbox" class="inline" aria-label="Слышать фон места" />
          Фон места <b>{{ ambienceEnabled ? percent(ambienceVolume) : 'выкл.' }}</b>
        </span>
        <input type="range" min="0" max="1" step="0.05" :disabled="!ambienceEnabled" :value="ambienceVolume" @input="ambienceVolume = Number(($event.target as HTMLInputElement).value)" />
      </label>
    </div>
    <label class="mute">
      <input type="checkbox" :checked="local.muted" @change="setLocal({ muted: ($event.target as HTMLInputElement).checked })" />
      Выключить весь звук стола
    </label>
    <label class="mute" title="Ушли со «Стола» на «Отряд», «Правила» или в лист — музыка последней сцены играет дальше">
      <input type="checkbox" :checked="musicOffTable" @change="setMusicOffTable(($event.target as HTMLInputElement).checked)" />
      Музыка и на других вкладках
    </label>

    <div class="more">
      <button type="button" class="primary" @click="emit('open', 'music')">Всё о звуке…</button>
      <select aria-label="Сразу к разделу" @change="emit('open', ($event.target as HTMLSelectElement).value as 'music'); ($event.target as HTMLSelectElement).value = ''">
        <option value="">раздел…</option>
        <option value="music">{{ canManage ? 'Музыка и плейлисты' : 'Музыка' }}</option>
        <option v-if="canManage" value="effects">Разовые звуки</option>
        <option value="ambience">Фон места</option>
        <option value="events">Звуки событий и «Ваш ход»</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.sound-popover{display:flex;flex-direction:column;gap:8px;width:280px;padding:10px 12px;color:var(--g-text,#f3e2c2)}
.sound-head{display:flex;align-items:center;justify-content:space-between}
.sound-head strong{font:700 14px var(--g-title-font,serif)}
.close{min-height:26px;width:26px;padding:0}
.unlock{min-height:32px}
.status{margin:0;font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.status.off{opacity:.65}
.scope{margin-top:-6px;font-size:11px;opacity:.75}
.transport{display:flex;gap:6px}
.transport button{min-height:32px;min-width:38px;padding:0 8px;font-size:15px}
.transport .main{flex:1}
.volumes{display:flex;flex-direction:column;gap:6px}
.volumes label{display:flex;flex-direction:column;gap:2px;margin:0;font-size:12px}
.volumes span{display:flex;align-items:center;gap:6px}
.volumes span b{margin-left:auto;font-weight:600;opacity:.85}
.volumes input[type=range]{width:100%;margin:0}
.inline{width:auto;margin:0}
.mute{display:flex;align-items:center;gap:6px;margin:0;font-size:12px}
.mute input{width:auto;margin:0}
.more{display:flex;gap:6px}
.more .primary{flex:1;min-height:32px}
.more select{width:96px;min-height:32px;font-size:12px}
</style>
