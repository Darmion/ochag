<script setup lang="ts">
import { branding } from './ui/branding';
import ConfirmDialog from './components/common/ConfirmDialog.vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import TabletopView from './components/tabletop/TabletopView.vue';
import { ApiError } from './connection/connection';
import { shownText } from './i18n/domTranslate';
import GameIcon from './components/game/GameIcon.vue';

const view = ref<PlayerViewState | null>(null);
const error = ref('');
let stopListening: (() => void) | undefined;

function apply(state: PlayerViewState | null) {
  view.value = state;
  document.title = shownText(state ? `${branding.appName} — вид игроков: ${state.viewerName}` : `${branding.appName} — вид игроков`);
}

async function api(path: string, method = 'GET', body?: unknown) {
  if (!view.value || !window.desktop) throw new ApiError('Окно игроков не подключено.', 0);

  const response = await window.desktop.request({
    path,
    method,
    token: view.value.token,
    ...(body !== undefined ? { body: JSON.parse(JSON.stringify(body)) } : {}),
  });

  if (response.status < 200 || response.status >= 300) {
    throw new ApiError(response.data?.message ?? `Сервер ответил ошибкой ${response.status}. Попробуйте ещё раз.`, response.status, [], response.status === 0);
  }

  return response.binary ? new Blob([response.data], response.contentType ? { type: response.contentType } : {}) : response.data;
}

onMounted(async () => {
  document.documentElement.style.overflow = 'hidden';

  if (!window.desktop?.playerView) {
    error.value = 'Окно «вид игроков» работает только в приложении.';
    return;
  }

  stopListening = window.desktop.playerView.onChanged(apply);

  try {
    apply(await window.desktop.playerView.state());
    if (!view.value) error.value = 'Окно игроков закрыто в главном окне.';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
});

onBeforeUnmount(() => stopListening?.());
</script>

<template>
  <main class="player-view-page">
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>

    <TabletopView
      v-if="view"
      :key="`${view.campaignId}:${view.viewAs}`"
      :campaign-id="view.campaignId"
      :token="view.token"
      :current-user-id="view.viewAs"
      :request="api"
      :view-as="view.viewAs"
      :fixed-scene-id="view.sceneId"
    />

    <p v-if="view" class="player-view-badge" aria-live="polite">
      <GameIcon class="inline-icon" name="eye" :size="16" /> {{ view.viewerName }}
    </p>
    <ConfirmDialog />
  </main>
</template>

<style scoped>
.player-view-page{min-height:100vh;background:#0b0704}
.player-view-badge{position:fixed;right:12px;top:12px;z-index:2100;margin:0;padding:3px 10px;background:#1a120bd9;color:#f1e4c5;border:1px solid var(--brass, #a68148);border-radius:4px;font-size:13px;pointer-events:none}
</style>
