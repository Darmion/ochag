import { ref } from 'vue';

import { branding } from '../ui/branding';
import { playSfx } from '../tabletop/sfx';

const STORAGE_KEY = 'ochag.turnNotify.v1';

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export const turnNotifyEnabled = ref(readEnabled());

export function setTurnNotify(enabled: boolean) {
  turnNotifyEnabled.value = enabled;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
  }
  // Ask for notification permission right on the click, otherwise the browser may not show the prompt.
  if (enabled && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission().catch(() => {});
}

function away() {
  return typeof document !== 'undefined' && (document.hidden || !document.hasFocus());
}

function showNotification(title: string, body: string) {
  if (typeof Notification === 'undefined') return;
  const show = () => {
    try {
      const note = new Notification(title, { body, tag: 'ochag-turn' });
      note.onclick = () => {
        window.focus();
        note.close();
      };
    } catch {
    }
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission === 'default') void Notification.requestPermission().then(result => { if (result === 'granted') show(); }).catch(() => {});
}

export function alertMyTurn(name: string, detail = 'Ваш ход!') {
  playSfx('your-turn');
  if (!turnNotifyEnabled.value || !away()) return;
  void window.desktop?.attention?.().catch(() => {});
  showNotification(`${detail} — ${name}`, `${branding.appName}: откройте игру, чтобы сходить.`);
}
