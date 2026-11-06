import { reactive, watch } from 'vue';

import { tr } from '../i18n/i18n';

export type GridStyle = 'lines' | 'dashed' | 'dots' | 'crosses';
export type GridLook = {
  visible: boolean;
  style: GridStyle;
  color: string | null;
  opacity: number;
  width: number;
};
export type GridMode = 'scene' | 'hidden' | 'custom';

export const GRID_STYLES: ReadonlyArray<{ id: GridStyle; label: string }> = [
  { id: 'lines', label: tr('Сплошные линии') },
  { id: 'dashed', label: tr('Пунктир') },
  { id: 'dots', label: tr('Точки в углах клеток') },
  { id: 'crosses', label: tr('Крестики в углах клеток') },
];
export const GRID_WIDTHS = [1, 2, 3, 4] as const;
export const GRID_MODES: ReadonlyArray<{ id: GridMode; label: string }> = [
  { id: 'scene', label: tr('Как на сцене (задаёт мастер)') },
  { id: 'hidden', label: tr('Скрыть у меня') },
  { id: 'custom', label: tr('Своя сетка') },
];

export const DEFAULT_GRID: GridLook = { visible: true, style: 'lines', color: null, opacity: 1, width: 1 };

const COLOR = /^#[0-9a-fA-F]{6}$/;

export function normalizeGrid(raw: unknown): GridLook {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const style = GRID_STYLES.some(entry => entry.id === value.style) ? value.style as GridStyle : DEFAULT_GRID.style;
  const opacity = typeof value.opacity === 'number' && Number.isFinite(value.opacity) ? Math.min(1, Math.max(0.05, value.opacity)) : DEFAULT_GRID.opacity;
  const width = typeof value.width === 'number' && (GRID_WIDTHS as readonly number[]).includes(value.width) ? value.width : DEFAULT_GRID.width;
  return {
    visible: typeof value.visible === 'boolean' ? value.visible : DEFAULT_GRID.visible,
    style,
    color: typeof value.color === 'string' && COLOR.test(value.color) ? value.color.toLowerCase() : null,
    opacity,
    width,
  };
}

export function gridPayload(look: GridLook): GridLook {
  return { visible: look.visible, style: look.style, color: look.color, opacity: Math.round(look.opacity * 100) / 100, width: look.width };
}

const STORAGE_KEY = 'ochag.grid.v1';
type GridPrefs = { mode: GridMode; custom: GridLook };

function load(): GridPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const mode = GRID_MODES.some(entry => entry.id === raw?.mode) ? raw.mode as GridMode : 'scene';
    return { mode, custom: normalizeGrid(raw?.custom) };
  } catch {
    return { mode: 'scene', custom: { ...DEFAULT_GRID } };
  }
}

export const gridPrefs = reactive<GridPrefs>(load());

watch(gridPrefs, value => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
  }
}, { deep: true });

export function effectiveGrid(sceneGrid: unknown): GridLook {
  if (gridPrefs.mode === 'custom') return normalizeGrid(gridPrefs.custom);
  const scene = normalizeGrid(sceneGrid);
  return gridPrefs.mode === 'hidden' ? { ...scene, visible: false } : scene;
}
