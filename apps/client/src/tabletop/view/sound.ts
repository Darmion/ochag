import { watch, ref, type Ref } from 'vue';
import { createAmbiencePlayer, ambienceTrack, waterTrack, ambienceEnabled, ambienceVolume, type SceneAmbience } from '../ambience';
import { tableMuted } from '../sounds';
import { createAudioPlayer, type AudioState, type LocalAudioSettings } from '../audio';
import type { TabletopProps, SceneDetail } from './types';
import type { TableToast } from '../toasts';

export type TableSoundDeps = {
  props: TabletopProps;
  viewOnly: boolean;
  sceneId: Ref<string>;
  sceneDetail: Ref<SceneDetail | null>;
  disposed: () => boolean;
  audioState: Ref<AudioState | null>;
  audioCanManage: Ref<boolean>;
  audioLibrary: Ref<Array<{ id: string; original_filename: string | null }>>;
  audioBlocked: Ref<boolean>;
  localAudio: Ref<LocalAudioSettings>;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  basePath: () => string;
  assetBlob: (assetId: string) => Promise<Blob>;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
};

export function useTableSound({ props, viewOnly, sceneId, sceneDetail, disposed, audioState, audioCanManage, audioLibrary, audioBlocked, localAudio, pushToast, basePath, assetBlob, refresh, run }: TableSoundDeps) {
  const audioUrls = new Map<string, Promise<string>>();

  function loadAudioUrl(assetId: string): Promise<string> {
    let url = audioUrls.get(assetId);
    if (!url) {
      url = (async () => {
        return URL.createObjectURL(await assetBlob(assetId));
      })();
      url.catch(() => audioUrls.delete(assetId));
      audioUrls.set(assetId, url);
    }
    return url;
  }

  const audioFailed = new Set<string>();
  const audioPlayer = createAudioPlayer({
    loadUrl: assetId => loadAudioUrl(assetId),
    onBlocked: blocked => { audioBlocked.value = blocked; },
    onLoadError: (assetId, message) => {
      if (message === null) {
        audioFailed.delete(assetId);
        return;
      }
      if (audioFailed.has(assetId) || viewOnly) return;
      audioFailed.add(assetId);
      const name = audioLibrary.value.find(asset => asset.id === assetId)?.original_filename;
      pushToast({ tone: 'error', title: 'Звук не скачался', detail: `${name ? `«${name}»: ` : ''}${message} Приложение попробует ещё раз.` }, 9000);
    },
    onEnded: revision => {
      if (!audioCanManage.value || viewOnly) return;
      void props.request(audioPath(), 'PUT', { action: 'next', revision })
        .then(result => {
          audioState.value = result.state;
          audioPlayer.apply(result.state, result.serverNow);
        })
        .catch(() => {});
    },
  });
  audioPlayer.setLocal(localAudio.value);
  watch(localAudio, value => audioPlayer.setLocal(value));
  watch(() => localAudio.value.muted, muted => { tableMuted.value = muted; }, { immediate: true });
  watch(sceneId, id => audioPlayer.setScene(id), { immediate: true });

  function audioPath() {
    return `/campaigns/${props.campaignId}/audio`;
  }

  async function loadAudio() {
    try {
      const [result, library] = await Promise.all([
        props.request(audioPath()),
        props.request(`/campaigns/${props.campaignId}/assets?kind=audio`),
      ]);
      if (disposed()) return;
      audioState.value = result.state;
      audioCanManage.value = result.canManage === true;
      audioLibrary.value = library.assets;
      audioPlayer.apply(result.state, result.serverNow);
    } catch {
    }
  }

  function controlAudio(payload: {
    action: 'play' | 'pause' | 'stop' | 'next' | 'previous';
    assetId?: string;
    queue?: string[];
    loop?: boolean;
    volume?: number;
    sceneId?: string | null;
  }) {
    return run(async () => {
      const result = await props.request(audioPath(), 'PUT', payload);
      audioState.value = result.state;
      audioPlayer.apply(result.state, result.serverNow);
    });
  }

  function saveScenePlaylist(tracks: string[]) {
    return run(async () => {
      if (!sceneId.value) return;
      await props.request(`${basePath()}/playlist`, 'PUT', { tracks });
      await refresh();
    });
  }

  function playSoundEffect(payload: { assetId: string; volume: number; mode: 'overlap' | 'interrupt'; userIds: string[] }) {
    return run(async () => {
      await props.request(`${audioPath()}/effects`, 'POST', {
        assetId: payload.assetId, volume: payload.volume, mode: payload.mode,
        ...(payload.userIds.length ? { userIds: payload.userIds } : {}),
      });
    });
  }

  function stopSoundEffects() {
    return run(async () => {
      await props.request(`${audioPath()}/effects/stop`, 'POST', {});
    });
  }

  function saveMoodPlaylist(payload: { mood: 'combat' | 'tension'; tracks: string[] }) {
    return run(async () => {
      await props.request(`${basePath()}/playlists`, 'PUT', payload);
      await refresh();
    });
  }

  function playSceneMood(mood: 'explore' | 'combat' | 'tension') {
    if (!sceneId.value) return;
    return run(async () => {
      await props.request(`/campaigns/${props.campaignId}/audio/mood`, 'POST', { sceneId: sceneId.value, mood });
      await loadAudio();
    });
  }

  const audioRecipients = ref<Array<{ userId: string; displayName: string }>>([]);
  async function loadAudioRecipients() {
    try {
      const result = await props.request(`/campaigns/${props.campaignId}/members/roster`);
      audioRecipients.value = (result.members as Array<{ userId: string; displayName: string }>).filter(member => member.userId !== props.currentUserId);
    } catch {
      audioRecipients.value = [];
    }
  }

  function uploadAudio(file: File) {
    return run(async () => {
      await props.request(`/campaigns/${props.campaignId}/assets?kind=audio`, 'POST', undefined, file);
      await loadAudio();
    });
  }

  const ambiencePlayer = createAmbiencePlayer();
  watch(
    () => {
      const detail = sceneDetail.value;
      const ambience = detail?.ambience;
      return [
        ambienceTrack(ambience?.place, detail?.world_minutes, detail?.weather), waterTrack(ambience?.water), ambience?.volume ?? 0.7,
        ambienceEnabled.value, ambienceVolume.value, tableMuted.value,
      ] as const;
    },
    ([place, water, volume]) => ambiencePlayer.set({ place, water, volume }),
    { immediate: true },
  );

  function saveSceneAmbience(ambience: SceneAmbience) {
    return run(async () => {
      if (!sceneId.value) return;
      await props.request(basePath(), 'PATCH', { ambience });
      await refresh();
    });
  }

  function disposeSound() {
    audioPlayer.dispose();
    ambiencePlayer.dispose();
    for (const url of audioUrls.values()) void url.then(value => URL.revokeObjectURL(value)).catch(() => {});
  }

  return { audioPlayer, loadAudio, controlAudio, saveScenePlaylist, playSoundEffect, stopSoundEffects, saveMoodPlaylist, playSceneMood, audioRecipients, loadAudioRecipients, uploadAudio, saveSceneAmbience, disposeSound };
}
