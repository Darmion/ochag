import { ref, watch } from 'vue';
import { audioContext, playSynth, sfxVolume, tableMuted } from './sounds';
import { SFX_EVENTS, sfxEvent, take, type SfxChoice, type SfxEvent, type SfxShape, type Surface } from './soundCatalog';

export { SFX_EVENTS, SFX_GROUPS, spellSfxEvent, type SfxEvent, type SfxShape } from './soundCatalog';

type EventPref = { choice?: string; volume?: number };
export type SfxPrefs = { events: Partial<Record<SfxEvent, EventPref>> };
const PREFS_KEY = 'ochag.sfx.v1';

function loadPrefs(): SfxPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object' && parsed.events && typeof parsed.events === 'object') return { events: parsed.events };
  } catch {
  }
  return { events: {} };
}

const sfxPrefs = ref<SfxPrefs>(loadPrefs());
watch(sfxPrefs, value => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(value));
  } catch {
  }
}, { deep: true });

export const customSoundNames = ref<Partial<Record<SfxEvent, string>>>({});

export function sfxChoice(id: SfxEvent): string {
  const definition = sfxEvent(id);
  const chosen = sfxPrefs.value.events[id]?.choice;
  if (chosen === 'off') return 'off';
  if (chosen === 'custom' && customSoundNames.value[id]) return 'custom';
  return definition.choices.find(choice => choice.id === chosen)?.id ?? definition.choices[0]!.id;
}

export function sfxEventVolume(id: SfxEvent): number {
  const volume = sfxPrefs.value.events[id]?.volume;
  return typeof volume === 'number' && Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : sfxEvent(id).volume;
}

export function setSfxPref(id: SfxEvent, patch: EventPref) {
  sfxPrefs.value = { events: { ...sfxPrefs.value.events, [id]: { ...sfxPrefs.value.events[id], ...patch } } };
}

const DB_NAME = 'ochag-sfx';
const STORE = 'custom';
const CUSTOM_SOUND_MAX_BYTES = 512 * 1024;
type CustomRecord = { name: string; data: ArrayBuffer };

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).finally(() => db.close()) as Promise<T | null>;
}

const customBuffers = new Map<SfxEvent, AudioBuffer>();

async function loadCustomNames() {
  const keys = (await withStore<IDBValidKey[]>('readonly', store => store.getAllKeys())) ?? [];
  const names: Partial<Record<SfxEvent, string>> = {};
  for (const key of keys) {
    const record = await withStore<CustomRecord>('readonly', store => store.get(key));
    if (record && SFX_EVENTS.some(entry => entry.id === key)) names[key as SfxEvent] = record.name;
  }
  customSoundNames.value = names;
}
if (typeof window !== 'undefined') void loadCustomNames();

export async function setCustomSound(id: SfxEvent, file: File): Promise<string | null> {
  if (file.size > CUSTOM_SOUND_MAX_BYTES) return 'Файл больше 512 КБ — для короткого звука этого хватает с запасом.';
  const ctx = audioContext();
  if (!ctx) return 'Звук в этом окне недоступен.';
  const data = await file.arrayBuffer();
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(data.slice(0));
  } catch {
    return 'Это не звук или формат не поддерживается (подойдут OGG, MP3, WAV).';
  }
  if (buffer.duration > 15) return 'Звук длиннее 15 секунд — для фона места лучше музыка сцены.';
  const saved = await withStore('readwrite', store => store.put({ name: file.name, data } satisfies CustomRecord, id));
  if (saved === null) return 'Браузер не дал сохранить файл.';
  customBuffers.set(id, buffer);
  customSoundNames.value = { ...customSoundNames.value, [id]: file.name };
  setSfxPref(id, { choice: 'custom' });
  return null;
}

export async function clearCustomSound(id: SfxEvent) {
  await withStore('readwrite', store => store.delete(id));
  customBuffers.delete(id);
  const names = { ...customSoundNames.value };
  delete names[id];
  customSoundNames.value = names;
  if (sfxPrefs.value.events[id]?.choice === 'custom') setSfxPref(id, { choice: undefined });
}

export async function resetSfx() {
  for (const id of Object.keys(customSoundNames.value) as SfxEvent[]) await clearCustomSound(id);
  sfxPrefs.value = { events: {} };
}

async function customBuffer(id: SfxEvent): Promise<AudioBuffer | null> {
  const cached = customBuffers.get(id);
  if (cached) return cached;
  const ctx = audioContext();
  const record = await withStore<CustomRecord>('readonly', store => store.get(id));
  if (!ctx || !record) return null;
  try {
    const buffer = await ctx.decodeAudioData(record.data.slice(0));
    customBuffers.set(id, buffer);
    return buffer;
  } catch {
    return null;
  }
}

const BASE = `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}sfx/`;
const packBuffers = new Map<string, Promise<AudioBuffer | null>>();

function packBuffer(path: string): Promise<AudioBuffer | null> {
  let pending = packBuffers.get(path);
  if (!pending) {
    pending = (async () => {
      const ctx = audioContext();
      if (!ctx) return null;
      try {
        const response = await fetch(`${BASE}${path}`);
        if (!response.ok) return null;
        return await ctx.decodeAudioData(await response.arrayBuffer());
      } catch {
        return null;
      }
    })();
    packBuffers.set(path, pending);
  }
  return pending;
}

const PACK_GAIN = 0.7;
const MAX_VOICES = 16;
let voices = 0;
const lastPlayed = new Map<string, number>();

function playBuffer(buffer: AudioBuffer, gain: number, rate = 1) {
  const ctx = audioContext();
  if (!ctx || voices >= MAX_VOICES) return;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const out = ctx.createGain();
  out.gain.value = gain;
  source.connect(out).connect(ctx.destination);
  voices++;
  source.onended = () => {
    voices--;
    out.disconnect();
  };
  source.start();
}

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;

function filesFor(choice: SfxChoice, options: PlayOptions): string[] {
  if (choice.surface) {
    const surface = choice.surface === 'scene' ? options.surface ?? 'stone' : choice.surface;
    return take(`steps/${surface}${choice.chain ? '-chain' : ''}-walk`, 5);
  }
  if (options.shape === 'circle' || options.shape === 'square') return choice.area ?? choice.files ?? [];
  if (options.shape === 'cone' || options.shape === 'line') return choice.spray ?? choice.files ?? [];
  return choice.files ?? [];
}

export type PlayOptions = {
  delayMs?: number;
  shape?: SfxShape | null;
  surface?: Surface;
  gain?: number;
};

async function play(id: SfxEvent, choiceId: string, options: PlayOptions, due: number) {
  const scale = tableMuted.value ? 0 : sfxVolume.value * sfxEventVolume(id) * (options.gain ?? 1);
  if (scale <= 0 || choiceId === 'off') return;
  if (choiceId === 'custom') {
    const buffer = await customBuffer(id);
    if (buffer && performance.now() - due < 500) playBuffer(buffer, scale * PACK_GAIN);
    return;
  }
  const choice = sfxEvent(id).choices.find(item => item.id === choiceId);
  if (!choice) return;
  if (choice.synth) {
    playSynth(choice.synth, scale);
    return;
  }
  const files = filesFor(choice, options);
  if (!files.length) return;
  const buffer = await packBuffer(pick(files));
  if (buffer && performance.now() - due < 500) playBuffer(buffer, scale * PACK_GAIN, 0.96 + Math.random() * 0.08);
}

export function playSfx(id: SfxEvent, options: PlayOptions = {}) {
  const fire = () => {
    const now = performance.now();
    if (now - (lastPlayed.get(id) ?? -Infinity) < 60) return;
    lastPlayed.set(id, now);
    void play(id, sfxChoice(id), options, now);
  };
  if (options.delayMs && options.delayMs > 0) setTimeout(fire, options.delayMs);
  else fire();
}

export function playSteps(cells: number, options: { surface?: Surface; durationMs?: number; gain?: number } = {}) {
  const count = Math.max(1, Math.min(8, Math.round(cells)));
  const spacing = Math.max(220, (options.durationMs ?? count * 300) / count);
  for (let index = 0; index < count; index++) {
    setTimeout(() => {
      const now = performance.now();
      void play('steps', sfxChoice('steps'), { surface: options.surface, gain: options.gain }, now);
    }, index * spacing);
  }
}

export function previewSfx(id: SfxEvent, choiceId = sfxChoice(id), options: PlayOptions = {}) {
  if (id === 'steps' && choiceId !== 'custom' && choiceId !== 'off') {
    const choice = sfxEvent(id).choices.find(item => item.id === choiceId);
    const surface = choice?.surface === 'scene' ? options.surface ?? 'stone' : choice?.surface;
    const files = take(`steps/${surface ?? 'stone'}${choice?.chain ? '-chain' : ''}-walk`, 5);
    for (let index = 0; index < 3; index++) {
      setTimeout(() => void packBuffer(pick(files)).then(buffer => buffer && playBuffer(buffer, sfxVolume.value * sfxEventVolume(id) * PACK_GAIN)), index * 300);
    }
    return;
  }
  void play(id, choiceId, options, performance.now());
}

export function preloadCombatSfx() {
  for (const definition of SFX_EVENTS) {
    if (definition.group !== 'combat') continue;
    const choice = definition.choices.find(item => item.id === sfxChoice(definition.id));
    for (const path of [...(choice?.files ?? []), ...(choice?.area ?? []), ...(choice?.spray ?? [])]) void packBuffer(path);
  }
}
