import { onBeforeUnmount, onMounted, type Ref } from 'vue';

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

// The table's /live socket says a game changed (any player's move, tabletop/live.ts): its open window reloads.
export function minigameChanged(kind: string) {
  for (const listener of listeners.get(kind) ?? []) listener();
}

// A window loads its game on opening, on every change the table hears about, and when the tab comes back into view; a
// slow poll covers changes missed while the socket reconnected.
const FALLBACK_MS = 30000;

export function useMinigameSync(kind: string, refresh: () => Promise<void>, busy: Ref<boolean>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const reload = () => {
    if (!busy.value && !document.hidden) void refresh();
  };
  const onVisible = () => {
    if (!document.hidden) reload();
  };
  const poll = () => {
    reload();
    if (!disposed) timer = setTimeout(poll, FALLBACK_MS);
  };

  onMounted(() => {
    let set = listeners.get(kind);
    if (!set) listeners.set(kind, (set = new Set()));
    set.add(reload);
    document.addEventListener('visibilitychange', onVisible);
    void refresh();
    timer = setTimeout(poll, FALLBACK_MS);
  });
  onBeforeUnmount(() => {
    disposed = true;
    clearTimeout(timer);
    listeners.get(kind)?.delete(reload);
    document.removeEventListener('visibilitychange', onVisible);
  });
}
