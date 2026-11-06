import { ref } from 'vue';

const STORAGE_KEY = 'ochag.musicOffTable.v1';

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export const musicOffTable = ref(read());

export function setMusicOffTable(enabled: boolean) {
  musicOffTable.value = enabled;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
  }
}
