import { ref, watch } from 'vue';

const KEY = 'ttrpg.chatHeight';
const MIN = 110;
const MAX = 640;
const DEFAULT = 120;

function read(): number {
  try {
    const raw = Number(localStorage.getItem(KEY));
    return Number.isFinite(raw) && raw >= MIN && raw <= MAX ? raw : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export const chatHeight = ref<number>(read());

export function setChatHeight(value: number) {
  if (!Number.isFinite(value)) return;
  chatHeight.value = Math.max(MIN, Math.min(MAX, Math.round(value)));
}

export function resetChatHeight() {
  chatHeight.value = DEFAULT;
}

watch(chatHeight, value => {
  try {
    localStorage.setItem(KEY, String(value));
  } catch {
  }
  document.documentElement.style.setProperty('--chat-height', `${value}px`);
}, { immediate: true });
