import { computed, reactive, ref } from 'vue';

import { setArtSource, vanillaArtUrl } from './artSource';

export type ArtLibraryItem = { path: string; label: string; names?: string[] };
export type ArtLibraryGroup = { id: string; label: string; section: string; items: ArtLibraryItem[] };
type PackState = { on?: boolean; off?: string[] };

const STATE_KEY = 'ochag.artPacks.v1';

export const hasArtPacks = typeof window !== 'undefined' && Boolean(window.desktop?.mods?.art);
export const artPacks = ref<ArtPackInfo[]>([]);
export const artPackState = ref<Record<string, PackState>>(readState());
export const artPackError = ref('');

const vanilla = ref<Set<string> | null>(null);
let vanillaGroups: ArtLibraryGroup[] = [];
const files = reactive(new Map<string, string>());
const loaded = new Map<string, string[]>();

function readState(): Record<string, PackState> {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(artPackState.value));
  } catch {
  }
}

export const packOn = (pack: ArtPackInfo) => !pack.error && !pack.off && (artPackState.value[pack.id]?.on ?? !pack.bundled);
export const sectionOn = (pack: ArtPackInfo, sectionId: string) => packOn(pack) && !(artPackState.value[pack.id]?.off ?? []).includes(sectionId);

const names = computed(() => artPacks.value
  .flatMap(pack => pack.groups.flatMap(group => group.items))
  .filter(item => item.names && files.has(item.path))
  .flatMap(item => item.names!.map(name => [name, item.path] as const)));

setArtSource({
  has: path => files.has(path) || (vanilla.value?.has(path) ?? true),
  url: path => files.get(path) ?? vanillaArtUrl(path),
  names: () => names.value,
});

async function loadVanilla() {
  if (vanilla.value) return;
  const library = (await import('./artLibrary.json')).default as { groups: ArtLibraryGroup[] };
  vanillaGroups = library.groups;
  vanilla.value = new Set(library.groups.flatMap(group => group.items.map(item => item.path)));
}

function blobUrl(data: string, type: string) {
  const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type }));
}

function unload(key: string) {
  for (const path of loaded.get(key) ?? []) {
    const url = files.get(path);
    if (url) URL.revokeObjectURL(url);
    files.delete(path);
  }
  loaded.delete(key);
}

async function sync() {
  const artFiles = window.desktop?.mods?.artFiles;
  const wanted = new Set<string>();
  for (const pack of artPacks.value) for (const section of pack.sections) if (sectionOn(pack, section.id)) wanted.add(`${pack.id}/${section.id}`);
  for (const key of [...loaded.keys()]) if (!wanted.has(key)) unload(key);
  if (!artFiles) return;
  const errors: string[] = [];
  for (const key of wanted) {
    if (loaded.has(key)) continue;
    const [id, section] = key.split('/') as [string, string];
    try {
      const list = await artFiles(id, section);
      for (const file of list) files.set(file.path, blobUrl(file.data, file.type));
      loaded.set(key, list.map(file => file.path));
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : String(cause));
    }
  }
  artPackError.value = errors.join('; ');
}

export async function loadArtPacks() {
  if (!window.desktop?.mods?.art) return;
  artPacks.value = await window.desktop.mods.art();
  await sync();
}

export async function initArt() {
  await loadVanilla().catch(() => undefined);
  await loadArtPacks().catch(cause => { artPackError.value = cause instanceof Error ? cause.message : String(cause); });
}

function patchState(id: string, change: (state: PackState) => PackState) {
  artPackState.value = { ...artPackState.value, [id]: change({ ...artPackState.value[id] }) };
  saveState();
}

export function setArtPackOn(id: string, on: boolean) {
  patchState(id, state => ({ ...state, on }));
  return sync();
}

export function setArtPackSection(id: string, sectionId: string, on: boolean) {
  patchState(id, state => {
    const off = new Set(state.off ?? []);
    if (on) off.delete(sectionId); else off.add(sectionId);
    return { ...state, off: [...off] };
  });
  return sync();
}

export async function artLibraryGroups(): Promise<ArtLibraryGroup[]> {
  await loadVanilla();
  const merged = new Map(vanillaGroups.map(group => [group.id, { ...group, items: [...group.items] }]));
  for (const group of artPacks.value.flatMap(pack => pack.groups)) {
    const items = group.items.filter(item => files.has(item.path));
    if (!items.length) continue;
    const target = merged.get(group.id);
    if (target) target.items.push(...items.filter(item => !target.items.some(own => own.path === item.path)));
    else merged.set(group.id, { ...group, items });
  }
  return [...merged.values()];
}
