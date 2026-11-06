<script setup lang="ts">
import { ref } from 'vue';

import { loadCampaignMembers, type CampaignMember } from '../../campaign/campaignPermissions';
import MemberPermissionsCard from './MemberPermissionsCard.vue';

const props = defineProps<{
  campaignId: string;
  ownerId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const members = ref<CampaignMember[]>([]);
const loaded = ref(false);
const error = ref('');

async function refresh() {
  error.value = '';

  try {
    members.value = await loadCampaignMembers(props.request, props.campaignId);
    loaded.value = true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить участников. Попробуйте ещё раз.';
  }
}
</script>

<template>
  <details class="campaign-members" @toggle="($event.target as HTMLDetailsElement).open && refresh()">
    <summary>Участники и права</summary>

    <p class="muted">
      Здесь можно выдать игроку роль полного мастера или отдельные права — например,
      разрешить только вести заметки или настраивать зрение, не отдавая управление всем столом.
    </p>

    <p v-if="error" class="notice error">{{ error }}</p>

    <ul v-if="loaded" class="member-list">
      <li v-for="member in members" :key="member.user_id">
        <p v-if="member.user_id === ownerId" class="muted owner-note">
          {{ member.display_name }} — владелец кампании, обладает всеми правами всегда.
        </p>
        <MemberPermissionsCard
          v-else
          :campaign-id="campaignId"
          :member="member"
          :request="request"
        />
      </li>
    </ul>
    <p v-else-if="!error" class="muted">Загрузка…</p>
  </details>
</template>

<style scoped>
.campaign-members{margin-top:20px;border-top:1px solid var(--brass-light);padding-top:10px}
.member-list{list-style:none;padding:0;margin:12px 0 0;display:flex;flex-direction:column;gap:12px}
.owner-note{padding:10px 14px;border:1px dashed var(--brass-light);border-radius:3px}
</style>
