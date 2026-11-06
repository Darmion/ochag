<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

import { timeAgo } from '../../connection/connection';
import { hostConnections } from '../../connection/hostStore';

const props = defineProps<{ embedded?: boolean }>();
const data = ref<HostConnections | null>(null);
const error = ref('');
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

const EVENT_LABELS: Record<HostAuthEvent['kind'], string> = {
  login: 'Вход',
  login_failed: 'Вход не удался',
  register: 'Регистрация',
  register_failed: 'Регистрация не удалась',
};

async function refresh() {
  if (!window.desktop) return;

  try {
    data.value = await window.desktop.host.connections();
    hostConnections.value = data.value;
    error.value = '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось получить список подключений. Попробуйте ещё раз.';
  }

  now.value = Date.now();
}

function viaText(entry: { network: string | null; serverAddress: string; serverPort?: number | null }) {
  const address = entry.serverPort ? `${entry.serverAddress}:${entry.serverPort}` : entry.serverAddress;
  return entry.network ? `${entry.network} · ${address}` : address;
}

onMounted(() => {
  void refresh();
  timer = setInterval(() => void refresh(), 4000);
});

onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="connected-players">
    <h3 v-if="!props.embedded">Подключённые игроки</h3>

    <p class="muted">
      Все игроки входят на один и тот же порт сервера — разные порты не нужны.
      Колонка «Вошёл через» показывает, по какому адресу этого компьютера
      (и через какой сетевой адаптер) подключился игрок; «Адрес игрока» — IP его компьютера.
    </p>

    <p v-if="error" class="notice error">{{ error }}</p>

    <div v-if="data?.connections.length" class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Игрок</th>
            <th>Связь</th>
            <th>Адрес игрока</th>
            <th>Вошёл через</th>
            <th>Сейчас</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in data.connections" :key="`${entry.userId}-${entry.firstSeenAt}`" :class="{ offline: !entry.online }">
            <td>
              <strong>{{ entry.displayName }}</strong>
              <small>логин: {{ entry.username }}</small>
            </td>
            <td>
              <span class="presence" :data-online="entry.online">
                {{ entry.online ? 'на связи' : 'пропал' }}
              </span>
              <small>{{ timeAgo(entry.lastSeenAt, now) }}</small>
            </td>
            <td>
              {{ entry.fromThisComputer ? 'этот компьютер' : entry.clientAddress }}
            </td>
            <td>{{ viaText(entry) }}</td>
            <td>
              <template v-if="entry.atTable.length">
                За столом:
                <span v-for="place in entry.atTable" :key="`${place.campaignName}-${place.sceneName}`" class="place">
                  {{ place.campaignName }} / {{ place.sceneName }}
                </span>
              </template>
              <span v-else class="muted">в меню</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else-if="data" class="muted">
      Пока никто не подключился. Если игрок не может войти, попросите его нажать
      «Проверить подключение» на своём экране — там будет названа причина.
    </p>

    <details v-if="data?.events.length" class="events">
      <summary>Последние попытки входа ({{ data.events.length }})</summary>
      <ul>
        <li v-for="event in data.events" :key="`${event.at}-${event.username}-${event.kind}`" :data-ok="event.kind === 'login' || event.kind === 'register'">
          <span class="when">{{ timeAgo(event.at, now) }}</span>
          <strong>{{ EVENT_LABELS[event.kind] }}</strong>
          <span v-if="event.username">«{{ event.username }}»</span>
          — {{ event.reason }}
          <small>
            с {{ event.fromThisComputer ? 'этого компьютера' : event.remoteAddress }}
            через {{ viaText({ network: event.network, serverAddress: event.localAddress }) }}
          </small>
        </li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.connected-players h3{font-size:19px;margin:22px 0 8px}
.events{margin-top:10px}
tr.offline{opacity:.6}
.presence{font-weight:700}
.presence::before{content:"●";margin-right:6px;color:#8a7b66}
.presence[data-online="true"]::before{color:var(--g-good)}
.place{display:block;font-weight:600}
.events ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px;font-size:14px}
.events li{padding:6px 10px;border-left:3px solid var(--g-bad);background:var(--surface-inset)}
.events li[data-ok="true"]{border-left-color:var(--g-good)}
.when{color:var(--muted-ink);margin-right:6px}
</style>
