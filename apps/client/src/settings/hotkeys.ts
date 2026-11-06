import { ref, watch } from 'vue';

export type HotkeyAction =
  | 'select'
  | 'measure'
  | 'ping'
  | 'draw'
  | 'text'
  | 'erase'
  | 'pin'
  | 'template'
  | 'focus'
  | 'resetCamera'
  | 'fullscreen'
  | 'hudToggle'
  | 'hotkeysHelp';

export type HotkeyMap = Record<HotkeyAction, string>;

const DEFAULT_HOTKEYS: HotkeyMap = {
  select: 'KeyV',
  measure: 'KeyM',
  ping: 'KeyP',
  draw: 'KeyB',
  text: 'KeyL',
  erase: 'KeyE',
  pin: 'KeyN',
  template: 'KeyR',
  focus: 'KeyT',
  resetCamera: 'KeyC',
  fullscreen: 'KeyF',
  hudToggle: 'KeyH',
  hotkeysHelp: 'Slash',
};

const HOTKEY_STORAGE_KEY = 'ttrpg.tabletop.hotkeys';

const normalizeCode = (code: string | null | undefined): string | undefined => {
  if (!code || typeof code !== 'string') return undefined;
  const trimmed = code.trim();
  if (!trimmed) return undefined;
  return trimmed;
};

function loadHotkeys(): HotkeyMap {
  if (typeof localStorage === 'undefined') return DEFAULT_HOTKEYS;
  try {
    const raw = localStorage.getItem(HOTKEY_STORAGE_KEY);
    if (!raw) return DEFAULT_HOTKEYS;
    const parsed = JSON.parse(raw) as Partial<Record<HotkeyAction, string>>;
    const merged: HotkeyMap = { ...DEFAULT_HOTKEYS };
    for (const [key, value] of Object.entries(parsed) as Array<[HotkeyAction, string | undefined]>) {
      const code = normalizeCode(value);
      if (!code) continue;
      merged[key] = code;
    }
    return merged;
  } catch {
    return DEFAULT_HOTKEYS;
  }
}

function saveHotkeys(map: HotkeyMap) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(HOTKEY_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore private browsing and storage restrictions.
  }
}

const KEY_LABELS: Record<string, string> = {
  KeyV: 'V',
  KeyM: 'M',
  KeyP: 'P',
  KeyB: 'B',
  KeyL: 'L',
  KeyE: 'E',
  KeyN: 'N',
  KeyR: 'R',
  KeyT: 'T',
  KeyC: 'C',
  KeyF: 'F',
  KeyH: 'H',
  KeyI: 'I',
  KeyJ: 'J',
  Slash: '?',
  F1: 'F1',
  Escape: 'Esc',
  Delete: 'Delete',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
};

export function labelForCode(code: string | null | undefined): string {
  if (!code) return '—';
  return KEY_LABELS[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '');
}

export const REBINDABLE_ACTIONS: HotkeyAction[] = ['select', 'measure', 'ping', 'draw', 'text', 'erase', 'pin', 'template', 'focus', 'resetCamera'];

export const ACTION_LABELS: Record<HotkeyAction, string> = {
  select: 'Выбор и перемещение',
  measure: 'Линейка',
  ping: 'Указка',
  draw: 'Рисование от руки',
  text: 'Подпись на карте',
  erase: 'Ластик',
  pin: 'Булавка с заметкой',
  template: 'Область заклинания',
  focus: 'Камера к выбранному объекту',
  resetCamera: 'Камера: вся доска',
  fullscreen: 'Карта на весь экран',
  hudToggle: 'Скрыть интерфейс',
  hotkeysHelp: 'Эта справка',
};

const RESERVED: Record<string, string> = {
  KeyW: 'камера', KeyA: 'камера', KeyS: 'камера', KeyD: 'камера',
  KeyF: 'весь экран / интерфейс', KeyH: 'скрыть интерфейс', KeyI: 'лист персонажа', KeyJ: 'журнал заданий', KeyK: 'справочник',
  Digit1: 'окно «Карты»', Digit2: 'окно «Объекты»', Digit3: 'окно «Бой»', Digit4: 'окно «Журнал»',
  Digit5: 'окно «Встречи»', Digit6: 'окно «Музыка»', Digit7: 'окно «Ловушки»', Digit8: 'окно «Свет и обзор»',
  Escape: 'отмена', Delete: 'убрать со сцены', F1: 'эта справка', Slash: 'эта справка',
};

export function reservedFor(code: string): string | null {
  return RESERVED[code] ?? null;
}

export const hotkeys = ref<HotkeyMap>(loadHotkeys());

watch(hotkeys, saveHotkeys, { deep: true });

export function hotkeyConflict(code: string, except: HotkeyAction): HotkeyAction | null {
  const found = REBINDABLE_ACTIONS.find(action => action !== except && hotkeys.value[action] === code);
  return found ?? null;
}

export function setHotkey(action: HotkeyAction, code: string) {
  hotkeys.value = { ...hotkeys.value, [action]: code };
}

export function resetHotkeys() {
  hotkeys.value = { ...DEFAULT_HOTKEYS };
}
