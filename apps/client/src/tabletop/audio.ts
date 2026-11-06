export type AudioState = {
  asset_id: string | null;
  queue: string[];
  asset_name: string | null;
  playing: boolean;
  loop: boolean;
  volume: number;
  started_at: string | null;
  paused_at_seconds: number;
  revision: number;
  mood?: 'explore' | 'combat' | 'tension';
  scene_id?: string | null;
  scene_name?: string | null;
};

export function musicOffScene(state: AudioState | null, sceneId: string): boolean {
  return Boolean(state?.scene_id && state.scene_id !== sceneId);
}

export type LocalAudioSettings = { music: number; effects: number; muted: boolean };

const MAX_DRIFT_SECONDS = 1.5;
const RESYNC_MS = 15000;

export function createAudioPlayer(options: {
  loadUrl: (assetId: string) => Promise<string>;
  onBlocked: (blocked: boolean) => void;
  onEnded?: (revision: number) => void;
  onLoadError?: (assetId: string, message: string | null) => void;
}) {
  const music = new Audio();
  music.preload = 'auto';
  let state: AudioState | null = null;
  let clockOffsetMs = 0;
  let local: LocalAudioSettings = { music: 0.7, effects: 0.8, muted: false };
  let scene = '';
  let disposed = false;
  let applying = Promise.resolve();
  const effects = new Set<{ element: HTMLAudioElement; base: number }>();

  function stopEffects() {
    for (const effect of effects) {
      effect.element.pause();
      effect.element.removeAttribute('src');
      effect.element.load();
    }
    effects.clear();
  }

  function inQueue() {
    return Boolean(state && state.queue.length > 1);
  }

  music.addEventListener('ended', () => {
    if (!disposed && state?.playing && inQueue()) options.onEnded?.(state.revision);
  });

  function serverNow() {
    return Date.now() + clockOffsetMs;
  }

  function musicVolume() {
    return local.muted || !state || musicOffScene(state, scene) ? 0 : Math.max(0, Math.min(1, state.volume * local.music));
  }

  function whenReady(element: HTMLAudioElement) {
    if (element.readyState >= 1) return Promise.resolve();
    return new Promise<void>(resolve => {
      const done = () => {
        element.removeEventListener('loadedmetadata', done);
        element.removeEventListener('error', done);
        resolve();
      };
      element.addEventListener('loadedmetadata', done);
      element.addEventListener('error', done);
    });
  }

  function fade(to: number, ms: number) {
    return new Promise<void>(resolve => {
      const from = music.volume;
      const start = performance.now();
      const step = () => {
        if (disposed) return resolve();
        const t = Math.min(1, (performance.now() - start) / ms);
        music.volume = Math.max(0, Math.min(1, from + (to - from) * t));
        if (t < 1) setTimeout(step, 40);
        else resolve();
      };
      step();
    });
  }

  async function sync() {
    if (disposed || !state) return;

    music.volume = musicVolume();

    if (!state.playing || !state.asset_id || !state.started_at) {
      music.pause();
      return;
    }

    let url: string;
    const assetId = state.asset_id;
    try {
      url = await options.loadUrl(assetId);
      options.onLoadError?.(assetId, null);
    } catch (cause) {
      options.onLoadError?.(assetId, cause instanceof Error ? cause.message : String(cause));
      return;
    }
    if (disposed) return;
    const switching = music.src !== url;
    if (switching) {
      if (!music.paused && music.currentSrc) await fade(0, 1200);
      if (disposed) return;
      music.src = url;
    }
    music.loop = state.loop && !inQueue();
    await whenReady(music);

    let target = (serverNow() - Date.parse(state.started_at)) / 1000;
    const duration = music.duration;

    if (Number.isFinite(duration) && duration > 0) {
      if (state.loop && !inQueue()) target %= duration;
      else if (target >= duration) {
        music.pause();
        return;
      }
    }

    if (Math.abs(music.currentTime - target) > MAX_DRIFT_SECONDS) music.currentTime = Math.max(0, target);

    try {
      if (switching) music.volume = 0;
      await music.play();
      if (switching) void fade(musicVolume(), 1500);
      options.onBlocked(false);
    } catch {
      options.onBlocked(true);
    }
    // Prefetch the next queued track while this one plays, or a slow network waits for the whole file.
    if (inQueue()) {
      const at = state.queue.indexOf(assetId);
      const next = state.queue[(at + 1) % state.queue.length];
      if (next && next !== assetId) void options.loadUrl(next).catch(() => {});
    }
  }

  const resync = setInterval(() => void sync(), RESYNC_MS);

  return {
    apply(next: AudioState, serverNowIso: string) {
      clockOffsetMs = Date.parse(serverNowIso) - Date.now();
      state = next;
      applying = applying.then(sync).catch(() => {});
    },
    async playEffect(assetId: string, settings: { volume?: number; mode?: 'overlap' | 'interrupt' } = {}) {
      if (local.muted || disposed) return;
      if (settings.mode === 'interrupt') stopEffects();
      let url: string;
      try {
        url = await options.loadUrl(assetId);
      } catch (cause) {
        options.onLoadError?.(assetId, cause instanceof Error ? cause.message : String(cause));
        return;
      }
      const element = new Audio(url);
      const entry = { element, base: Math.max(0, Math.min(1, settings.volume ?? 1)) };
      element.volume = Math.max(0, Math.min(1, entry.base * local.effects));
      effects.add(entry);
      element.addEventListener('ended', () => effects.delete(entry));
      try {
        await element.play();
      } catch {
        effects.delete(entry);
        options.onBlocked(true);
      }
    },
    stopEffects,
    setScene(next: string) {
      scene = next;
      music.volume = musicVolume();
    },
    setLocal(next: LocalAudioSettings) {
      local = next;
      music.volume = musicVolume();
      for (const effect of effects) effect.element.volume = local.muted ? 0 : Math.max(0, Math.min(1, effect.base * local.effects));
    },
    unlock() {
      void sync();
    },
    dispose() {
      disposed = true;
      clearInterval(resync);
      stopEffects();
      music.pause();
      music.removeAttribute('src');
      music.load();
    },
  };
}
