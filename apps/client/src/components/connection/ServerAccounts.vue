<script setup lang="ts">
import { onMounted, ref } from 'vue';

import AccountPermissionsModal from './AccountPermissionsModal.vue';

const props = defineProps<{
  ownerId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{ loaded: [count: number] }>();

const accounts = ref<HostAccount[]>([]);
const error = ref('');
const openAccountId = ref('');

async function refresh() {
  if (!window.desktop) return;

  try {
    accounts.value = (await window.desktop.host.accounts()).accounts;
    error.value = '';
    emit('loaded', accounts.value.length);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось получить список аккаунтов. Проверьте, что сервер запущен, и откройте раздел снова.';
  }
}

function onModalChanged() {
  void refresh();
}

onMounted(() => void refresh());
defineExpose({ refresh });
</script>

<template>
  <div class="server-accounts">

    <p class="muted">
      Вы — хозяин сервера: с этого компьютера кампании создаются всегда. Остальным
      игрокам создавать свои кампании можно только с вашего разрешения. Права внутри
      конкретной кампании (полный мастер, отдельные права, зрение) открываются кнопкой
      «Разрешения» — они действуют только в кампаниях, которые ведёте вы сами.
    </p>

    <p v-if="error" class="notice error">{{ error }}</p>

    <ul v-if="accounts.length" class="account-list">
      <li v-for="account in accounts" :key="account.userId">
        <div>
          <strong>{{ account.displayName }}</strong>
          <small>
            логин: {{ account.username }}
            {{ account.canCreateCampaigns ? '· может создавать кампании' : '' }}
            {{ account.ownedCampaigns ? `· ведёт кампаний: ${account.ownedCampaigns}` : '' }}
          </small>
        </div>
        <button type="button" @click="openAccountId = account.userId">Разрешения</button>
      </li>
    </ul>
    <p v-else-if="!error" class="muted">Аккаунтов пока нет.</p>

    <AccountPermissionsModal
      v-if="openAccountId"
      :account="accounts.find(a => a.userId === openAccountId)!"
      :owner-id="props.ownerId"
      :request="props.request"
      @changed="onModalChanged"
      @close="openAccountId = ''"
    />
  </div>
</template>

<style scoped>
.account-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px}
.account-list li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border:1px solid var(--brass-light);border-radius:3px;background:var(--surface-inset)}
.account-list button{flex-shrink:0;min-height:34px;padding:4px 14px}
</style>
