import os from 'node:os';

type SocketLike = {
  remoteAddress?: string | undefined;
  localAddress?: string | undefined;
  localPort?: number | null | undefined;
  network?: string | undefined;
};

type SessionPresence = {
  userId: string;
  remoteAddress: string;
  localAddress: string;
  localPort: number | null;
  network: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  live: Map<object, { campaignId: string; sceneId: string }>;
};

export type AuthEvent = {
  at: number;
  kind: 'login' | 'login_failed' | 'register' | 'register_failed';
  username: string;
  reason: string;
  remoteAddress: string;
  localAddress: string;
  network: string | null;
};

export const ONLINE_WINDOW_MS = 60_000;
const FORGET_AFTER_MS = 30 * 60_000;
const MAX_EVENTS = 30;

export function cleanAddress(address: string | undefined): string {
  return (address ?? '').replace(/^::ffff:/, '');
}

export function isLoopback(address: string): boolean {
  return address === '::1' || address.startsWith('127.');
}

export function interfaceNameFor(address: string): string | null {
  if (isLoopback(address)) return 'Этот компьютер';

  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (cleanAddress(entry.address) === address) return name;
    }
  }

  return null;
}

export function createPresence() {
  const sessions = new Map<string, SessionPresence>();
  const events: AuthEvent[] = [];

  function upsert(hash: string, userId: string, socket: SocketLike) {
    const now = Date.now();
    const existing = sessions.get(hash);

    if (existing) {
      existing.lastSeenAt = now;
      existing.remoteAddress = cleanAddress(socket.remoteAddress);
      existing.localAddress = cleanAddress(socket.localAddress);
      existing.localPort = socket.localPort ?? null;
      existing.network = socket.network ?? null;
      return existing;
    }

    const created: SessionPresence = {
      userId,
      remoteAddress: cleanAddress(socket.remoteAddress),
      localAddress: cleanAddress(socket.localAddress),
      localPort: socket.localPort ?? null,
      network: socket.network ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
      live: new Map(),
    };

    sessions.set(hash, created);
    return created;
  }

  return {
    touch(hash: string, userId: string, socket: SocketLike) {
      upsert(hash, userId, socket);
    },

    liveOpened(
      hash: string,
      userId: string,
      socket: SocketLike,
      key: object,
      target: { campaignId: string; sceneId: string },
    ) {
      upsert(hash, userId, socket).live.set(key, target);
    },

    liveClosed(hash: string, key: object) {
      const entry = sessions.get(hash);
      if (!entry) return;
      entry.live.delete(key);
      entry.lastSeenAt = Date.now();
    },

    forget(hash: string) {
      sessions.delete(hash);
    },

    event(kind: AuthEvent['kind'], username: string, reason: string, socket: SocketLike) {
      events.unshift({
        at: Date.now(),
        kind,
        username: username.slice(0, 64),
        reason,
        remoteAddress: cleanAddress(socket.remoteAddress),
        localAddress: cleanAddress(socket.localAddress),
        network: socket.network ?? null,
      });
      events.length = Math.min(events.length, MAX_EVENTS);
    },

    snapshot() {
      const now = Date.now();

      for (const [hash, entry] of sessions) {
        if (entry.live.size === 0 && now - entry.lastSeenAt > FORGET_AFTER_MS) {
          sessions.delete(hash);
        }
      }

      return {
        sessions: [...sessions.values()].map(entry => ({
          userId: entry.userId,
          remoteAddress: entry.remoteAddress,
          localAddress: entry.localAddress,
          localPort: entry.localPort,
          network: entry.network,
          firstSeenAt: entry.firstSeenAt,
          lastSeenAt: entry.lastSeenAt,
          online: entry.live.size > 0 || now - entry.lastSeenAt <= ONLINE_WINDOW_MS,
          live: [...entry.live.values()],
        })),
        events: [...events],
      };
    },
  };
}

export type Presence = ReturnType<typeof createPresence>;
