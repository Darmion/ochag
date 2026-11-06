import { ref, watch, type Ref } from 'vue';
import { ApiError } from '../connection/connection';
import { confirmAction } from '../ui/confirmDialog';
import type { Popover } from './types';

export type FriendlyFireDeps = {
  popover: Ref<Popover>;
  working: Ref<boolean>;
  actionError: Ref<string>;
};

export function useFriendlyFire({ popover, working, actionError }: FriendlyFireDeps) {
  const WARN_FRIENDLY_KEY = 'ttrpg.warnFriendly';
  function readWarnFriendly() {
    try {
      return localStorage.getItem(WARN_FRIENDLY_KEY) !== 'false';
    } catch {
      return true;
    }
  }
  const warnFriendly = ref(readWarnFriendly());
  watch(warnFriendly, value => {
    try {
      localStorage.setItem(WARN_FRIENDLY_KEY, String(value));
    } catch {
    }
  });
  const CANCELLED = new Error('');
  async function sendFriendly<T>(send: (warn: boolean) => Promise<T>): Promise<T> {
    try {
      return await send(warnFriendly.value);
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.code !== 'FRIENDLY_FIRE') throw cause;
      const harmful = (cause.details as { harmful?: boolean } | undefined)?.harmful !== false;
      const ok = await confirmAction(cause.message, {
        title: harmful ? 'Это свои' : 'Это враг',
        confirmLabel: harmful ? 'Всё равно ударить' : 'Всё равно помочь',
        danger: harmful,
      });
      if (!ok) throw CANCELLED;
      return send(false);
    }
  }

  async function perform(action: () => Promise<unknown>, keepOpen = false) {
    if (working.value) return;
    working.value = true;
    actionError.value = '';
    try {
      await action();
      if (!keepOpen) popover.value = null;
    } catch (cause) {
      actionError.value = cause instanceof Error ? cause.message : 'Не получилось.';
    } finally {
      working.value = false;
    }
  }

  return { warnFriendly, sendFriendly, perform };
}
