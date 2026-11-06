<script setup lang="ts">
import { useEscapeClose } from '../../ui/escapeStack';
import { onMounted, ref } from 'vue';

import { confirmAction } from '../../ui/confirmDialog';
import { loadCampaignMembers, type CampaignMember } from '../../campaign/campaignPermissions';
import MemberPermissionsCard from '../campaign/MemberPermissionsCard.vue';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{
  account: HostAccount;
  ownerId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{ close: []; changed: [] }>();
useEscapeClose(() => emit('close'));

type CampaignEntry = { campaignId: string; campaignName: string; member: CampaignMember };

const canCreateCampaigns = ref(props.account.canCreateCampaigns);
const serverBusy = ref(false);
const serverError = ref('');

const entries = ref<CampaignEntry[]>([]);
const loading = ref(true);
const loadError = ref('');

async function toggleServerRight(value: boolean) {
  if (!window.desktop) return;
  serverBusy.value = true;
  serverError.value = '';

  try {
    await window.desktop.host.setCanCreateCampaigns(props.account.userId, value);
    canCreateCampaigns.value = value;
    emit('changed');
  } catch (cause) {
    serverError.value = cause instanceof Error ? cause.message : 'Не удалось изменить право. Попробуйте ещё раз.';
  } finally {
    serverBusy.value = false;
  }
}

async function changeServerRight(event: Event) {
  const input = event.target as HTMLInputElement;
  const value = input.checked;
  const confirmed = await confirmAction(
    value
      ? `${props.account.displayName} сможет создавать собственные кампании на этом сервере и станет владельцем данных в них.`
      : `${props.account.displayName} больше не сможет создавать кампании. Уже созданные кампании и права в них сохранятся.`,
    { title: value ? 'Разрешить создание кампаний?' : 'Отозвать право?', confirmLabel: value ? 'Разрешить' : 'Отозвать', danger: value },
  );
  if (!confirmed) {
    input.checked = canCreateCampaigns.value;
    return;
  }
  await toggleServerRight(value);
}

async function load() {
  loading.value = true;
  loadError.value = '';

  try {
    const campaigns = (await props.request('/campaigns')).campaigns as Array<{ id: string; name: string; owner_user_id: string }>;
    const owned = campaigns.filter(campaign => campaign.owner_user_id === props.ownerId);

    const found = await Promise.all(owned.map(async campaign => {
      const members = await loadCampaignMembers(props.request, campaign.id);
      const member = members.find(m => m.user_id === props.account.userId);
      return member ? { campaignId: campaign.id, campaignName: campaign.name, member } : null;
    }));

    entries.value = found.filter((entry): entry is CampaignEntry => entry !== null);
  } catch (cause) {
    loadError.value = cause instanceof Error ? cause.message : 'Не удалось загрузить кампании. Проверьте, что сервер запущен, и откройте окно снова.';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="permissions-title" @click.self="emit('close')">
    <div class="modal-card">
      <header class="modal-header">
        <h3 id="permissions-title">Разрешения — {{ account.displayName }}</h3>
        <button type="button" class="modal-close" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>

      <p class="muted">Логин: {{ account.username }}</p>

      <section class="modal-section">
        <h4>На этом сервере</h4>
        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="canCreateCampaigns"
            :disabled="serverBusy"
            @change="changeServerRight"
          />
          Может создавать кампании
        </label>
        <p v-if="serverError" class="notice error">{{ serverError }}</p>
      </section>

      <section class="modal-section">
        <h4>В ваших кампаниях</h4>
        <p class="muted">
          Права внутри кампании назначает её владелец. Здесь показаны только кампании,
          которые ведёте вы сами, — не все кампании на сервере.
        </p>

        <p v-if="loadError" class="notice error">{{ loadError }}</p>
        <p v-else-if="loading" class="muted">Загрузка…</p>
        <p v-else-if="!entries.length" class="muted">
          Этот аккаунт не состоит ни в одной из ваших кампаний.
        </p>

        <div v-else class="entry-list">
          <MemberPermissionsCard
            v-for="entry in entries"
            :key="entry.campaignId"
            :campaign-id="entry.campaignId"
            :campaign-name="entry.campaignName"
            :member="entry.member"
            :request="request"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay{position:fixed;inset:0;z-index:3000;background:#000a;display:flex;align-items:center;justify-content:center;padding:20px}
.modal-card{width:min(620px,100%);max-height:90vh;overflow-y:auto;padding:24px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 16px 40px #0008}
.modal-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}
.modal-header h3{margin:0}
.modal-close{min-height:32px;width:32px;padding:0}
.modal-section{margin-top:16px;padding-top:12px;border-top:1px solid var(--brass-light)}
.modal-section h4{margin:0 0 8px;font-size:17px}
.modal-section .muted{font-size:14px}
.entry-list{display:flex;flex-direction:column;gap:12px;margin-top:10px}
</style>
