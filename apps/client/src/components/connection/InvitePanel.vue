<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { copyText, formatInvite, isLoopbackAddress } from '../../connection/connection';
import { hostLanMode, hostRunning, hostStatus, internetAddresses, playerAddresses, refreshHostStatus } from '../../connection/hostStore';

const props = defineProps<{
  campaignId: string;
  campaignName: string;
  serverUrl: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const onLocalServer = computed(() => props.serverUrl !== '' && isLoopbackAddress(props.serverUrl));

const options = computed<{ url: string; label: string; certificate: boolean }[]>(() => {
  if (!props.serverUrl) return [];

  if (!onLocalServer.value) {
    return [{ url: props.serverUrl, label: `${props.serverUrl} — адрес, по которому подключены вы`, certificate: false }];
  }

  return [
    ...playerAddresses.value.map(address => ({
      url: address.url,
      label: `${address.url} — ${address.kind === 'vpn' ? 'VPN' : 'домашняя сеть'} («${address.interfaceName}»)`,
      certificate: address.url.startsWith('https:'),
    })),
    ...internetAddresses.value.map(address => ({
      url: address.url,
      label: `${address.url} — интернет: ${address.label}`,
      certificate: address.certificate,
    })),
  ];
});
const chosen = computed(() => options.value.find(option => option.url === address.value) ?? null);

const address = ref('');
const code = ref('');
const expiresAt = ref('');
const busy = ref(false);
const error = ref('');
const copied = ref(false);

watch(options, list => {
  if (!list.some(option => option.url === address.value)) address.value = list[0]?.url ?? '';
}, { immediate: true });

watch(() => props.campaignId, () => {
  code.value = '';
  expiresAt.value = '';
});

const text = computed(() =>
  code.value
    ? formatInvite({
        campaignName: props.campaignName,
        address: address.value.trim() || null,
        code: code.value,
        expiresAt: expiresAt.value,
        certificate: onLocalServer.value && chosen.value?.certificate ? hostStatus.value.tls?.code ?? null : null,
      })
    : '',
);

async function create() {
  busy.value = true;
  error.value = '';
  copied.value = false;

  try {
    if (onLocalServer.value) await refreshHostStatus();
    const result = await props.request(`/campaigns/${props.campaignId}/invites`, 'POST');
    code.value = result.code;
    expiresAt.value = new Date(result.expiresAt).toLocaleString('ru-RU');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось создать приглашение. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}

async function copy() {
  copied.value = await copyText(text.value);
}
</script>

<template>
  <details class="invite-panel">
    <summary>Пригласить игрока</summary>

    <p class="muted">
      Приглашение одноразовое и действует 24 часа. Каждому игроку нужно своё.
      В текст приглашения входит адрес сервера: игрок вставляет его целиком
      и попадает именно на этот сервер.
    </p>

    <p v-if="onLocalServer && (!hostRunning || (!hostLanMode && !internetAddresses.length))" class="notice warning">
      Сервер этого компьютера сейчас не принимает подключения по сети — игрок не сможет войти.
      Во вкладке «Сервер» отметьте «Подключения игроков по сети».
    </p>

    <label v-if="options.length > 1">
      Адрес сервера для игрока
      <select v-model="address" :disabled="busy">
        <option v-for="option in options" :key="option.url" :value="option.url">{{ option.label }}</option>
      </select>
      <small>Игроку в виртуальной сети нужен адрес с пометкой «Виртуальная сеть», игроку у вас дома — адрес домашней сети, игроку без общей сети — адрес «интернет» (туннель или белый IP).</small>
    </label>

    <label v-else-if="options.length === 0">
      Адрес сервера для игрока
      <input v-model="address" placeholder="например, http://26.34.12.5:3000" :disabled="busy" />
      <small>Не удалось определить адрес автоматически — впишите его или отправьте игроку отдельно.</small>
    </label>

    <p v-else class="muted">Адрес для игрока: <code>{{ address }}</code></p>

    <button type="button" :disabled="busy" @click="create">
      {{ code ? 'Создать ещё одно приглашение' : 'Создать приглашение' }}
    </button>

    <p v-if="error" class="notice error" role="alert">{{ error }}</p>

    <template v-if="code">
      <label>
        Текст приглашения — отправьте его игроку целиком
        <textarea :value="text" rows="6" readonly spellcheck="false" @focus="($event.target as HTMLTextAreaElement).select()" />
      </label>
      <button type="button" class="primary" @click="copy">
        {{ copied ? 'Скопировано ✔' : 'Скопировать приглашение' }}
      </button>
    </template>
  </details>
</template>

<style scoped>
.invite-panel textarea{font-family:Consolas,monospace;font-size:13px}
code{font-family:Consolas,monospace}
</style>
