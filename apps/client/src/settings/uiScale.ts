import { computed, ref, watch } from 'vue';

const KEY = 'ttrpg.uiScale';

function read(): number {
  try {
    const raw = Number(localStorage.getItem(KEY));
    return Number.isFinite(raw) && raw >= 80 && raw <= 160 ? raw : 100;
  } catch {
    return 100;
  }
}

export const uiScale = ref<number>(read());

export function setUiScale(value: number) {
  if (!Number.isFinite(value)) return;
  uiScale.value = Math.max(80, Math.min(160, Math.round(value / 10) * 10));
}

watch(uiScale, value => {
  try {
    localStorage.setItem(KEY, String(value));
  } catch {
  }
});

// Desktop app: native Chromium zoom (like Ctrl+«+»), the layout just sees a smaller window. CSS zoom only in a browser, where window zoom is unavailable.
const nativeZoom = typeof window !== 'undefined' && Boolean(window.desktop?.zoom);

export const cssZoom = computed(() => (nativeZoom ? 1 : uiScale.value / 100));

// The players' window sets no zoom: Chromium shares the zoom level between windows of one origin.
const playerWindow = typeof location !== 'undefined' && new URLSearchParams(location.search).get('view') === 'player';

const applied = ref(1);
const readApplied = () => {
  const factor = window.desktop?.zoom?.get();
  if (typeof factor === 'number' && Number.isFinite(factor) && factor > 0) applied.value = factor;
};
export const windowZoom = computed(() => (nativeZoom ? applied.value : 1));

if (typeof window !== 'undefined' && !playerWindow) {
  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const step = event.code === 'Equal' || event.code === 'NumpadAdd' ? 10 : event.code === 'Minus' || event.code === 'NumpadSubtract' ? -10 : 0;
    if (step) setUiScale(uiScale.value + step);
    else if (event.code === 'Digit0' || event.code === 'Numpad0') setUiScale(100);
    else return;
    event.preventDefault();
  });
}

if (nativeZoom) {
  if (!playerWindow) {
    watch(uiScale, value => {
      window.desktop?.zoom?.set(value / 100);
      readApplied();
    }, { immediate: true });
  }
  readApplied();
  window.addEventListener('resize', readApplied);
}
