import { computed, ref, shallowRef } from 'vue';

export type HistoryEntry = {
  label: string;
  revert: () => Promise<HistoryEntry | 'noop' | null>;
};

const LIMIT = 50;

// Several edits made by one action (a stroke, a scatter, a spread) undo and redo as one step.
export function groupEntry(entries: HistoryEntry[], label: string): HistoryEntry {
  return {
    label,
    revert: async () => {
      const inverses: HistoryEntry[] = [];
      let touched = false;
      for (const entry of [...entries].reverse()) {
        const inverse = await entry.revert();
        if (inverse === 'noop') continue;
        touched = true;
        if (inverse) inverses.push(inverse);
      }
      if (!touched) return 'noop';
      return inverses.length ? groupEntry(inverses, label) : null;
    },
  };
}

export type TableHistory = ReturnType<typeof createHistory>;

export function createHistory() {
  const undoStack = shallowRef<HistoryEntry[]>([]);
  const redoStack = shallowRef<HistoryEntry[]>([]);
  const running = ref(false);

  function record(entry: HistoryEntry) {
    undoStack.value = [...undoStack.value, entry].slice(-LIMIT);
    redoStack.value = [];
  }

  async function step(from: typeof undoStack, to: typeof undoStack) {
    if (running.value) return;
    running.value = true;

    try {
      while (from.value.length) {
        const entry = from.value[from.value.length - 1]!;
        from.value = from.value.slice(0, -1);
        const inverse = await entry.revert();
        if (inverse === 'noop') continue;
        if (inverse) to.value = [...to.value, inverse].slice(-LIMIT);
        return;
      }
    } finally {
      running.value = false;
    }
  }

  return {
    record,
    undo: () => step(undoStack, redoStack),
    redo: () => step(redoStack, undoStack),
    clear() {
      undoStack.value = [];
      redoStack.value = [];
    },
    running,
    undoLabel: computed(() => undoStack.value[undoStack.value.length - 1]?.label ?? ''),
    redoLabel: computed(() => redoStack.value[redoStack.value.length - 1]?.label ?? ''),
  };
}
