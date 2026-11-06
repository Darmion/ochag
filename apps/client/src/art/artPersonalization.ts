import { reactive, watch } from 'vue';

import { campaignArtValue } from './campaignArt';
import { NO_ART, setArtOverrides } from './itemArt';

export type ArtUpload = { id: string; label: string; data: string };
type Prefs = { overrides: Record<string, string>; uploads: ArtUpload[]; customNames: string[] };

const STORAGE_KEY = 'ochag.art.v1';
export const MAX_UPLOADS = 200;

function load(): Prefs {
  const empty: Prefs = { overrides: {}, uploads: [], customNames: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return empty;
    return {
      overrides: raw.overrides && typeof raw.overrides === 'object' ? Object.fromEntries(Object.entries(raw.overrides).filter(([, value]) => typeof value === 'string')) as Record<string, string> : {},
      uploads: Array.isArray(raw.uploads) ? raw.uploads.filter((entry: ArtUpload) => entry && typeof entry.id === 'string' && typeof entry.data === 'string' && entry.data.startsWith('data:image/')) : [],
      customNames: Array.isArray(raw.customNames) ? raw.customNames.filter((name: unknown) => typeof name === 'string') : [],
    };
  } catch {
    return empty;
  }
}

export const artPrefs = reactive<Prefs>(load());

export const artStorage = reactive({ error: '' });

watch(artPrefs, value => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    artStorage.error = '';
  } catch {
    artStorage.error = 'Не удалось сохранить: хранилище переполнено или недоступно. Удалите несколько своих картинок.';
  }
}, { deep: true });

function personalArtValue(key: string): string | undefined {
  const value = artPrefs.overrides[key];
  if (value === undefined) return undefined;
  if (value.startsWith('upload:')) {
    const upload = artPrefs.uploads.find(entry => entry.id === value.slice(7));
    return upload ? upload.data : undefined;
  }
  return value;
}

setArtOverrides(key => personalArtValue(key) ?? campaignArtValue(key));

export function setArt(key: string, value: string) {
  artPrefs.overrides[key] = value;
}
export function setNoArt(key: string) {
  artPrefs.overrides[key] = NO_ART;
}
export function resetArt(key: string) {
  delete artPrefs.overrides[key];
}
export function resetAllArt() {
  for (const key of Object.keys(artPrefs.overrides)) delete artPrefs.overrides[key];
}

export function addUpload(label: string, data: string): ArtUpload | null {
  if (artPrefs.uploads.length >= MAX_UPLOADS) return null;
  const upload = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label: label.slice(0, 80) || 'Своя картинка', data };
  artPrefs.uploads.push(upload);
  return upload;
}
export function removeUpload(id: string) {
  const index = artPrefs.uploads.findIndex(entry => entry.id === id);
  if (index >= 0) artPrefs.uploads.splice(index, 1);
  for (const [key, value] of Object.entries(artPrefs.overrides)) {
    if (value === `upload:${id}`) delete artPrefs.overrides[key];
  }
}

export function addCustomName(name: string): boolean {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!clean || artPrefs.customNames.some(entry => entry.toLowerCase() === clean.toLowerCase())) return false;
  artPrefs.customNames.push(clean);
  return true;
}
export function removeCustomName(name: string) {
  const index = artPrefs.customNames.indexOf(name);
  if (index >= 0) artPrefs.customNames.splice(index, 1);
}
