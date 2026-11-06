<script setup lang="ts">
import { computed, ref } from 'vue';

import { t } from '../../i18n/i18n';
import { setTurnNotify, turnNotifyEnabled } from '../../campaign/turnAlert';
import {
  AMBIENCE_PLACES, AMBIENCE_STEPS, AMBIENCE_WATERS, ambienceEnabled, ambienceVolume, sceneSurface,
  type SceneAmbience,
} from '../../tabletop/ambience';
import {
  clearCustomSound, customSoundNames, previewSfx, resetSfx, setCustomSound, setSfxPref, sfxChoice, sfxEventVolume,
  SFX_EVENTS, SFX_GROUPS, type SfxEvent, type SfxShape,
} from '../../tabletop/sfx';
import { sfxVolume } from '../../tabletop/sounds';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{
  section: 'ambience' | 'events';
  sceneAmbience: unknown;
  sceneName: string;
  canManage: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{
  saveAmbience: [ambience: SceneAmbience];
}>();

const ambience = computed<SceneAmbience>(() => (props.sceneAmbience && typeof props.sceneAmbience === 'object' ? props.sceneAmbience as SceneAmbience : {}));
const sceneVolume = computed(() => Math.round((ambience.value.volume ?? 0.7) * 100));

function saveAmbience(patch: SceneAmbience) {
  emit('saveAmbience', { place: 'none', water: 'none', volume: 0.7, steps: 'auto', ...ambience.value, ...patch });
}

const ambienceSummary = computed(() => {
  const place = AMBIENCE_PLACES.find(entry => entry.id === (ambience.value.place ?? 'none'));
  const water = AMBIENCE_WATERS.find(entry => entry.id === ambience.value.water && entry.id !== 'none');
  if ((!place || place.id === 'none') && !water) return t('Мастер не задал этой сцене звуков места.');
  return [place && place.id !== 'none' ? t(place.label) : '', water ? t(water.label) : ''].filter(Boolean).join(' · ');
});

const errors = ref<Partial<Record<SfxEvent, string>>>({});
const fileInput = ref<HTMLInputElement | null>(null);
let fileFor: SfxEvent | null = null;

function choose(id: SfxEvent, value: string) {
  errors.value = { ...errors.value, [id]: '' };
  if (value === 'custom' && !customSoundNames.value[id]) {
    fileFor = id;
    fileInput.value?.click();
    return;
  }
  setSfxPref(id, { choice: value });
}

async function fileChosen(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  const id = fileFor;
  fileFor = null;
  if (!file || !id) return;
  const problem = await setCustomSound(id, file);
  errors.value = { ...errors.value, [id]: problem ?? '' };
  if (!problem) previewSfx(id, 'custom');
}

function replaceFile(id: SfxEvent) {
  fileFor = id;
  fileInput.value?.click();
}

const SHAPES: Array<SfxShape | null> = [null, 'circle', 'cone'];
const previewTurn = new Map<SfxEvent, number>();
function preview(id: SfxEvent) {
  const turn = previewTurn.get(id) ?? 0;
  previewTurn.set(id, turn + 1);
  previewSfx(id, sfxChoice(id), { shape: id.startsWith('spell-') ? SHAPES[turn % SHAPES.length] : null, surface: sceneSurface(ambience.value) });
}

const openGroup = ref<string>('combat');
const confirmReset = ref(false);
async function reset() {
  if (!confirmReset.value) {
    confirmReset.value = true;
    return;
  }
  confirmReset.value = false;
  await resetSfx();
}
</script>

<template>
  <div class="sound-sections">
    <template v-if="section === 'ambience'">
      <section class="sound-section">
        <h4>{{ t('Звуки места на сцене «{name}»', { name: sceneName }) }}</h4>
        <template v-if="canManage">
          <p class="hint">{{ t('Для всех на этой сцене. Днём и ночью (по часам кампании), в дождь и грозу (по погоде сцены) фон меняется сам.') }}</p>
          <div class="ambience-grid">
            <label class="field">
              {{ t('Место') }}
              <select :value="ambience.place ?? 'none'" :disabled="busy" @change="saveAmbience({ place: ($event.target as HTMLSelectElement).value as SceneAmbience['place'] })">
                <option v-for="entry in AMBIENCE_PLACES" :key="entry.id" :value="entry.id">{{ t(entry.label) }}</option>
              </select>
            </label>
            <label class="field">
              {{ t('Вода рядом') }}
              <select :value="ambience.water ?? 'none'" :disabled="busy" @change="saveAmbience({ water: ($event.target as HTMLSelectElement).value as SceneAmbience['water'] })">
                <option v-for="entry in AMBIENCE_WATERS" :key="entry.id" :value="entry.id">{{ t(entry.label) }}</option>
              </select>
            </label>
            <label class="field">
              {{ t('Под ногами (шаги)') }}
              <select :value="ambience.steps ?? 'auto'" :disabled="busy" @change="saveAmbience({ steps: ($event.target as HTMLSelectElement).value as SceneAmbience['steps'] })">
                <option v-for="entry in AMBIENCE_STEPS" :key="entry.id" :value="entry.id">{{ t(entry.label) }}</option>
              </select>
            </label>
            <label class="field">
              {{ t('Громкость для всех: {volume}%', { volume: sceneVolume }) }}
              <input type="range" min="0" max="100" step="5" :value="sceneVolume" :disabled="busy" @change="saveAmbience({ volume: Number(($event.target as HTMLInputElement).value) / 100 })">
            </label>
          </div>
        </template>
        <p v-else class="hint">{{ ambienceSummary }}</p>
      </section>
      <section class="sound-section">
        <h4>{{ t('У меня') }}</h4>
        <label class="check">
          <input v-model="ambienceEnabled" type="checkbox">
          {{ t('Слышать звуки места (лес, пещера, дождь, река)') }}
        </label>
        <label v-if="ambienceEnabled" class="row">
          <span>{{ t('Звуки места: {volume}%', { volume: Math.round(ambienceVolume * 100) }) }}</span>
          <input type="range" min="0" max="100" step="5" :value="Math.round(ambienceVolume * 100)" @input="ambienceVolume = Number(($event.target as HTMLInputElement).value) / 100">
        </label>
      </section>
    </template>

    <template v-else>
      <section class="sound-section">
        <h4>{{ t('«Ваш ход»') }}</h4>
        <label class="check">
          <input type="checkbox" :checked="turnNotifyEnabled" @change="setTurnNotify(($event.target as HTMLInputElement).checked)">
          {{ t('Если игра свёрнута — системное уведомление и мигающая кнопка на панели задач') }}
        </label>
        <p class="hint">{{ t('Звук своего хода — «Ваш ход» в разделе «Бой» ниже.') }}</p>
      </section>
      <section class="sound-section">
        <h4>{{ t('Звук каждого события') }}</h4>
        <p class="hint">{{ t('Всё здесь — только у вас, на этом компьютере. «Свой файл» — короткий звук до 512 КБ (OGG, MP3, WAV).') }}</p>
        <label class="row">
          <span>{{ t('Звуки стола: {volume}%', { volume: Math.round(sfxVolume * 100) }) }}{{ sfxVolume === 0 ? t(' (выключены)') : '' }}</span>
          <input type="range" min="0" max="100" step="5" :value="Math.round(sfxVolume * 100)" @input="sfxVolume = Number(($event.target as HTMLInputElement).value) / 100" @change="previewSfx('melee-hit')">
        </label>
        <div v-for="group in SFX_GROUPS" :key="group.id" class="group">
          <button type="button" class="group-head" :aria-expanded="openGroup === group.id" @click="openGroup = openGroup === group.id ? '' : group.id">
            <span>{{ openGroup === group.id ? '▾' : '▸' }} {{ t(group.label) }}</span>
          </button>
          <div v-if="openGroup === group.id" class="events">
            <div v-for="entry in SFX_EVENTS.filter(item => item.group === group.id)" :key="entry.id" class="event">
              <div class="event-name">
                <strong>{{ t(entry.label) }}</strong>
                <span v-if="entry.hint" class="event-hint">{{ t(entry.hint) }}</span>
              </div>
              <select :value="sfxChoice(entry.id)" :aria-label="t(entry.label)" @change="choose(entry.id, ($event.target as HTMLSelectElement).value)">
                <option v-for="choice in entry.choices" :key="choice.id" :value="choice.id">{{ t(choice.label) }}</option>
                <option value="custom">{{ customSoundNames[entry.id] ? t('Свой файл: {name}', { name: customSoundNames[entry.id]! }) : t('Свой файл…') }}</option>
                <option value="off">{{ t('Без звука') }}</option>
              </select>
              <input
                type="range" min="0" max="100" step="5" class="event-volume"
                :value="Math.round(sfxEventVolume(entry.id) * 100)"
                :title="t('Громкость: {volume}%', { volume: Math.round(sfxEventVolume(entry.id) * 100) })"
                :aria-label="t('Громкость: {volume}%', { volume: Math.round(sfxEventVolume(entry.id) * 100) })"
                :disabled="sfxChoice(entry.id) === 'off'"
                @input="setSfxPref(entry.id, { volume: Number(($event.target as HTMLInputElement).value) / 100 })"
              >
              <button type="button" class="play" :title="t('Послушать')" :aria-label="t('Послушать')" :disabled="sfxChoice(entry.id) === 'off'" @click="preview(entry.id)"><GameIcon name="play" :size="14" /></button>
              <div v-if="customSoundNames[entry.id] && sfxChoice(entry.id) === 'custom'" class="custom-line">
                <button type="button" class="link" @click="replaceFile(entry.id)">{{ t('Другой файл') }}</button>
                <button type="button" class="link" @click="clearCustomSound(entry.id)">{{ t('Убрать свой файл') }}</button>
              </div>
              <p v-if="errors[entry.id]" class="hint warn custom-line">{{ t(errors[entry.id]!) }}</p>
            </div>
          </div>
        </div>
        <input ref="fileInput" type="file" accept="audio/*,.ogg,.mp3,.wav,.webm,.m4a" hidden @change="fileChosen">
      </section>
      <footer class="actions">
        <button type="button" :class="{ danger: confirmReset }" @click="reset">{{ confirmReset ? t('Точно сбросить? Свои файлы удалятся') : t('Сбросить мои звуки') }}</button>
      </footer>
    </template>
    <p class="credit">{{ t('Звуки и фон мест — набор «Free Fantasy SFX Pack», TomMusic (tommusic.itch.io).') }}</p>
  </div>
</template>

<style scoped>
.sound-sections{display:flex;flex-direction:column}
.hint{margin:0 0 10px;font-size:13px;color:var(--muted-ink)}
.hint.warn{color:var(--burgundy)}
.sound-section{padding:10px 0;border-top:1px solid var(--brass-light)}
.sound-section:first-child{border-top:0;padding-top:0}
.sound-section h4{margin:0 0 10px}
.row{display:flex;flex-direction:column;gap:4px;margin:0 0 10px;font-size:13px;font-weight:600}
.check{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:13px}
.check input{width:auto;margin:0}
.ambience-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.field{display:flex;flex-direction:column;gap:4px;margin:0;font-size:13px;font-weight:600}
.group{border:1px solid var(--brass-light);border-radius:4px;margin:0 0 8px}
.group-head{width:100%;display:flex;justify-content:space-between;min-height:34px;padding:4px 10px;background:none;border:0;font-weight:700;text-align:left;cursor:pointer;color:inherit}
.events{padding:4px 10px 10px}
.event{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,236px) 72px 32px;align-items:center;gap:8px;padding:6px 0;border-top:1px dashed var(--brass-light)}
.event:first-child{border-top:0}
.event-name{display:flex;flex-direction:column;min-width:0;font-size:13px}
.event-hint{font-size:11px;color:var(--muted-ink)}
.event select{min-width:0;font-size:13px}
.event-volume{width:72px;margin:0}
.play{min-height:30px;width:32px;padding:0}
@media (max-width:560px){.play{grid-row:1;grid-column:2}}
.custom-line{grid-column:1 / -1;display:flex;gap:12px;margin:0;font-size:12px}
.link{background:none;border:0;padding:0;min-height:0;color:var(--burgundy);text-decoration:underline;cursor:pointer;font-size:12px}
.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px;flex-wrap:wrap}
.actions button{min-height:34px;padding:4px 14px}
.actions .danger{color:var(--burgundy);border-color:var(--burgundy)}
.credit{margin:10px 0 0;font-size:11px;color:var(--muted-ink);text-align:right}
@media (max-width:560px){
  .event{grid-template-columns:minmax(0,1fr) 32px}
  .event select,.event-volume{grid-column:1 / -1;width:100%}
}
</style>
