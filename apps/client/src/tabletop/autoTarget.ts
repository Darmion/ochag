import { ref, watch } from 'vue';

export type AutoTarget = 'nearest' | 'weakest' | 'threat';

export const AUTO_TARGETS: Array<{ id: AutoTarget; label: string; hint: string }> = [
  { id: 'nearest', label: 'Ближайшего', hint: 'по пути, в обход стен' },
  { id: 'weakest', label: 'Слабейшего', hint: 'у кого меньше хитов' },
  { id: 'threat', label: 'Опаснейшего', hint: 'кто сильнее бьёт' },
];

const KEY = 'ttrpg.autoTarget';

export function loadAutoTarget(): AutoTarget {
  try {
    const value = localStorage.getItem(KEY);
    return AUTO_TARGETS.some(entry => entry.id === value) ? (value as AutoTarget) : 'nearest';
  } catch {
    return 'nearest';
  }
}

export function saveAutoTarget(value: AutoTarget) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
  }
}

export type AutoPace = 'fast' | 'normal' | 'slow';

export const AUTO_PACES: Array<{ id: AutoPace; label: string; hint: string }> = [
  { id: 'normal', label: 'Обычно', hint: 'дойти, пауза между ударами' },
  { id: 'slow', label: 'Медленно', hint: 'долгие паузы — для новичков и трансляций' },
  { id: 'fast', label: 'Быстро', hint: 'всё сразу, без пауз' },
];

const PACE_KEY = 'ochag.autoPace';

function loadAutoPace(): AutoPace {
  try {
    const value = localStorage.getItem(PACE_KEY);
    return AUTO_PACES.some(entry => entry.id === value) ? (value as AutoPace) : 'normal';
  } catch {
    return 'normal';
  }
}

export const autoPace = ref<AutoPace>(loadAutoPace());
watch(autoPace, value => {
  try {
    localStorage.setItem(PACE_KEY, value);
  } catch {
  }
});
