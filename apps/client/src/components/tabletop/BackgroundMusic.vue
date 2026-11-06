<script setup lang="ts">
import { onBeforeUnmount } from 'vue';

import { onCampaignEvent } from '../../campaign/campaignEvents';
import { cachedAsset, storeAsset } from '../../tabletop/assetCache';
import { createAudioPlayer, type AudioState, type LocalAudioSettings } from '../../tabletop/audio';

const props = defineProps<{
  campaignId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const UI_PREFS_KEY = 'ttrpg.tabletop.uiPrefs';
const LAST_SCENE_KEY = 'ochag.lastScene.v1';

function localSettings(): LocalAudioSettings {
  try {
    const audio = JSON.parse(localStorage.getItem(UI_PREFS_KEY) ?? '{}')?.audio;
    return {
      music: typeof audio?.music === 'number' ? audio.music : 0.7,
      effects: typeof audio?.effects === 'number' ? audio.effects : 0.8,
      muted: audio?.muted === true,
    };
  } catch {
    return { music: 0.7, effects: 0.8, muted: false };
  }
}
function lastScene(): string {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_SCENE_KEY) ?? '{}');
    return typeof saved?.[props.campaignId] === 'string' ? saved[props.campaignId] : '';
  } catch {
    return '';
  }
}

const urls = new Map<string, Promise<string>>();
function loadUrl(assetId: string): Promise<string> {
  let url = urls.get(assetId);
  if (!url) {
    url = (async () => {
      const key = `${props.campaignId}:${assetId}`;
      let blob = await cachedAsset(key);
      if (!blob) {
        blob = await props.request(`/campaigns/${props.campaignId}/assets/${assetId}`) as Blob;
        void storeAsset(key, blob);
      }
      return URL.createObjectURL(blob);
    })();
    url.catch(() => urls.delete(assetId));
    urls.set(assetId, url);
  }
  return url;
}

let disposed = false;
let canManage = false;
const player = createAudioPlayer({
  loadUrl,
  onBlocked: () => {},
  onEnded: revision => {
    if (!canManage || disposed) return;
    void props.request(`/campaigns/${props.campaignId}/audio`, 'PUT', { action: 'next', revision })
      .then(result => { if (!disposed) player.apply(result.state as AudioState, result.serverNow); })
      .catch(() => {});
  },
});
player.setLocal(localSettings());
player.setScene(lastScene());

async function load() {
  try {
    const result = await props.request(`/campaigns/${props.campaignId}/audio`);
    if (disposed) return;
    canManage = result.canManage === true;
    player.apply(result.state as AudioState, result.serverNow);
  } catch {
  }
}
void load();
const stop = onCampaignEvent('audio', () => void load());

onBeforeUnmount(() => {
  disposed = true;
  stop();
  player.dispose();
  for (const url of urls.values()) void url.then(value => URL.revokeObjectURL(value)).catch(() => {});
});
</script>

<template>
  <span hidden aria-hidden="true" />
</template>
