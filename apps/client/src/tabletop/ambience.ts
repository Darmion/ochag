import { ref, watch } from 'vue';
import { audioContext, tableMuted } from './sounds';
import { ambienceTrack as trackFor } from './soundCatalog';
import { dayPhase, type Weather } from '../campaign/worldClock';

export { AMBIENCE_PLACES, AMBIENCE_STEPS, AMBIENCE_WATERS, sceneSurface, waterTrack, type SceneAmbience } from './soundCatalog';
import type { AmbiencePlace } from './soundCatalog';

export function ambienceTrack(place: AmbiencePlace | undefined, minutes: number | undefined, weather: Weather | undefined): string | null {
  const phase = minutes === undefined ? 'day' : dayPhase(minutes);
  return trackFor(place, phase === 'night' || phase === 'dusk', weather);
}

const PREFS_KEY = 'ochag.ambience.v1';
function loadPrefs(): { enabled: boolean; volume: number } {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object') {
      return {
        enabled: parsed.enabled !== false,
        volume: typeof parsed.volume === 'number' && Number.isFinite(parsed.volume) ? Math.max(0, Math.min(1, parsed.volume)) : 0.6,
      };
    }
  } catch {
  }
  return { enabled: true, volume: 0.6 };
}
const initial = loadPrefs();
export const ambienceEnabled = ref(initial.enabled);
export const ambienceVolume = ref(initial.volume);
watch([ambienceEnabled, ambienceVolume], ([enabled, volume]) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ enabled, volume }));
  } catch {
  }
});

const BASE = `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}sfx/`;
const FADE_SECONDS = 2;
const LAYER_GAIN = 0.45;

type Layer = { track: string | null; source: AudioBufferSourceNode | null; gain: GainNode | null; token: number };

async function loadLoop(ctx: AudioContext, track: string): Promise<AudioBuffer | null> {
  try {
    const response = await fetch(`${BASE}${track}`);
    if (!response.ok) return null;
    return await ctx.decodeAudioData(await response.arrayBuffer());
  } catch {
    return null;
  }
}

export function createAmbiencePlayer() {
  const layers: Record<'place' | 'water', Layer> = {
    place: { track: null, source: null, gain: null, token: 0 },
    water: { track: null, source: null, gain: null, token: 0 },
  };
  let level = 0;
  let disposed = false;

  const wake = () => {
    const ctx = audioContext();
    if (ctx?.state === 'running') {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    }
  };
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);

  function fadeOut(layer: Layer) {
    const ctx = audioContext();
    const { source, gain } = layer;
    layer.source = null;
    layer.gain = null;
    if (!ctx || !source || !gain) return;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE_SECONDS);
    source.stop(ctx.currentTime + FADE_SECONDS + 0.05);
    source.onended = () => gain.disconnect();
  }

  async function switchTo(layer: Layer, track: string | null) {
    if (layer.track === track) return;
    layer.track = track;
    const token = ++layer.token;
    fadeOut(layer);
    if (!track) return;
    const ctx = audioContext();
    if (!ctx) return;
    const buffer = await loadLoop(ctx, track);
    if (!buffer || disposed || token !== layer.token) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const whole = Math.floor(buffer.duration);
    if (buffer.duration - whole < 0.05 && whole > 0) source.loopEnd = whole;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(level, ctx.currentTime + FADE_SECONDS);
    source.connect(gain).connect(ctx.destination);
    source.start(0, Math.random() * Math.max(0, whole - 1));
    layer.source = source;
    layer.gain = gain;
  }

  function setLevel(next: number) {
    level = next;
    const ctx = audioContext();
    if (!ctx) return;
    for (const layer of Object.values(layers)) {
      if (!layer.gain) continue;
      layer.gain.gain.cancelScheduledValues(ctx.currentTime);
      layer.gain.gain.setValueAtTime(layer.gain.gain.value, ctx.currentTime);
      layer.gain.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.4);
    }
  }

  return {
    set(target: { place: string | null; water: string | null; volume: number }) {
      if (disposed) return;
      const off = tableMuted.value || !ambienceEnabled.value || target.volume <= 0 || ambienceVolume.value <= 0;
      setLevel(off ? 0 : LAYER_GAIN * target.volume * ambienceVolume.value);
      void switchTo(layers.place, off ? null : target.place);
      void switchTo(layers.water, off ? null : target.water);
    },
    dispose() {
      disposed = true;
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      fadeOut(layers.place);
      fadeOut(layers.water);
    },
  };
}
