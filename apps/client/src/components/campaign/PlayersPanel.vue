<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

import { timeAgo } from '../../connection/connection';

type OnlinePlayer = {
  userId: string;
  displayName: string;
  username: string;
  online: boolean;
  lastSeenAt: number | null;
  campaigns: { name: string; isGm: boolean }[];
  atTable: { campaignName: string; sceneName: string }[];
};

const props = defineProps<{
  request: (path: string) => Promise<any>;
  currentUserId: string;
}>();

const players = ref<OnlinePlayer[]>([]);
const now = ref(Date.now());
const error = ref('');
let timer: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  try {
    const result = await props.request('/campaigns/online');
    players.value = result.players;
    now.value = result.now;
    error.value = '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось получить список игроков. Попробуйте ещё раз.';
  }
}

onMounted(() => {
  void refresh();
  timer = setInterval(() => void refresh(), 5000);
});

onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <section class="panel players-panel" aria-labelledby="players-title">
    <h2 id="players-title">Игроки</h2>

    <p class="muted">
      Участники ваших кампаний на этом сервере. «На связи» — приложение игрока открыто
      и отвечает; «за столом» — у него открыт игровой стол.
    </p>

    <p v-if="error" class="notice error">{{ error }}</p>

    <div v-if="players.length" class="table-wrapper">
      <table>
        <thead>
          <tr><th>Игрок</th><th>Связь</th><th>Сейчас</th><th>Кампании</th></tr>
        </thead>
        <tbody>
          <tr v-for="player in players" :key="player.userId" :class="{ offline: !player.online }">
            <td>
              <strong>{{ player.displayName }}</strong>
              <span v-if="player.userId === props.currentUserId" class="muted"> (вы)</span>
              <small>логин: {{ player.username }}</small>
            </td>
            <td>
              <span class="presence" :data-online="player.online">{{ player.online ? 'на связи' : 'не в сети' }}</span>
              <small v-if="player.lastSeenAt && !player.online">был {{ timeAgo(player.lastSeenAt, now) }}</small>
            </td>
            <td>
              <template v-if="player.atTable.length">
                За столом:
                <span v-for="place in player.atTable" :key="`${place.campaignName}-${place.sceneName}`" class="place">
                  {{ place.campaignName }} / {{ place.sceneName }}
                </span>
              </template>
              <span v-else class="muted">{{ player.online ? 'в меню' : '—' }}</span>
            </td>
            <td>
              <span v-for="campaign in player.campaigns" :key="campaign.name" class="place">
                {{ campaign.name }}{{ campaign.isGm ? ' — мастер' : '' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else-if="!error" class="muted">Пока никого нет.</p>
  </section>
</template>

<style scoped>
tr.offline{opacity:.6}
.presence{font-weight:700}
.presence::before{content:"●";margin-right:6px;color:#8a7b66}
.presence[data-online="true"]::before{color:#3f8a4e}
.place{display:block}
</style>
