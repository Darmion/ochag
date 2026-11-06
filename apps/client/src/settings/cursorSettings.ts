import { reactive, watch } from 'vue';

import { tr } from '../i18n/i18n';
import { artSource, libraryArt } from '../art/itemArt';

export type Hotspot = { x: number; y: number };
export type CustomCursor = { id: string; label: string; src: string };
type Prefs = {
  main: string;
  pointer: string;
  size: number;
  hotspots: Record<string, Hotspot>;
  customs: CustomCursor[];
};

export const BUILT_IN_CURSORS: ReadonlyArray<{ id: string; label: string; path: string; fill?: string }> = [
  { id: 'arrow-white', label: tr('Стрелка, белая'), path: 'ui/cursors/arrow-white', fill: '#ffffff' },
  { id: 'arrow-black', label: tr('Стрелка, чёрная'), path: 'ui/cursors/arrow-black' },
  { id: 'gauntlet-silver', label: tr('Латная перчатка'), path: 'ui/cursors/gauntlet-silver' },
  { id: 'glove-leather', label: tr('Кожаная перчатка'), path: 'ui/cursors/glove-leather' },
  { id: 'skeleton-hand', label: tr('Рука скелета'), path: 'ui/cursors/skeleton-hand' },
];

export const CURSOR_SIZES = [24, 32, 40, 48, 64] as const;
export const MAX_CUSTOM_CURSORS = 12;
const STORED_SIZE = 128;

const STORAGE_KEY = 'ochag.cursor.v1';
const DEFAULTS: Prefs = { main: 'system', pointer: 'same', size: 32, hotspots: {}, customs: [] };

function validHotspot(value: unknown): value is Hotspot {
  const spot = value as Hotspot;
  return Boolean(spot) && Number.isFinite(spot.x) && Number.isFinite(spot.y) && spot.x >= 0 && spot.x <= 1 && spot.y >= 0 && spot.y <= 1;
}

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return structuredClone(DEFAULTS);
    const customs: CustomCursor[] = Array.isArray(raw.customs)
      ? raw.customs.filter((entry: CustomCursor) => entry && typeof entry.id === 'string' && typeof entry.label === 'string'
        && typeof entry.src === 'string' && (entry.src.startsWith('library:') || entry.src.startsWith('data:image/'))).slice(0, MAX_CUSTOM_CURSORS)
      : [];
    const hotspots = raw.hotspots && typeof raw.hotspots === 'object'
      ? Object.fromEntries(Object.entries(raw.hotspots).filter(([, spot]) => validHotspot(spot))) as Record<string, Hotspot>
      : {};
    const prefs: Prefs = {
      main: typeof raw.main === 'string' ? raw.main : DEFAULTS.main,
      pointer: typeof raw.pointer === 'string' ? raw.pointer : DEFAULTS.pointer,
      size: (CURSOR_SIZES as readonly number[]).includes(raw.size) ? raw.size : DEFAULTS.size,
      hotspots,
      customs,
    };
    if (!choiceExists(prefs.main, customs)) prefs.main = 'system';
    if (prefs.pointer !== 'same' && !choiceExists(prefs.pointer, customs)) prefs.pointer = 'same';
    return prefs;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function choiceExists(choice: string, customs: CustomCursor[]): boolean {
  if (choice === 'system') return true;
  if (choice.startsWith('builtin:')) return BUILT_IN_CURSORS.some(entry => entry.id === choice.slice(8));
  if (choice.startsWith('custom:')) return customs.some(entry => entry.id === choice.slice(7));
  return false;
}

export const cursorPrefs = reactive<Prefs>(load());
export const cursorStorage = reactive({ error: '' });

export function cursorSource(choice: string): string | null {
  if (choice.startsWith('builtin:')) {
    const entry = BUILT_IN_CURSORS.find(item => item.id === choice.slice(8));
    return entry ? libraryArt(entry.path) : null;
  }
  if (choice.startsWith('custom:')) {
    const entry = cursorPrefs.customs.find(item => item.id === choice.slice(7));
    if (!entry) return null;
    return entry.src.startsWith('library:') ? artSource(entry.src.slice(8)) : entry.src;
  }
  return null;
}

export function cursorLabel(choice: string): string {
  if (choice.startsWith('builtin:')) return BUILT_IN_CURSORS.find(item => item.id === choice.slice(8))?.label ?? choice;
  if (choice.startsWith('custom:')) return cursorPrefs.customs.find(item => item.id === choice.slice(7))?.label ?? choice;
  return choice;
}

type Prepared = { canvas: HTMLCanvasElement; auto: Hotspot };
const prepared = new Map<string, Promise<Prepared>>();
export const cursorPreviews = reactive<Record<string, string>>({});

function fillOf(src: string): string | undefined {
  return BUILT_IN_CURSORS.find(entry => entry.fill && libraryArt(entry.path) === src)?.fill;
}

function fillHoles(data: Uint8ClampedArray, width: number, height: number, color: string) {
  const outside = new Uint8Array(width * height);
  const queue: number[] = [];
  const clear = (index: number) => data[index * 4 + 3]! < 128;
  for (let x = 0; x < width; x++) queue.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) queue.push(y * width, y * width + width - 1);
  while (queue.length) {
    const index = queue.pop()!;
    if (outside[index] || !clear(index)) continue;
    outside[index] = 1;
    const x = index % width;
    if (x > 0) queue.push(index - 1);
    if (x < width - 1) queue.push(index + 1);
    if (index >= width) queue.push(index - width);
    if (index < width * (height - 1)) queue.push(index + width);
  }
  const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
  for (let index = 0; index < width * height; index++) {
    if (outside[index]) continue;
    const alpha = data[index * 4 + 3]! / 255;
    if (alpha >= 1) continue;
    data[index * 4] = Math.round(data[index * 4]! * alpha + r * (1 - alpha));
    data[index * 4 + 1] = Math.round(data[index * 4 + 1]! * alpha + g * (1 - alpha));
    data[index * 4 + 2] = Math.round(data[index * 4 + 2]! * alpha + b * (1 - alpha));
    data[index * 4 + 3] = 255;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(tr('Картинка курсора не загрузилась.')));
    image.src = src;
  });
}

export function prepareCursorImage(src: string): Promise<Prepared> {
  let result = prepared.get(src);
  if (!result) {
    result = loadImage(src).then(image => {
      const width = image.naturalWidth || 1;
      const height = image.naturalHeight || 1;
      const full = document.createElement('canvas');
      full.width = width;
      full.height = height;
      const context = full.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, width, height);
      const data = pixels.data;
      const fill = fillOf(src);
      if (fill) {
        fillHoles(data, width, height, fill);
        context.putImageData(pixels, 0, 0);
      }
      const opaque = (x: number, y: number) => data[(y * width + x) * 4 + 3]! > 24;
      let minX = width, minY = height, maxX = -1, maxY = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!opaque(x, y)) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (maxX < 0) {
        minX = 0; minY = 0; maxX = width - 1; maxY = height - 1;
      }
      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;
      const canvas = document.createElement('canvas');
      canvas.width = boxWidth;
      canvas.height = boxHeight;
      canvas.getContext('2d')!.drawImage(full, minX, minY, boxWidth, boxHeight, 0, 0, boxWidth, boxHeight);
      let first = -1;
      let last = -1;
      for (let x = minX; x <= maxX; x++) {
        if (!opaque(x, minY)) continue;
        if (first < 0) first = x;
        last = x;
      }
      const tip = first < 0 ? minX : first - minX <= 1 ? first : (first + last + 1) / 2;
      cursorPreviews[src] = canvas.toDataURL('image/png');
      return { canvas, auto: { x: Math.min(1, (tip - minX) / boxWidth), y: 0 } };
    });
    result.catch(() => prepared.delete(src));
    prepared.set(src, result);
  }
  return result;
}

function pixelRatio(): number {
  return Math.round(Math.min(4, Math.max(1, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)) * 100) / 100;
}

let imageSetSupported: boolean | null = null;
function supportsImageSet(): boolean {
  if (imageSetSupported === null) {
    imageSetSupported = typeof CSS !== 'undefined' && CSS.supports('cursor', 'image-set(url("data:,x") 2x) 1 1, auto');
  }
  return imageSetSupported;
}

export async function cursorCss(src: string, size: number, hotspot?: Hotspot | null): Promise<string> {
  const { canvas: source, auto } = await prepareCursorImage(src);
  const scale = size / Math.max(source.width, source.height);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const ratio = supportsImageSet() ? pixelRatio() : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext('2d')!;
  const factor = canvas.width / source.width;
  context.imageSmoothingEnabled = !(factor >= 2 && Math.abs(factor - Math.round(factor)) < 0.01);
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const spot = hotspot ?? auto;
  const x = Math.min(width - 1, Math.max(0, Math.round(spot.x * width)));
  const y = Math.min(height - 1, Math.max(0, Math.round(spot.y * height)));
  const url = `url("${canvas.toDataURL('image/png')}")`;
  return supportsImageSet() ? `image-set(${url} ${ratio}x) ${x} ${y}` : `${url} ${x} ${y}`;
}

async function choiceCss(choice: string): Promise<string | null> {
  const src = cursorSource(choice);
  if (!src) return null;
  return cursorCss(src, cursorPrefs.size, cursorPrefs.hotspots[choice]);
}

export const cursorState = reactive({ error: '' });
let generation = 0;

export async function applyCursor(): Promise<void> {
  if (typeof document === 'undefined') return;
  const current = ++generation;
  const root = document.documentElement;
  try {
    const main = await choiceCss(cursorPrefs.main);
    const pointer = cursorPrefs.pointer === 'same' ? main : await choiceCss(cursorPrefs.pointer);
    if (current !== generation) return;
    if (main) root.style.setProperty('--ui-cursor-default', `${main}, default`);
    else root.style.removeProperty('--ui-cursor-default');
    if (pointer) root.style.setProperty('--ui-cursor-pointer', `${pointer}, pointer`);
    else root.style.removeProperty('--ui-cursor-pointer');
    if (main || pointer) root.dataset.cursor = '1';
    else delete root.dataset.cursor;
    cursorState.error = '';
  } catch (error) {
    if (current !== generation) return;
    root.style.removeProperty('--ui-cursor-default');
    root.style.removeProperty('--ui-cursor-pointer');
    delete root.dataset.cursor;
    cursorState.error = error instanceof Error ? error.message : String(error);
  }
}

let densityQuery: MediaQueryList | null = null;
function watchDensity() {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  densityQuery?.removeEventListener('change', onDensity);
  densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  densityQuery.addEventListener('change', onDensity);
}
function onDensity() {
  watchDensity();
  void applyCursor();
}
watchDensity();

watch(cursorPrefs, value => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    cursorStorage.error = '';
  } catch {
    cursorStorage.error = tr('Не удалось сохранить: хранилище переполнено или недоступно. Удалите одну из своих картинок курсора.');
  }
  void applyCursor();
}, { deep: true });

export function setHotspot(choice: string, hotspot: Hotspot | null) {
  if (hotspot && validHotspot(hotspot)) cursorPrefs.hotspots[choice] = { x: hotspot.x, y: hotspot.y };
  else delete cursorPrefs.hotspots[choice];
}

export async function storedUpload(src: string): Promise<string> {
  const { canvas: source } = await prepareCursorImage(src);
  const scale = Math.min(1, STORED_SIZE / Math.max(source.width, source.height));
  if (scale === 1) return source.toDataURL('image/png');
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d')!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export function addCustomCursor(label: string, src: string, hotspot: Hotspot | null): string | null {
  if (cursorPrefs.customs.length >= MAX_CUSTOM_CURSORS) return null;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  cursorPrefs.customs.push({ id, label: label.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Свой курсор', src });
  const choice = `custom:${id}`;
  if (hotspot) setHotspot(choice, hotspot);
  return choice;
}

export function removeCustomCursor(id: string) {
  const choice = `custom:${id}`;
  const index = cursorPrefs.customs.findIndex(entry => entry.id === id);
  if (index >= 0) cursorPrefs.customs.splice(index, 1);
  delete cursorPrefs.hotspots[choice];
  if (cursorPrefs.main === choice) cursorPrefs.main = 'system';
  if (cursorPrefs.pointer === choice) cursorPrefs.pointer = 'same';
}

export function resetCursor() {
  cursorPrefs.main = 'system';
  cursorPrefs.pointer = 'same';
  cursorPrefs.size = 32;
}
