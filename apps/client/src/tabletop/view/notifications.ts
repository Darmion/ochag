import { ref, watch, type Ref, type ComputedRef } from 'vue';
import type { Tabletop } from '../scene';
import type { TableToast } from '../toasts';

export type NotificationsDeps = {
  gameUi: ComputedRef<boolean>;
  error: Ref<string>;
  table: () => Tabletop | undefined;
};

export function useNotifications({ gameUi, error, table }: NotificationsDeps) {
  const toasts = ref<TableToast[]>([]);
  const MAX_TOASTS = 5;
  let toastSequence = 0;
  const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

  function dismissToast(id: number) {
    clearTimeout(toastTimers.get(id));
    toastTimers.delete(id);
    toasts.value = toasts.value.filter(toast => toast.id !== id);
  }

  function pushToast(toast: Omit<TableToast, 'id'>, durationMs = 6000) {
    const id = ++toastSequence;
    const next = [...toasts.value, { ...toast, id }];

    while (next.length > MAX_TOASTS) {
      const dropped = next.shift()!;
      clearTimeout(toastTimers.get(dropped.id));
      toastTimers.delete(dropped.id);
    }

    toasts.value = next;
    toastTimers.set(id, setTimeout(() => dismissToast(id), durationMs));
  }

  let errorTimer: ReturnType<typeof setTimeout> | undefined;
  let lastErrorToast = { text: '', at: 0 };
  watch(error, message => {
    clearTimeout(errorTimer);
    if (!message) return;
    if (gameUi.value) {
      const now = Date.now();
      if (message !== lastErrorToast.text || now - lastErrorToast.at > 4000) {
        pushToast({ tone: 'error', title: 'Не получилось', detail: message }, 7000);
        lastErrorToast = { text: message, at: now };
      }
      error.value = '';
      return;
    }
    errorTimer = setTimeout(() => { error.value = ''; }, 8000);
  });

  function stopNotificationTimers() {
    for (const timer of toastTimers.values()) clearTimeout(timer);
    toastTimers.clear();
    clearTimeout(errorTimer);
  }

  function focusToast(toast: TableToast) {
    if (toast.focus) table()?.focusOn(toast.focus);
  }

  return { toasts, dismissToast, pushToast, stopNotificationTimers, focusToast };
}
