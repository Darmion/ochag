<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { musicOffScene, type AudioState, type LocalAudioSettings } from '../../tabletop/audio';
import GameIcon from '../game/GameIcon.vue';

type AudioAsset = { id: string; original_filename: string | null };

const props = defineProps<{
  state: AudioState | null;
  canManage: boolean;
  busy: boolean;
  library: AudioAsset[];
  local: LocalAudioSettings;
  blocked: boolean;
  sceneName?: string;
  sceneId?: string;
  scenePlaylist?: string[];
  sceneMoodPlaylists?: { combat?: string[]; tension?: string[] };
  campaignId?: string;
  recipients?: Array<{ userId: string; displayName: string }>;
  soundsElsewhere?: boolean;
  section?: 'music' | 'effects';
}>();
const showMusic = computed(() => props.section !== 'effects');
const showEffects = computed(() => props.section !== 'music');

const emit = defineEmits<{
  control: [payload: {
    action: 'play' | 'pause' | 'stop' | 'next' | 'previous';
    assetId?: string;
    queue?: string[];
    loop?: boolean;
    volume?: number;
    sceneId?: string | null;
  }];
  playlist: [tracks: string[]];
  moodPlaylist: [payload: { mood: 'combat' | 'tension'; tracks: string[] }];
  mood: [mood: 'explore' | 'combat' | 'tension'];
  effect: [payload: { assetId: string; volume: number; mode: 'overlap' | 'interrupt'; userIds: string[] }];
  stopEffects: [];
  needRecipients: [];
  upload: [file: File];
  'update:local': [value: LocalAudioSettings];
  unlock: [];
  sounds: [];
}>();

const chosenTrack = ref('');
const trackToAdd = ref('');

type Mood = 'explore' | 'combat' | 'tension';
const MOOD_LABELS: Record<Mood, string> = { explore: 'Исследование', combat: 'Бой', tension: 'Напряжение' };
const moodTab = ref<Mood>('explore');
const playlist = computed(() => (moodTab.value === 'explore' ? props.scenePlaylist ?? [] : props.sceneMoodPlaylists?.[moodTab.value] ?? []));
function emitList(tracks: string[]) {
  if (moodTab.value === 'explore') emit('playlist', tracks);
  else emit('moodPlaylist', { mood: moodTab.value, tracks });
}
const queue = computed(() => props.state?.queue ?? []);
const queuePosition = computed(() => {
  const index = props.state?.asset_id ? queue.value.indexOf(props.state.asset_id) : -1;
  return index === -1 ? '' : `трек ${index + 1} из ${queue.value.length}`;
});

function movePlaylistTrack(index: number, delta: number) {
  const next = [...playlist.value];
  const target = index + delta;
  if (target < 0 || target >= next.length) return;
  [next[index], next[target]] = [next[target]!, next[index]!];
  emitList(next);
}

function addPlaylistTrack() {
  if (!trackToAdd.value || playlist.value.includes(trackToAdd.value)) return;
  emitList([...playlist.value, trackToAdd.value]);
  trackToAdd.value = '';
}

function trackName(assetId: string | null) {
  if (!assetId) return '';
  return props.library.find(a => a.id === assetId)?.original_filename ?? props.state?.asset_name ?? 'трек';
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) emit('upload', file);
}

function setLocal(patch: Partial<LocalAudioSettings>) {
  emit('update:local', { ...props.local, ...patch });
}

function playChosen() {
  const assetId = chosenTrack.value || props.state?.asset_id || '';
  if (assetId) emit('control', { action: 'play', assetId, ...(chosenIsOther.value ? { sceneId: null } : {}) });
}

const offScene = computed(() => musicOffScene(props.state, props.sceneId ?? ''));
const scopeValue = computed(() => props.state?.scene_id ?? '');
const scopeOptions = computed(() => {
  const options: Array<{ value: string; label: string }> = [{ value: '', label: 'на всех сценах' }];
  if (props.state?.scene_id) options.push({ value: props.state.scene_id, label: `только на сцене «${props.state.scene_name ?? '…'}»` });
  if (props.sceneId && props.sceneId !== props.state?.scene_id) options.push({ value: props.sceneId, label: `только на этой сцене «${props.sceneName || '…'}»` });
  return options;
});
function setScope(value: string) {
  if (!props.state?.asset_id || value === scopeValue.value) return;
  emit('control', { action: props.state.playing ? 'play' : 'pause', sceneId: value || null });
}

const paused = computed(() => Boolean(props.state && !props.state.playing && props.state.asset_id && props.state.paused_at_seconds > 0));
const chosenIsOther = computed(() => Boolean(chosenTrack.value && chosenTrack.value !== props.state?.asset_id));
const mainLabel = computed(() => chosenIsOther.value ? 'Включить выбранный'
  : props.state?.playing ? 'Пауза' : paused.value ? 'Продолжить' : 'Играть');
const mainTitle = computed(() => chosenIsOther.value ? 'Сменить трек на выбранный и включить с начала'
  : props.state?.playing ? 'Пауза: потом продолжится с этого же места'
  : paused.value ? 'Продолжить с того места, где остановились' : 'Включить трек с начала');

function mainAction() {
  if (!chosenIsOther.value && props.state?.playing) emit('control', { action: 'pause' });
  else playChosen();
}

function timeText(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

const prefsKey = computed(() => `ttrpg.effects.${props.campaignId ?? 'default'}`);
type EffectPrefs = { favorites: string[]; volume: number; interrupt: boolean };

function loadPrefs(): EffectPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(prefsKey.value) ?? 'null');
    return {
      favorites: Array.isArray(saved?.favorites) ? saved.favorites.filter((id: unknown) => typeof id === 'string') : [],
      volume: typeof saved?.volume === 'number' ? Math.max(0, Math.min(1, saved.volume)) : 1,
      interrupt: saved?.interrupt !== false,
    };
  } catch {
    return { favorites: [], volume: 1, interrupt: true };
  }
}

const prefs = ref<EffectPrefs>(loadPrefs());
watch(prefsKey, () => { prefs.value = loadPrefs(); });
watch(prefs, value => {
  try {
    localStorage.setItem(prefsKey.value, JSON.stringify(value));
  } catch {
  }
}, { deep: true });

const effectId = ref('');
const audience = ref<'all' | 'some'>('all');
const chosenUsers = ref<string[]>([]);
const favorites = computed(() => props.library.filter(asset => prefs.value.favorites.includes(asset.id)));
const others = computed(() => props.library.filter(asset => !prefs.value.favorites.includes(asset.id)));
const isFavorite = computed(() => Boolean(effectId.value && prefs.value.favorites.includes(effectId.value)));

function toggleFavorite() {
  if (!effectId.value) return;
  prefs.value.favorites = isFavorite.value
    ? prefs.value.favorites.filter(id => id !== effectId.value)
    : [...prefs.value.favorites, effectId.value];
}

function playEffect(assetId = effectId.value) {
  if (!assetId) return;
  if (audience.value === 'some' && !chosenUsers.value.length) return;
  emit('effect', {
    assetId,
    volume: prefs.value.volume,
    mode: prefs.value.interrupt ? 'interrupt' : 'overlap',
    userIds: audience.value === 'some' ? chosenUsers.value : [],
  });
}

watch(audience, value => { if (value === 'some' && !props.recipients?.length) emit('needRecipients'); });
onMounted(() => { if (props.canManage) emit('needRecipients'); });
</script>

<template>
  <div class="audio-panel">
    <template v-if="showMusic">
    <p class="now-playing">
      <template v-if="state?.playing">♫ Сейчас играет: <strong>{{ trackName(state.asset_id) }}</strong>{{ queue.length > 1 && queuePosition ? ` · ${queuePosition}` : '' }}{{ state.loop ? ' · по кругу' : '' }}</template>
      <template v-else-if="paused">⏸ На паузе: {{ trackName(state!.asset_id) }} — на {{ timeText(state!.paused_at_seconds) }}, продолжится с этого места</template>
      <template v-else-if="state?.asset_id">⏹ Остановлено: {{ trackName(state.asset_id) }} — заиграет с начала</template>
      <template v-else>Музыка не играет.</template>
    </p>
    <p v-if="state?.asset_id && state.scene_id" class="scene-scope" :class="{ off: offScene }">
      <template v-if="offScene && canManage"><GameIcon class="inline-icon" name="speakerOff" :size="16" /> Это музыка сцены «{{ state.scene_name ?? '…' }}» — здесь её не слышно; у тех, кто на той сцене, играет.</template>
      <template v-else-if="offScene"><GameIcon class="inline-icon" name="speakerOff" :size="16" /> Музыка играет на другой сцене — здесь её не слышно.</template>
      <template v-else>Слышно только на этой сцене.</template>
    </p>
    <label v-if="canManage && state?.asset_id" class="scope-select">
      Где слышно
      <select :value="scopeValue" :disabled="busy" @change="setScope(($event.target as HTMLSelectElement).value)">
        <option v-for="option in scopeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
    </label>

    <button v-if="blocked" type="button" class="primary" @click="emit('unlock')">
      <GameIcon class="inline-icon" name="speaker" :size="16" /> Включить звук
    </button>

    </template>
    <template v-if="section" />
    <button v-else-if="soundsElsewhere" type="button" class="sounds-button" @click="emit('sounds')"><GameIcon class="inline-icon" name="speaker" :size="16" /> Моя громкость и звуки…</button>
    <fieldset v-else class="local">
      <legend>У меня</legend>
      <label>
        Музыка: {{ Math.round(local.music * 100) }}%
        <input type="range" min="0" max="1" step="0.05" :value="local.music" @input="setLocal({ music: Number(($event.target as HTMLInputElement).value) })" />
      </label>
      <label>
        Звуки: {{ Math.round(local.effects * 100) }}%
        <input type="range" min="0" max="1" step="0.05" :value="local.effects" @input="setLocal({ effects: Number(($event.target as HTMLInputElement).value) })" />
      </label>
      <label class="checkbox-label">
        <input type="checkbox" :checked="local.muted" @change="setLocal({ muted: ($event.target as HTMLInputElement).checked })" />
        Выключить весь звук стола
      </label>
      <button type="button" class="sounds-button" @click="emit('sounds')"><GameIcon class="inline-icon" name="speaker" :size="16" /> Звуки событий, шаги, фон места…</button>
    </fieldset>

    <template v-if="canManage">
      <template v-if="showMusic">
      <fieldset>
        <legend>Музыка для всех</legend>
        <p class="muted">Слышно на всех сценах. Плейлист сцены (ниже) — только на ней.</p>
        <label>
          Трек
          <select v-model="chosenTrack" :disabled="busy || !library.length">
            <option value="">{{ state?.asset_id ? `— текущий: ${trackName(state.asset_id)} —` : '— выберите трек —' }}</option>
            <option v-for="asset in library" :key="asset.id" :value="asset.id">{{ asset.original_filename || asset.id }}</option>
          </select>
        </label>

        <div class="controls">
          <button v-if="queue.length > 1" type="button" :disabled="busy" title="Предыдущий трек" @click="emit('control', { action: 'previous' })"><GameIcon name="skipBack" :size="16" /></button>
          <button type="button" class="primary" :disabled="busy || (!chosenTrack && !state?.asset_id)" :title="mainTitle" @click="mainAction"><GameIcon class="inline-icon" :name="state?.playing && !chosenIsOther ? 'pause' : 'play'" :size="16" /> {{ mainLabel }}</button>
          <button
            type="button" :disabled="busy || !state?.asset_id || (!state.playing && !paused)"
            title="Стоп: остановить и вернуть трек к началу" @click="emit('control', { action: 'stop' })"
          ><GameIcon class="inline-icon" name="stop" :size="16" /> Стоп</button>
          <button v-if="queue.length > 1" type="button" :disabled="busy" title="Следующий трек" @click="emit('control', { action: 'next' })"><GameIcon name="skipForward" :size="16" /></button>
        </div>

        <label class="checkbox-label">
          <input type="checkbox" :checked="state?.loop ?? true" :disabled="busy" @change="emit('control', { action: state?.playing ? 'play' : 'stop', loop: ($event.target as HTMLInputElement).checked })" />
          По кругу
        </label>
        <label>
          Громкость для всех: {{ Math.round((state?.volume ?? 0.8) * 100) }}%
          <input type="range" min="0" max="1" step="0.05" :value="state?.volume ?? 0.8" :disabled="busy" @change="emit('control', { action: state?.playing ? 'play' : 'stop', volume: Number(($event.target as HTMLInputElement).value) })" />
        </label>
      </fieldset>

      <fieldset>
        <legend>Музыка сцены{{ sceneName ? ` «${sceneName}»` : '' }}</legend>
        <nav class="mood-tabs" aria-label="Настроение">
          <button v-for="(label, mood) in MOOD_LABELS" :key="mood" type="button" :aria-pressed="moodTab === mood" @click="moodTab = mood">
            {{ label }}<template v-if="state?.mood === mood && state?.playing"> <GameIcon class="inline-icon" name="music" :size="14" /></template>
          </button>
        </nav>
        <p v-if="moodTab === 'combat'" class="muted">Начало боя на сцене само включает этот плейлист, конец боя возвращает прежнюю музыку с того же места.</p>
        <ol v-if="playlist.length" class="playlist">
          <li v-for="(assetId, index) in playlist" :key="assetId">
            <span class="playlist-name">{{ trackName(assetId) }}</span>
            <button type="button" :disabled="busy || index === 0" aria-label="Выше" @click="movePlaylistTrack(index, -1)">↑</button>
            <button type="button" :disabled="busy || index === playlist.length - 1" aria-label="Ниже" @click="movePlaylistTrack(index, 1)">↓</button>
            <button type="button" :disabled="busy" aria-label="Убрать из плейлиста" @click="emitList(playlist.filter(id => id !== assetId))">×</button>
          </li>
        </ol>
        <p v-else class="muted">Треки «{{ MOOD_LABELS[moodTab].toLowerCase() }}» для этой сцены — по порядку; включаются одной кнопкой.</p>
        <div class="controls">
          <select v-model="trackToAdd" :disabled="busy || !library.length" aria-label="Добавить трек в плейлист сцены">
            <option value="">— добавить трек —</option>
            <option v-for="asset in library.filter(a => !playlist.includes(a.id))" :key="asset.id" :value="asset.id">{{ asset.original_filename || asset.id }}</option>
          </select>
          <button type="button" :disabled="busy || !trackToAdd" @click="addPlaylistTrack">Добавить</button>
        </div>
        <button
          type="button"
          class="primary"
          :disabled="busy || !playlist.length"
          @click="emit('mood', moodTab)"
        >
          <GameIcon class="inline-icon" name="play" :size="16" /> Включить: {{ MOOD_LABELS[moodTab].toLowerCase() }}
        </button>
      </fieldset>

      </template>
      <fieldset v-if="showEffects">
        <legend>Разовые звуки</legend>
        <template v-if="library.length">
          <div v-if="favorites.length" class="effect-chips" aria-label="Избранные звуки">
            <button v-for="asset in favorites" :key="asset.id" type="button" :disabled="busy" :title="`Сыграть «${asset.original_filename || asset.id}»`" @click="playEffect(asset.id)">
              <GameIcon class="inline-icon" name="bell" :size="16" /> {{ asset.original_filename || asset.id }}
            </button>
          </div>
          <div class="controls effect-pick">
            <select v-model="effectId" :disabled="busy" aria-label="Звук">
              <option value="">— выберите звук —</option>
              <optgroup v-if="favorites.length" label="Избранные">
                <option v-for="asset in favorites" :key="asset.id" :value="asset.id">{{ asset.original_filename || asset.id }}</option>
              </optgroup>
              <optgroup label="Все файлы">
                <option v-for="asset in others" :key="asset.id" :value="asset.id">{{ asset.original_filename || asset.id }}</option>
              </optgroup>
            </select>
            <button type="button" :disabled="!effectId" :title="isFavorite ? 'Убрать из избранных' : 'В избранные — кнопкой над списком'" @click="toggleFavorite"><GameIcon class="inline-icon" :name="isFavorite ? 'starFilled' : 'star'" :size="16" /></button>
          </div>
          <label>
            Громкость этого звука: {{ Math.round(prefs.volume * 100) }}%
            <input v-model.number="prefs.volume" type="range" min="0" max="1" step="0.05" :disabled="busy" />
          </label>
          <label class="checkbox-label" title="Иначе новый звук играет поверх тех, что ещё звучат">
            <input v-model="prefs.interrupt" type="checkbox" :disabled="busy" />
            Новый звук прерывает прежние
          </label>
          <label>
            Кому
            <select v-model="audience" :disabled="busy">
              <option value="all">всем за столом</option>
              <option value="some">выбранным игрокам</option>
            </select>
          </label>
          <div v-if="audience === 'some'" class="recipients">
            <label v-for="member in recipients ?? []" :key="member.userId" class="checkbox-label">
              <input v-model="chosenUsers" type="checkbox" :value="member.userId" :disabled="busy" /> {{ member.displayName }}
            </label>
            <p v-if="!(recipients ?? []).length" class="muted">Других участников нет.</p>
          </div>
          <div class="controls">
            <button type="button" class="primary" :disabled="busy || !effectId || (audience === 'some' && !chosenUsers.length)" @click="playEffect()"><GameIcon class="inline-icon" name="play" :size="16" /> Сыграть</button>
            <button type="button" :disabled="busy" title="Оборвать все разовые звуки у всех" @click="emit('stopEffects')"><GameIcon class="inline-icon" name="stop" :size="16" /> Остановить все звуки</button>
          </div>
          <small class="muted">Скачанные звуки хранятся на компьютере каждого и в следующий раз играют сразу.</small>
        </template>
        <p v-else class="muted">Загрузите аудиофайлы — любой можно включить и музыкой, и разовым звуком.</p>
      </fieldset>

      <label>
        Загрузить аудио — MP3, OGG, WAV, FLAC или M4A, до 25 МБ
        <input type="file" accept="audio/*,.mp3,.ogg,.wav,.flac,.m4a" :disabled="busy" @change="onFile" />
      </label>
    </template>
    <p v-else class="muted">Музыку и звуки включает мастер; здесь — только ваша громкость.</p>
  </div>
</template>

<style scoped>
.audio-panel{display:flex;flex-direction:column;gap:10px}
.now-playing{margin:0}
fieldset{border:1px solid var(--brass-light);border-radius:3px;padding:6px 10px;margin:0;display:flex;flex-direction:column;gap:6px}
legend{font-weight:700;padding:0 4px}
.controls{display:flex;gap:6px;flex-wrap:wrap}
.effect-chips{display:flex;flex-wrap:wrap;gap:4px}
.effect-chips button{min-height:28px;padding:2px 8px;font-size:12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.effect-pick select{flex:1 1 160px;min-width:0}
.effect-pick button{min-width:34px}
.recipients{display:flex;flex-direction:column;gap:2px;padding-left:4px}
.recipients label{margin:0;font-size:13px}
.playlist{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px}
.mood-tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}
.mood-tabs button{min-height:26px;padding:2px 10px;font-size:12px}
.mood-tabs button[aria-pressed="true"]{background:var(--burgundy);color:var(--burgundy-text,#fff)}
.playlist li{font-size:13px}
.playlist-name{display:inline-block;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;margin-right:4px}
.playlist button{min-height:24px;min-width:24px;padding:0 4px}
input[type="range"]{width:100%}
.muted{font-size:13px;margin:0}
.scene-scope{margin:2px 0 8px;font-size:13px}
.scene-scope.off{color:color-mix(in srgb, #e0603f 60%, var(--ink))}
.scope-select{display:flex;flex-direction:column;gap:4px;margin:0 0 10px}
.sounds-button{width:100%;margin-top:6px}
</style>
