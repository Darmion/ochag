import { confirmAction } from '../../ui/confirmDialog';
import type { TableToast } from '../toasts';
import type { TableCounter } from '../../components/tabletop/TableCounters.vue';
import type { TabletopProps } from './types';

export type CountersDeps = {
  props: TabletopProps;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  basePath: () => string;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
};

export function useCounters({ props, pushToast, basePath, refresh, run }: CountersDeps) {
  function announceExpiredTimers(previous: TableCounter[], next: TableCounter[]) {
    const before = new Map(previous.map(counter => [counter.id, counter.value]));
    for (const counter of next) {
      const was = before.get(counter.id);
      if (counter.kind === 'rounds' && counter.value === 0 && was !== undefined && was > 0) {
        pushToast({ tone: 'turn', title: `Время вышло: «${counter.name}»`, detail: 'Таймер по раундам дошёл до нуля.' });
      }
    }
  }

  function countersPath() {
    return `${basePath()}/counters`;
  }

  function createCounter(payload: { name: string; kind: 'counter' | 'rounds'; value: number; hidden: boolean }) {
    return run(async () => {
      await props.request(countersPath(), 'POST', payload);
      await refresh();
    });
  }

  function changeCounter(payload: { id: string; delta: number }) {
    return run(async () => {
      await props.request(`${countersPath()}/${payload.id}`, 'PATCH', { delta: payload.delta });
      await refresh();
    });
  }

  async function removeCounter(counter: TableCounter) {
    if (!(await confirmAction(`Убрать «${counter.name}» со стола?`, { title: 'Убрать', confirmLabel: 'Убрать', danger: true }))) return;
    return run(async () => {
      await props.request(`${countersPath()}/${counter.id}`, 'DELETE');
      await refresh();
    });
  }

  return { announceExpiredTimers, createCounter, changeCounter, removeCounter };
}
