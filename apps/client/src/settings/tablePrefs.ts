import { reactive, watch } from 'vue';

export const TABLE_PREFS_KEY = 'ttrpg.tabletop.uiPrefs';

export const STRIP_SIZES = ['compact', 'normal', 'large'] as const;
export type StripSize = typeof STRIP_SIZES[number];

export type TableViewPrefs = {
  showHpBars: boolean;
  followTurn: boolean;
  selectTurn: boolean;
  showGizmo: boolean;
  showMoveFilter: boolean;
  showWeather: boolean;
  resourceStripCollapsed: boolean;
  resourceStripSize: StripSize;
};

const DEFAULTS: TableViewPrefs = {
  showHpBars: true, followTurn: false, selectTurn: true, showGizmo: false, showMoveFilter: true, showWeather: true,
  resourceStripCollapsed: false, resourceStripSize: 'normal',
};

export function readTablePrefs(): Record<string, unknown> {
  try {
    const saved = JSON.parse(localStorage.getItem(TABLE_PREFS_KEY) ?? '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

export function writeTablePrefs(patch: Record<string, unknown>) {
  try {
    localStorage.setItem(TABLE_PREFS_KEY, JSON.stringify({ ...readTablePrefs(), ...patch }));
  } catch {
  }
}

function load(): TableViewPrefs {
  const saved = readTablePrefs();
  const prefs = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as Array<keyof TableViewPrefs>) {
    if (typeof DEFAULTS[key] === 'boolean' && typeof saved[key] === 'boolean') (prefs as Record<string, unknown>)[key] = saved[key];
  }
  if (STRIP_SIZES.includes(saved.resourceStripSize as StripSize)) prefs.resourceStripSize = saved.resourceStripSize as StripSize;
  return prefs;
}

export const tableViewPrefs = reactive<TableViewPrefs>(load());

watch(tableViewPrefs, prefs => writeTablePrefs({ ...prefs }));
