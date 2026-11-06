import { reactive } from 'vue';

import type { GameIconName } from '../../ui/gameIcons';

export type PanelId = 'scenes' | 'objects' | 'combat' | 'gmNotes' | 'audio' | 'encounters' | 'triggers' | 'quests' | 'vision' | 'chat';

export type GameDock = 'left' | 'right';

export const GAME_DOCK: Record<PanelId, GameDock> = {
  scenes: 'left',
  gmNotes: 'left',
  audio: 'left',
  encounters: 'left',
  triggers: 'left',
  quests: 'left',
  vision: 'left',
  chat: 'right',
  objects: 'right',
  combat: 'right',
};

export const GAME_WINDOW_ICON: Record<PanelId, GameIconName> = {
  scenes: 'map',
  objects: 'chest',
  combat: 'swords',
  gmNotes: 'book',
  audio: 'speaker',
  encounters: 'skull',
  triggers: 'trap',
  quests: 'scroll',
  vision: 'flame',
  chat: 'quill',
};

export const GAME_WINDOW_LABEL: Record<PanelId, string> = {
  scenes: 'Сцены',
  objects: 'Объекты',
  combat: 'Бой',
  gmNotes: 'Заметки',
  audio: 'Звук',
  encounters: 'Встречи',
  triggers: 'Ловушки',
  quests: 'Задания',
  vision: 'Свет',
  chat: 'Чат',
};

const STORAGE_KEY = 'ttrpg.gameWindows';

function load(): Record<GameDock, PanelId | null> {
  const empty = { left: null, right: null };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return empty;
    const valid = (id: unknown, dock: GameDock) =>
      typeof id === 'string' && id in GAME_DOCK && GAME_DOCK[id as PanelId] === dock ? (id as PanelId) : null;
    return { left: valid(parsed.left, 'left'), right: valid(parsed.right, 'right') };
  } catch {
    return empty;
  }
}

export const gameWindows = reactive<Record<GameDock, PanelId | null>>(load());

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gameWindows));
  } catch {
  }
}

export function isGameWindowOpen(id: PanelId) {
  return gameWindows[GAME_DOCK[id]] === id;
}

export function openGameWindow(id: PanelId) {
  gameWindows[GAME_DOCK[id]] = id;
  persist();
}

export function closeGameWindow(id: PanelId) {
  if (gameWindows[GAME_DOCK[id]] === id) gameWindows[GAME_DOCK[id]] = null;
  persist();
}

export function toggleGameWindow(id: PanelId) {
  if (isGameWindowOpen(id)) closeGameWindow(id);
  else openGameWindow(id);
}

export const WINDOW_WIDTH = { min: 320, default: 400, max: 680 };
export const WINDOW_PRESETS: Array<{ id: string; label: string; width: number }> = [
  { id: 'narrow', label: 'Узкое', width: 340 },
  { id: 'normal', label: 'Обычное', width: 400 },
  { id: 'wide', label: 'Широкое', width: 540 },
];
const WIDTH_KEY = 'ochag.windowWidths.v1';
function loadWidths(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(WIDTH_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([id, value]) => id in GAME_DOCK && typeof value === 'number' && Number.isFinite(value))
      .map(([id, value]) => [id, clampWidth(value as number)]));
  } catch {
    return {};
  }
}
const clampWidth = (value: number) => Math.round(Math.min(WINDOW_WIDTH.max, Math.max(WINDOW_WIDTH.min, value)));
const windowWidths = reactive<Record<string, number>>(loadWidths());
export const windowWidth = (id: PanelId) => windowWidths[id] ?? WINDOW_WIDTH.default;
export function setWindowWidth(id: PanelId, width: number | null) {
  if (width === null) delete windowWidths[id];
  else windowWidths[id] = clampWidth(width);
  try {
    localStorage.setItem(WIDTH_KEY, JSON.stringify(windowWidths));
  } catch {
  }
}

export function closeAllGameWindows() {
  gameWindows.left = null;
  gameWindows.right = null;
  persist();
}
