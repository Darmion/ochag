<script setup lang="ts">
import GameIcon from '../GameIcon.vue';
import { cropStyle } from '../../../art/imageCrop';
import { campaignMonogram, campaignNumber, campaignVariant, type CampaignImages, type LobbyCampaign } from '../../../lobby/campaignCards';
import { useCampaignList } from '../../../lobby/campaignList';

const props = defineProps<{
  campaigns: LobbyCampaign[];
  campaignId: string;
  currentUserId: string;
  canCreateCampaigns: boolean;
  isMaster: boolean;
  busy: boolean;
  serverUrl: string;
  invitationCode: string;
  campaignName: string;
  inviteServerMismatch: string | null;
  imageUrls: CampaignImages;
}>();
const emit = defineEmits<{
  'update:campaignId': [id: string];
  'update:invitationCode': [text: string];
  'update:campaignName': [name: string];
  enter: [id: string];
  create: [];
  join: [];
  switchServer: [];
}>();

const { campaignQuery, roleFilter, masterCount, playerCount, visibleCampaigns } = useCampaignList({ props });
</script>

<template>
  <div class="lobby-list g-frame">
    <header class="lobby-heading">
      <div>
        <p class="eyebrow">Библиотека приключений</p>
        <h2><GameIcon name="castle" :size="24" /> Кампании</h2>
      </div>
      <span class="campaign-total" :title="`Всего кампаний: ${props.campaigns.length}`">{{ props.campaigns.length }}</span>
    </header>

    <div v-if="props.campaigns.length" class="campaign-stats" aria-label="Статистика кампаний">
      <span><GameIcon name="crown" :size="16" /><b>{{ masterCount }}</b> веду</span>
      <span><GameIcon name="helm" :size="16" /><b>{{ playerCount }}</b> играю</span>
    </div>

    <div v-if="props.campaigns.length" class="library-tools">
      <label class="campaign-search">
        <span class="sr-only">Поиск кампании</span>
        <GameIcon name="search" :size="17" />
        <input v-model="campaignQuery" type="search" placeholder="Найти кампанию" autocomplete="off" />
      </label>
      <div class="role-filters" aria-label="Фильтр по роли">
        <button type="button" :aria-pressed="roleFilter === 'all'" @click="roleFilter = 'all'">Все</button>
        <button type="button" :aria-pressed="roleFilter === 'master'" @click="roleFilter = 'master'">Веду</button>
        <button type="button" :aria-pressed="roleFilter === 'player'" @click="roleFilter = 'player'">Играю</button>
      </div>
    </div>

    <ul v-if="visibleCampaigns.length" class="save-slots">
      <li v-for="campaign in visibleCampaigns" :key="campaign.id">
        <button
          type="button"
          class="save-slot"
          :class="`variant-${campaignVariant(campaign)}`"
          :aria-pressed="campaign.id === props.campaignId"
          :title="`${campaign.name} — двойной щелчок: за стол`"
          @click="emit('update:campaignId', campaign.id)"
          @dblclick="emit('enter', campaign.id)"
        >
          <span class="slot-number">Кампания {{ campaignNumber(props.campaigns, campaign) }}</span>
          <span class="slot-emblem" aria-hidden="true">
            <img v-if="imageUrls[campaign.id]?.avatar" :src="imageUrls[campaign.id]?.avatar" alt="" :style="cropStyle(campaign.avatar_crop)" />
            <template v-else>{{ campaignMonogram(campaign) }}</template>
          </span>
          <span class="slot-text">
            <strong>{{ campaign.name }}</strong>
            <small><GameIcon :name="campaign.owner_user_id === props.currentUserId ? 'crown' : 'helm'" :size="13" /> {{ campaign.owner_user_id === props.currentUserId ? 'Мастер' : 'Игрок' }}</small>
          </span>
          <span v-if="campaign.id === props.campaignId" class="current-mark"><GameIcon name="shield" :size="14" /> выбрана</span>
          <GameIcon v-else name="chevronRight" :size="17" class="slot-arrow" />
        </button>
      </li>
    </ul>
    <div v-else-if="props.campaigns.length" class="library-empty">
      <GameIcon name="search" :size="32" />
      <strong>Таких кампаний не найдено</strong>
      <p>Измените запрос или покажите кампании с другой ролью.</p>
      <button type="button" @click="campaignQuery = ''; roleFilter = 'all'">Показать все</button>
    </div>
    <p v-else class="muted empty">
      На этом сервере вы пока не участвуете ни в одной кампании.
      {{ props.canCreateCampaigns ? 'Начните новую или вступите в чужую по приглашению.' : 'Вставьте приглашение мастера ниже.' }}
      Если вы ждали здесь кампании мастера — проверьте вверху, к какому серверу вы подключены.
    </p>

    <details v-if="props.canCreateCampaigns" class="lobby-block">
      <summary><GameIcon name="plus" :size="18" /> Новая кампания</summary>
      <form @submit.prevent="emit('create')">
        <label>
          Название
          <input
            :value="props.campaignName"
            maxlength="200"
            placeholder="Например: Проклятие северных земель"
            :disabled="props.busy"
            required
            @input="emit('update:campaignName', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <button class="primary" :disabled="props.busy || !props.campaignName.trim()">Начать кампанию</button>
      </form>
    </details>

    <details class="lobby-block" :open="!props.campaigns.length && !props.isMaster">
      <summary><GameIcon name="scroll" :size="18" /> Вступить по приглашению</summary>
      <form @submit.prevent="emit('join')">
        <label>
          Приглашение мастера
          <textarea
            :value="props.invitationCode"
            rows="3"
            placeholder="Вставьте текст приглашения целиком"
            autocomplete="off"
            spellcheck="false"
            :disabled="props.busy"
            @input="emit('update:invitationCode', ($event.target as HTMLTextAreaElement).value)"
          />
        </label>
        <div v-if="props.inviteServerMismatch" class="notice warning">
          <p>
            Это приглашение с другого сервера: <code>{{ props.inviteServerMismatch }}</code>.
            Вы сейчас подключены к <code>{{ props.serverUrl }}</code> — здесь его нет.
          </p>
          <button type="button" class="primary" :disabled="props.busy" @click="emit('switchServer')">Перейти на сервер из приглашения</button>
        </div>
        <button v-else class="primary" :disabled="props.busy || !props.invitationCode.trim()">Присоединиться</button>
      </form>
    </details>
  </div>
</template>

<style scoped src="./lobbyKit.css"></style>
