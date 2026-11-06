<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { isLoopbackAddress } from '../../connection/connection';
import { latencyTone, liveLatencyMs } from '../../connection/latency';
import { t } from '../../i18n/i18n';

export type SessionConnection = {
  clientAddress: string;
  serverAddress: string;
  serverPort: number | null;
  network: string | null;
};

const props = defineProps<{
  serverUrl: string;
  server: ServerProbe | null;
  username: string;
  displayName: string;
  connection: SessionConnection | null;
  state: 'ok' | 'lost' | 'expired';
  compact?: boolean;
}>();

const emit = defineEmits<{ switchServer: []; help: [] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const ownServer = computed(() =>
  isLoopbackAddress(props.serverUrl) || (props.server?.ok === true && props.server.thisComputer),
);

const serverTitle = computed(() => {
  if (!props.serverUrl) return t('локальный сервер разработки');
  if (ownServer.value) return t('ваш сервер (этот компьютер)');
  if (props.server?.ok && props.server.hostName) return t('компьютер «{host}»', { host: props.server.hostName });
  return props.serverUrl;
});

const shortTitle = computed(() => {
  if (!props.serverUrl) return t('Разработка');
  if (ownServer.value) return t('Ваш сервер');
  if (props.server?.ok && props.server.hostName) return props.server.hostName;
  try {
    return new URL(props.serverUrl).host;
  } catch {
    return props.serverUrl;
  }
});

const fullTitle = computed(() => `${t('Подключено к:')} ${serverTitle.value} — ${t('вы — {name} ({login})', { name: props.displayName, login: props.username })}`);

const stateText = computed(() => ({
  ok: t('На связи'),
  lost: t('Нет связи с сервером — повторяю…'),
  expired: t('Сессия истекла'),
}[props.state]));

function onDocumentClick(event: MouseEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false;
}

onMounted(() => document.addEventListener('click', onDocumentClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
</script>

<template>
  <div ref="root" class="connection-badge" :data-state="props.state">
    <button type="button" class="badge-button" :aria-expanded="open" :title="props.compact ? fullTitle : undefined" @click="open = !open">
      <span class="dot" aria-hidden="true" />
      <span class="badge-text">
        <span v-if="props.compact" class="badge-line"><strong>{{ shortTitle }}</strong><span v-if="liveLatencyMs !== null" class="latency" :class="latencyTone(liveLatencyMs)"> · {{ t('{ms} мс', { ms: liveLatencyMs }) }}</span></span>
        <span v-else class="badge-line">
          {{ t('Подключено к:') }} <strong>{{ serverTitle }}</strong>
          <span v-if="liveLatencyMs !== null" class="latency" :class="latencyTone(liveLatencyMs)" :title="t('Задержка до сервера туда и обратно: {ms} мс', { ms: liveLatencyMs })"> · {{ t('{ms} мс', { ms: liveLatencyMs }) }}</span>
        </span>
        <small>{{ t('вы — {name} ({login})', { name: props.displayName, login: props.username }) }}</small>
      </span>
    </button>

    <div v-if="open" class="badge-details" role="dialog" :aria-label="t('Сведения о подключении')">
      <dl>
        <dt>{{ t('Состояние') }}</dt>
        <dd>{{ stateText }}</dd>

        <dt>{{ t('Адрес сервера') }}</dt>
        <dd><code>{{ props.serverUrl || t('через среду разработки (/api)') }}</code></dd>

        <template v-if="liveLatencyMs !== null">
          <dt>{{ t('Задержка') }}</dt>
          <dd>
            {{ t('{ms} мс туда и обратно —', { ms: liveLatencyMs }) }}
            {{ { good: t('отлично'), fair: t('нормально'), slow: t('медленно: проверьте Wi-Fi или подключитесь по адресу домашней сети, а не VPN'), none: '' }[latencyTone(liveLatencyMs)] }}
          </dd>
        </template>

        <template v-if="props.server?.ok">
          <dt>{{ t('Компьютер сервера') }}</dt>
          <dd>{{ props.server.hostName ?? '—' }}{{ ownServer ? t(' — это ваш компьютер') : '' }}</dd>
          <dt>{{ t('ID сервера') }}</dt>
          <dd><code>{{ props.server.serverId?.slice(0, 8) ?? '—' }}</code></dd>
        </template>

        <template v-if="props.connection">
          <dt>{{ t('Сервер видит вас как') }}</dt>
          <dd><code>{{ props.connection.clientAddress }}</code></dd>
          <dt>{{ t('Вы вошли через') }}</dt>
          <dd>
            <code>{{ props.connection.serverAddress }}{{ props.connection.serverPort ? `:${props.connection.serverPort}` : '' }}</code>
            {{ props.connection.network ? `(${props.connection.network})` : '' }}
          </dd>
        </template>
      </dl>

      <p v-if="ownServer" class="muted own-note">
        {{ t('Вы на собственном сервере. Кампании, созданные на сервере другого компьютера, здесь не появятся — для игры у мастера подключитесь к его адресу.') }}
      </p>

      <div class="badge-actions">
        <button type="button" @click="emit('switchServer')">{{ t('Выйти / сменить сервер') }}</button>
        <button type="button" @click="open = false; emit('help')">{{ t('Справка') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.connection-badge{position:relative;min-width:0;max-width:100%}
.badge-button{display:flex;align-items:center;gap:10px;text-align:left;min-height:44px;padding:6px 12px;min-width:0;max-width:100%;overflow:hidden}
/* min-width:0 so a long server name shrinks instead of pushing the badge off the top bar. */
.badge-text{display:flex;flex-direction:column;min-width:0;font-weight:400;font-size:13px}
.badge-line{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge-text small{margin:0;font-size:11px}
.dot{width:11px;height:11px;border-radius:50%;background:#3f8a4e;flex-shrink:0;box-shadow:0 0 0 2px #0002}
.connection-badge[data-state="lost"] .dot{background:#c49a2c}
.connection-badge[data-state="expired"] .dot{background:#a83a3a}
.badge-details{position:absolute;right:0;top:calc(100% + 6px);z-index:2500;width:min(380px,90vw);padding:16px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 12px 30px #0008}
.badge-details dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:0;font-size:14px}
.badge-details dt{font-weight:700}
.badge-details dd{margin:0;overflow-wrap:anywhere}
.own-note{font-size:13px}
.badge-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.badge-actions button{min-height:34px;padding:4px 12px;font-size:13px}
code{font-family:Consolas,monospace}
.latency{font-weight:600}
.latency.good{color:#7fd08a}
.latency.fair{color:#e0c060}
.latency.slow{color:#ff8f80}
</style>
