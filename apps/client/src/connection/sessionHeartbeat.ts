import { onBeforeUnmount, type Ref } from 'vue';
import type { SessionConnection } from '../components/connection/ConnectionBadge.vue';
import { ApiError } from './connection';

export function useSessionHeartbeat({ api, resetSession, token, currentUserId, savedLoginId, sessionConnection, isServerHost, canCreateCampaigns, connectionState }: {
  api: (path: string, method?: string, body?: unknown, file?: File) => Promise<any>;
  resetSession: (notice?: string, invite?: string) => void;
  token: Ref<string>;
  currentUserId: Ref<string>;
  savedLoginId: Ref<string | null>;
  sessionConnection: Ref<SessionConnection | null>;
  isServerHost: Ref<boolean>;
  canCreateCampaigns: Ref<boolean>;
  connectionState: Ref<'ok' | 'lost' | 'expired'>;
}) {
  const HEARTBEAT_MS = 20_000;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let heartbeatRunning = false;

  async function checkSession() {
    if (!token.value || heartbeatRunning) return;
    heartbeatRunning = true;

    try {
      const me = await api('/me');
      sessionConnection.value = me.connection ?? null;
      isServerHost.value = me.isServerHost === true;
      canCreateCampaigns.value = me.canCreateCampaigns === true;
      connectionState.value = 'ok';
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await renewSession();
      } else {
        connectionState.value = 'lost';
      }
    } finally {
      heartbeatRunning = false;
    }
  }

  async function renewSession() {
    if (window.desktop && savedLoginId.value) {
      const response = await window.desktop.auth.loginSaved(savedLoginId.value);

      if (response.status >= 200 && response.status < 300 && response.data?.user?.id === currentUserId.value) {
        token.value = response.data.token;
        connectionState.value = 'ok';
        return;
      }
    }

    connectionState.value = 'expired';
    resetSession('Сессия истекла — войдите снова.');
  }

  function startHeartbeat() {
    clearInterval(heartbeat);
    heartbeat = setInterval(() => void checkSession(), HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    clearInterval(heartbeat);
  }

  onBeforeUnmount(stopHeartbeat);

  return { startHeartbeat, stopHeartbeat, checkSession };
}
