import type { LiveSubscriber } from './live-manipulation.ts';

type SignalType = 'ping' | 'measure' | 'measure-clear';

type Point = { x: number; z: number };

const COORDINATE_LIMIT = 1000;
const PINGS_PER_SECOND = 3;
const MEASURES_PER_SECOND = 30;

const SIGNAL_TYPES = new Set<string>(['ping', 'measure', 'measure-clear']);

function readPoint(value: unknown): Point | null {
  if (!value || typeof value !== 'object') return null;

  const { x, z } = value as Record<string, unknown>;
  const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= COORDINATE_LIMIT;

  return ok(x) && ok(z) ? { x: x as number, z: z as number } : null;
}

export function createSignals(options: {
  displayName: (userId: string) => Promise<string>;
  subscribers: () => Iterable<LiveSubscriber>;
}) {
  const budgets = new WeakMap<LiveSubscriber, { windowStart: number; ping: number; measure: number }>();
  const names = new WeakMap<LiveSubscriber, Promise<string>>();
  const measuring = new Set<LiveSubscriber>();

  function nameOf(subscriber: LiveSubscriber): Promise<string> {
    let name = names.get(subscriber);

    if (!name) {
      name = options.displayName(subscriber.userId!).catch(() => '?');
      names.set(subscriber, name);
    }

    return name;
  }

  function withinBudget(subscriber: LiveSubscriber, type: SignalType) {
    const now = Date.now();
    const budget = budgets.get(subscriber) ?? { windowStart: now, ping: 0, measure: 0 };

    if (now - budget.windowStart >= 1000) {
      budget.windowStart = now;
      budget.ping = 0;
      budget.measure = 0;
    }

    budgets.set(subscriber, budget);

    if (type === 'ping') return ++budget.ping <= PINGS_PER_SECOND;
    return ++budget.measure <= MEASURES_PER_SECOND;
  }

  function broadcast(source: LiveSubscriber, message: Record<string, unknown>) {
    const text = JSON.stringify(message);

    for (const subscriber of options.subscribers()) {
      if (subscriber === source) continue;
      if (subscriber.campaignId !== source.campaignId || subscriber.sceneId !== source.sceneId) continue;
      if (subscriber.socket.readyState === 1) subscriber.socket.send(text);
    }
  }

  function send(source: LiveSubscriber, build: (displayName: string) => Record<string, unknown>) {
    void nameOf(source).then(displayName => broadcast(source, build(displayName)));
  }

  return {
    handle(subscriber: LiveSubscriber, raw: string): boolean {
      let message: Record<string, unknown>;

      try {
        message = JSON.parse(raw);
      } catch {
        return false;
      }

      const type = message?.type;
      if (typeof type !== 'string' || !SIGNAL_TYPES.has(type)) return false;

      const userId = subscriber.userId;
      if (!userId || !withinBudget(subscriber, type as SignalType)) return true;

      if (type === 'ping') {
        const point = readPoint(message);
        if (point) send(subscriber, displayName => ({ type: 'ping', userId, displayName, ...point }));
        return true;
      }

      if (type === 'measure') {
        const from = readPoint(message.from);
        const to = readPoint(message.to);
        if (!from || !to) return true;

        measuring.add(subscriber);
        send(subscriber, displayName => ({ type: 'measure', userId, displayName, from, to }));
        return true;
      }

      if (measuring.delete(subscriber)) {
        send(subscriber, () => ({ type: 'measure-clear', userId }));
      }

      return true;
    },

    disconnected(subscriber: LiveSubscriber) {
      if (measuring.delete(subscriber) && subscriber.userId) {
        const userId = subscriber.userId;
        send(subscriber, () => ({ type: 'measure-clear', userId }));
      }
    },
  };
}
