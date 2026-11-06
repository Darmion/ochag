import { ref, watch } from 'vue';
import { tr } from '../i18n/i18n';

export type CameraScheme = 'tts' | 'classic';
export type AltMode = 'both' | 'rail' | 'rotate' | 'off';

export const CAMERA_SCHEMES: Array<{ id: CameraScheme; label: string; hint: string }> = [
  { id: 'tts', label: tr('Вращение средней кнопкой'), hint: tr('вращать — средней кнопкой, сдвигать — правой, WASD и стрелки — камера, протяжка левой по пустому месту — рамка выделения') },
  { id: 'classic', label: tr('Вращение левой кнопкой'), hint: tr('вращать — левой по пустому месту, сдвигать — правой, WASD — камера, стрелки вращают, рамка — Shift+протяжка') },
];

export const ALT_MODES: Array<{ id: AltMode; label: string }> = [
  { id: 'both', label: tr('Выдвинуть ленту и вращать камеру левой кнопкой') },
  { id: 'rail', label: tr('Только выдвинуть левую ленту с подписями') },
  { id: 'rotate', label: tr('Только вращать камеру левой кнопкой') },
  { id: 'off', label: tr('Ничего') },
];

const SCHEME_KEY = 'ttrpg.cameraScheme';
const ALT_KEY = 'ttrpg.altMode';

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

export const cameraScheme = ref<CameraScheme>(read(SCHEME_KEY, CAMERA_SCHEMES.map(entry => entry.id), 'tts'));
export const altMode = ref<AltMode>(read(ALT_KEY, ALT_MODES.map(entry => entry.id), 'both'));

watch(cameraScheme, value => { try { localStorage.setItem(SCHEME_KEY, value); } catch {  } });
watch(altMode, value => { try { localStorage.setItem(ALT_KEY, value); } catch {  } });

export const altShowsRail = () => altMode.value === 'both' || altMode.value === 'rail';
export const altRotates = () => altMode.value === 'both' || altMode.value === 'rotate';
