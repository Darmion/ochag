import { ref } from 'vue';

import type { ModTranslations } from './modText';

export type VisualMod = { id: string; name: string; version: string; description: string; author: string; css: string; error: string | null; off?: boolean; translations?: ModTranslations };

const OFF_KEY = 'ochag.visualMods.off';
export const visualMods = ref<VisualMod[]>([]);
export const visualModsOff = ref<Set<string>>(readOff());
export const hasVisualMods = typeof window !== 'undefined' && Boolean(window.desktop?.mods);

function readOff(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(OFF_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function apply() {
  for (const node of document.querySelectorAll('style[data-visual-mod]')) node.remove();
  for (const mod of visualMods.value) {
    if (!mod.css || mod.error || mod.off || visualModsOff.value.has(mod.id)) continue;
    const style = document.createElement('style');
    style.dataset.visualMod = mod.id;
    style.textContent = mod.css;
    document.head.append(style);
  }
}

export async function loadVisualMods() {
  if (!window.desktop?.mods) return;
  visualMods.value = await window.desktop.mods.visual();
  apply();
}

export function setVisualModOn(id: string, on: boolean) {
  const next = new Set(visualModsOff.value);
  if (on) next.delete(id); else next.add(id);
  visualModsOff.value = next;
  try {
    localStorage.setItem(OFF_KEY, JSON.stringify([...next]));
  } catch {
  }
  apply();
}

export function openModsFolder() {
  return window.desktop?.mods?.openFolder();
}
