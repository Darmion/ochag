import type { WebSocket } from 'ws';

import { samePose, stepPose, type Pose, type Pull, type Vec3 } from '../../../../../packages/domain/map/tug.ts';

export type LiveKind = 'object';

export type LiveSubscriber = {
  socket: WebSocket;
  campaignId: string;
  sceneId: string;
  userId?: string;
};

export type ManipulationTarget = {
  pose: Pose;
  canSee: (subscriber: LiveSubscriber, pose: Pose) => boolean;
  clamp: (point: Vec3) => Vec3;
  commit: (pose: Pose) => Promise<Pose>;
};

export type TargetLoader = (
  subscriber: LiveSubscriber,
  kind: LiveKind,
  id: string,
) => Promise<ManipulationTarget | { denied: string }>;

type Grab = {
  subscriber: LiveSubscriber;
  displayName: string;
  pull: Pull;
  lastAt: number;
};

type Session = {
  kind: LiveKind;
  id: string;
  campaignId: string;
  sceneId: string;
  target: ManipulationTarget;
  pose: Pose;
  grabs: Map<LiveSubscriber, Grab>;
  broadcastPose: Pose | null;
  holdersChanged: boolean;
  committing: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICK_MS = 50;
// At most 15 cells per second: a pull, not a teleport.
const MAX_STEP = 0.75;
const STALE_MS = 10_000;
const MAX_MESSAGES_PER_SECOND = 80;

const finite = (value: unknown, limit = 10_000) =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

export function createManipulation(options: {
  load: TargetLoader;
  displayName: (userId: string) => Promise<string>;
  subscribers: () => Iterable<LiveSubscriber>;
}) {
  const sessions = new Map<string, Session>();
  const budgets = new WeakMap<LiveSubscriber, { windowStart: number; count: number }>();
  let timer: ReturnType<typeof setInterval> | undefined;

  const keyOf = (kind: LiveKind, id: string) => `${kind}:${id}`;

  function send(subscriber: LiveSubscriber, message: Record<string, unknown>) {
    if (subscriber.socket.readyState === 1) subscriber.socket.send(JSON.stringify(message));
  }

  function broadcast(session: Session, final: boolean) {
    const message = {
      type: 'pose',
      kind: session.kind,
      id: session.id,
      x: session.pose.x,
      y: session.pose.y,
      z: session.pose.z,
      rotationY: session.pose.rotationY,
      scale: session.pose.scale,
      holders: [...session.grabs.values()].map(grab => ({ userId: grab.subscriber.userId, displayName: grab.displayName })),
      final,
    };

    for (const subscriber of options.subscribers()) {
      if (subscriber.campaignId !== session.campaignId || subscriber.sceneId !== session.sceneId) continue;
      if (session.grabs.has(subscriber) || session.target.canSee(subscriber, session.pose)) send(subscriber, message);
    }

    session.broadcastPose = { ...session.pose };
    session.holdersChanged = false;
  }

  function ensureTimer() {
    if (timer || sessions.size === 0) return;
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
  }

  function stopTimerIfIdle() {
    if (timer && sessions.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  async function finish(session: Session) {
    if (session.committing) return;
    session.committing = true;

    try {
      session.pose = await session.target.commit(session.pose);
    } catch {
    }

    broadcast(session, true);
    sessions.delete(keyOf(session.kind, session.id));
    stopTimerIfIdle();
  }

  function tick() {
    const now = Date.now();

    for (const session of sessions.values()) {
      if (session.committing) continue;

      for (const [subscriber, grab] of session.grabs) {
        if (now - grab.lastAt > STALE_MS) {
          session.grabs.delete(subscriber);
          session.holdersChanged = true;
        }
      }

      if (session.grabs.size === 0) {
        void finish(session);
        continue;
      }

      session.pose = stepPose(session.pose, [...session.grabs.values()].map(grab => grab.pull), MAX_STEP);

      if (session.holdersChanged || !session.broadcastPose || !samePose(session.pose, session.broadcastPose)) {
        broadcast(session, false);
      }
    }
  }

  async function grab(subscriber: LiveSubscriber, kind: LiveKind, id: string) {
    const key = keyOf(kind, id);
    const existing = sessions.get(key);

    if (existing?.committing) {
      send(subscriber, { type: 'grab-denied', kind, id, message: 'Его только что отпустили — попробуйте ещё раз.' });
      return;
    }

    const loaded = await options.load(subscriber, kind, id);

    if ('denied' in loaded) {
      send(subscriber, { type: 'grab-denied', kind, id, message: loaded.denied });
      return;
    }

    let session = sessions.get(key);

    if (session?.committing) {
      send(subscriber, { type: 'grab-denied', kind, id, message: 'Его только что отпустили — попробуйте ещё раз.' });
      return;
    }

    if (!session) {
      session = {
        kind,
        id,
        campaignId: subscriber.campaignId,
        sceneId: subscriber.sceneId,
        target: loaded,
        pose: { ...loaded.pose },
        grabs: new Map(),
        broadcastPose: null,
        holdersChanged: true,
        committing: false,
      };
      sessions.set(key, session);
    }

    session.grabs.set(subscriber, {
      subscriber,
      displayName: subscriber.userId ? await options.displayName(subscriber.userId) : '?',
      pull: { target: { x: session.pose.x, y: session.pose.y, z: session.pose.z } },
      lastAt: Date.now(),
    });
    session.holdersChanged = true;
    ensureTimer();
  }

  function pull(subscriber: LiveSubscriber, kind: LiveKind, id: string, message: Record<string, unknown>) {
    const session = sessions.get(keyOf(kind, id));
    const current = session?.grabs.get(subscriber);
    if (!session || !current || session.committing) return;
    if (!finite(message.x) || !finite(message.y) || !finite(message.z)) return;

    const pullData: Pull = {
      target: session.target.clamp({ x: message.x as number, y: message.y as number, z: message.z as number }),
    };

    if (finite(message.rotationY, 100_000)) pullData.rotationY = (((message.rotationY as number) % 360) + 360) % 360;
    if (finite(message.scale, 50) && (message.scale as number) > 0) pullData.scale = message.scale as number;

    current.pull = pullData;
    current.lastAt = Date.now();
  }

  function release(subscriber: LiveSubscriber, kind: LiveKind, id: string) {
    const session = sessions.get(keyOf(kind, id));
    const grabbed = session?.grabs.get(subscriber);
    if (!session || !grabbed) return;

    session.grabs.delete(subscriber);
    session.holdersChanged = true;

    if (session.grabs.size === 0) {
      // On release the object lands where it was pulled, not where its speed-limited motion got to.
      session.pose = {
        ...session.pose,
        ...grabbed.pull.target,
        ...(grabbed.pull.rotationY !== undefined ? { rotationY: grabbed.pull.rotationY } : {}),
        ...(grabbed.pull.scale !== undefined ? { scale: grabbed.pull.scale } : {}),
      };
      void finish(session);
    }
  }

  function withinBudget(subscriber: LiveSubscriber) {
    const now = Date.now();
    const budget = budgets.get(subscriber) ?? { windowStart: now, count: 0 };

    if (now - budget.windowStart >= 1000) {
      budget.windowStart = now;
      budget.count = 0;
    }

    budget.count += 1;
    budgets.set(subscriber, budget);
    return budget.count <= MAX_MESSAGES_PER_SECOND;
  }

  return {
    handle(subscriber: LiveSubscriber, raw: string) {
      if (!withinBudget(subscriber)) return;

      let message: Record<string, unknown>;

      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      const kind = message.kind;
      const id = message.id;
      if (kind !== 'object' || typeof id !== 'string' || !UUID.test(id)) return;

      if (message.type === 'grab') void grab(subscriber, kind, id).catch(() => {
        send(subscriber, { type: 'grab-denied', kind, id, message: 'Не удалось взять — попробуйте ещё раз.' });
      });
      else if (message.type === 'pull') pull(subscriber, kind, id, message);
      else if (message.type === 'release') release(subscriber, kind, id);
    },

    releaseAll(subscriber: LiveSubscriber) {
      for (const session of [...sessions.values()]) {
        if (session.grabs.delete(subscriber)) {
          session.holdersChanged = true;
          if (session.grabs.size === 0) void finish(session);
        }
      }
    },

    dispose() {
      if (timer) clearInterval(timer);
      timer = undefined;
      sessions.clear();
    },
  };
}
