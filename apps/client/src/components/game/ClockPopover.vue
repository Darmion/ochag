<script setup lang="ts">
import { ref } from 'vue';

import { useEscapeClose } from '../../ui/escapeStack';
import { clockText, dayPhase, nextHour, PHASE_INFO, WEATHER_INFO, type Weather } from '../../campaign/worldClock';
import GameIcon from './GameIcon.vue';

const props = defineProps<{
  campaignId: string;
  minutes: number;
  weather: Weather;
  scenePath: string;
  busy: boolean;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();
const emit = defineEmits<{ changed: [message: string]; close: []; light: [] }>();
useEscapeClose(() => emit('close'));

const working = ref(false);
const error = ref('');

async function put(body: Record<string, number>) {
  working.value = true;
  error.value = '';
  try {
    const time = await props.request(`/campaigns/${props.campaignId}/time`, 'PUT', body);
    emit('changed', `Время кампании: ${time.text}.`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}
const advance = (advanceMinutes: number) => put({ advanceMinutes });
async function setWeather(weather: Weather) {
  working.value = true;
  error.value = '';
  try {
    await props.request(props.scenePath, 'PATCH', { weather });
    emit('changed', `Погода: ${WEATHER_INFO[weather].label.toLowerCase()}.`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}
const setTime = (hour: number) => put({ minutes: nextHour(props.minutes, hour) });
</script>

<template>
  <div class="clock-popover g-frame" role="dialog" aria-label="Время и погода">
    <p class="clock-now">
      <GameIcon class="inline-icon" :name="PHASE_INFO[dayPhase(minutes)].icon" :size="16" />
      <strong>{{ clockText(minutes) }}</strong> — {{ PHASE_INFO[dayPhase(minutes)].label }}
    </p>
    <div class="clock-buttons">
      <button type="button" :disabled="busy || working" @click="advance(10)">+10 мин</button>
      <button type="button" :disabled="busy || working" @click="advance(60)">+1 ч</button>
      <button type="button" :disabled="busy || working" @click="advance(480)">+8 ч</button>
      <button type="button" :disabled="busy || working" title="Следующее утро, 6:00" @click="setTime(6)">Утро</button>
      <button type="button" :disabled="busy || working" title="Ближайший полдень" @click="setTime(12)">Полдень</button>
      <button type="button" :disabled="busy || working" title="Ближайший вечер, 19:00" @click="setTime(19)">Вечер</button>
      <button type="button" :disabled="busy || working" title="Ближайшая полночь" @click="setTime(0)">Полночь</button>
    </div>
    <label class="clock-weather">
      Погода на сцене
      <select :value="weather" :disabled="busy || working" @change="setWeather(($event.target as HTMLSelectElement).value as Weather)">
        <option v-for="(info, key) in WEATHER_INFO" :key="key" :value="key">{{ info.label }}</option>
      </select>
    </label>
    <p class="clock-hint">{{ WEATHER_INFO[weather].hint }}</p>
    <p class="clock-hint">Отдых и бой двигают время сами. Освещение, туман и обзор — <button type="button" class="link-button" @click="emit('light')">окно «Свет»</button>.</p>
    <p v-if="error" class="clock-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.clock-popover{position:absolute;left:0;top:calc(100% + 6px);z-index:30;width:300px;display:flex;flex-direction:column;gap:8px;padding:12px;color:var(--g-text,#eadbc0);background:var(--g-panel,#1c130c);box-shadow:0 12px 26px #000c;text-align:left;cursor:default}
.clock-now{margin:0;font-size:13px}
.clock-buttons{display:flex;flex-wrap:wrap;gap:5px}
.clock-buttons button{min-height:30px;padding:2px 9px;font-size:12px}
.clock-hint{margin:0;font-size:11px;color:var(--g-text-dim,#bba)}
.clock-weather{display:flex;flex-direction:column;gap:3px;margin:0;font-size:12px}
.link-button{display:inline;min-height:0;padding:0;border:0;background:none;box-shadow:none;color:var(--g-gold-hi,#e8c26a);font:inherit;text-decoration:underline;cursor:pointer}
.clock-error{margin:0;font-size:12px;color:#e88}
</style>
