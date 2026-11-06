import { ref, watch } from 'vue';

export type SoundKind = 'dice' | 'hit' | 'miss' | 'crit' | 'spell' | 'heal' | 'level' | 'turn';

const STORAGE_KEY = 'ttrpg.sfxVolume';

function loadVolume(): number {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return localStorage.getItem(STORAGE_KEY) === null || !Number.isFinite(value) ? 0.5 : Math.max(0, Math.min(1, value));
  } catch {
    return 0.5;
  }
}

export const sfxVolume = ref(loadVolume());
watch(sfxVolume, value => {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
  }
});

export const tableMuted = ref(false);

let context: AudioContext | null = null;

export function audioContext(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume().catch(() => {});
  return context;
}
const audio = audioContext;

function tone(ctx: AudioContext, out: GainNode, start: number, frequency: number, duration: number, type: OscillatorType, peak: number, endFrequency?: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

function noise(ctx: AudioContext, out: GainNode, start: number, duration: number, peak: number, filter: { type: BiquadFilterType; from: number; to?: number }) {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const biquad = ctx.createBiquadFilter();
  biquad.type = filter.type;
  biquad.frequency.setValueAtTime(filter.from, start);
  if (filter.to) biquad.frequency.exponentialRampToValueAtTime(filter.to, start + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(biquad).connect(gain).connect(out);
  source.start(start);
  source.stop(start + duration + 0.05);
}

export function playSynth(kind: SoundKind, scale = 1) {
  const volume = tableMuted.value ? 0 : sfxVolume.value * scale;
  if (volume <= 0) return;
  const ctx = audio();
  if (!ctx) return;
  const out = ctx.createGain();
  out.gain.value = volume * 0.6;
  out.connect(ctx.destination);
  const now = ctx.currentTime + 0.01;

  if (kind === 'dice') {
    for (const [offset, peak] of [[0, 0.5], [0.07, 0.35], [0.13, 0.25], [0.2, 0.15]] as const) {
      noise(ctx, out, now + offset, 0.035, peak, { type: 'bandpass', from: 2400 });
    }
  } else if (kind === 'hit') {
    tone(ctx, out, now, 140, 0.18, 'sine', 0.9, 55);
    noise(ctx, out, now, 0.08, 0.4, { type: 'lowpass', from: 1800 });
  } else if (kind === 'miss') {
    noise(ctx, out, now, 0.32, 0.35, { type: 'bandpass', from: 600, to: 2600 });
  } else if (kind === 'crit') {
    tone(ctx, out, now, 140, 0.2, 'sine', 0.9, 50);
    tone(ctx, out, now + 0.05, 880, 0.35, 'triangle', 0.35);
    tone(ctx, out, now + 0.12, 1320, 0.45, 'triangle', 0.3);
  } else if (kind === 'spell') {
    tone(ctx, out, now, 520, 0.5, 'sine', 0.3, 1040);
    tone(ctx, out, now + 0.04, 780, 0.45, 'sine', 0.2, 1560);
  } else if (kind === 'heal') {
    tone(ctx, out, now, 660, 0.3, 'sine', 0.3);
    tone(ctx, out, now + 0.12, 990, 0.4, 'sine', 0.25);
  } else if (kind === 'turn') {
    tone(ctx, out, now, 1175, 0.9, 'sine', 0.35);
    tone(ctx, out, now, 2350, 0.5, 'sine', 0.08);
    tone(ctx, out, now + 0.28, 880, 1.1, 'sine', 0.35);
    tone(ctx, out, now + 0.28, 1760, 0.6, 'sine', 0.08);
  } else {
    [523, 659, 784, 1047].forEach((frequency, index) => tone(ctx, out, now + index * 0.12, frequency, 0.4, 'triangle', 0.35));
  }
}
