<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue';

import CampaignMembersPanel from '../campaign/CampaignMembersPanel.vue';
import CampaignTransfer from '../campaign/CampaignTransfer.vue';
import InvitePanel from '../connection/InvitePanel.vue';
import GameIcon from './GameIcon.vue';
import LobbyCampaignList from './lobby/LobbyCampaignList.vue';
import LobbyAppearance from './lobby/LobbyAppearance.vue';
import LobbyOverview from './lobby/LobbyOverview.vue';
import { cropStyle } from '../../art/imageCrop';
import { campaignMonogram, campaignNumber, campaignVariant, type LobbyCampaign } from '../../lobby/campaignCards';
import { useCampaignImages } from '../../lobby/campaignImages';
import { useCampaignOverview } from '../../lobby/campaignOverview';
import { useCampaignAppearance } from '../../lobby/campaignAppearance';

const props = defineProps<{
  campaigns: LobbyCampaign[];
  campaignId: string;
  currentUserId: string;
  canCreateCampaigns: boolean;
  isMaster: boolean;
  busy: boolean;
  serverUrl: string;
  token: string;
  invitationCode: string;
  campaignName: string;
  inviteServerMismatch: string | null;
  request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any>;
  canImport?: boolean;
}>();

const emit = defineEmits<{
  'update:campaignId': [id: string];
  'update:invitationCode': [text: string];
  'update:campaignName': [name: string];
  create: [];
  join: [];
  switchServer: [];
  open: [tab: 'table' | 'characters' | 'rules'];
  importCharacter: [];
  imported: [report: CampaignImportReport];
  appearanceChanged: [campaignId: string];
}>();

const selected = computed(() => props.campaigns.find(campaign => campaign.id === props.campaignId) ?? null);
const isOwner = computed(() => selected.value?.owner_user_id === props.currentUserId);
const { imageUrls, disposeImages } = useCampaignImages({ props });
const { overview, overviewLoading, overviewError, cancelOverviewLoad } = useCampaignOverview({ props, selected });
const {
  appearanceBusy, appearanceError, cropping, uploadAppearance, openCrop, closeCrop, saveCrop, removeAppearance,
} = useCampaignAppearance({ props, emit, selected, imageUrls });

function enter(id: string) {
  emit('update:campaignId', id);
  emit('open', 'table');
}

onBeforeUnmount(() => {
  closeCrop();
  disposeImages();
  cancelOverviewLoad();
});
</script>

<template>
  <section class="game-lobby" aria-label="Кампании">
    <LobbyCampaignList
      :campaigns="props.campaigns" :campaign-id="props.campaignId" :current-user-id="props.currentUserId"
      :can-create-campaigns="props.canCreateCampaigns" :is-master="props.isMaster" :busy="props.busy" :server-url="props.serverUrl"
      :invitation-code="props.invitationCode" :campaign-name="props.campaignName" :invite-server-mismatch="props.inviteServerMismatch"
      :image-urls="imageUrls"
      @update:campaign-id="id => emit('update:campaignId', id)" @enter="enter"
      @update:invitation-code="text => emit('update:invitationCode', text)" @update:campaign-name="name => emit('update:campaignName', name)"
      @create="emit('create')" @join="emit('join')" @switch-server="emit('switchServer')"
    />

    <div v-if="selected" class="lobby-detail g-frame">
      <header class="campaign-hero" :class="`variant-${campaignVariant(selected)}`">
        <img v-if="imageUrls[selected.id]?.banner" class="hero-banner-image" :src="imageUrls[selected.id]?.banner" alt="" :style="cropStyle(selected.banner_crop)" />
        <span class="hero-emblem" aria-hidden="true">
          <img v-if="imageUrls[selected.id]?.avatar" :src="imageUrls[selected.id]?.avatar" alt="" :style="cropStyle(selected.avatar_crop)" />
          <template v-else>{{ campaignMonogram(selected) }}</template>
        </span>
        <div class="hero-copy">
          <p class="eyebrow">Кампания {{ campaignNumber(props.campaigns, selected) }} · {{ isOwner ? 'вы ведёте' : 'вы играете' }}</p>
          <h2 class="campaign-title">{{ selected.name }}</h2>
          <span class="role-badge"><GameIcon :name="isOwner ? 'crown' : 'helm'" :size="15" /> {{ isOwner ? 'Вы ведёте эту кампанию' : 'Вы участвуете как игрок' }}</span>
        </div>
      </header>

      <div class="lobby-actions">
        <button type="button" class="primary action-card table-action" @click="emit('open', 'table')">
          <GameIcon name="map" :size="25" /><span><strong>За стол</strong><small>Продолжить приключение</small></span><GameIcon name="chevronRight" :size="18" />
        </button>
        <button type="button" class="action-card" @click="emit('open', 'characters')">
          <GameIcon name="group" :size="23" /><span><strong>Отряд и объекты</strong><small>Герои, НПС и имущество</small></span>
        </button>
        <button type="button" class="action-card" @click="emit('open', 'rules')">
          <GameIcon name="tome" :size="23" /><span><strong>Правила</strong><small>Правила этой кампании</small></span>
        </button>
        <button v-if="props.canImport" type="button" class="action-card" @click="emit('importCharacter')">
          <GameIcon name="upload" :size="23" /><span><strong>Импорт персонажа</strong><small>Добавить героя из файла</small></span>
        </button>
      </div>

      <LobbyAppearance
        v-if="isOwner" :selected="selected" :image-urls="imageUrls" :appearance-busy="appearanceBusy" :appearance-error="appearanceError"
        :cropping="cropping" @upload="uploadAppearance" @open-crop="openCrop" @save-crop="saveCrop" @close-crop="closeCrop" @remove="removeAppearance"
      />

      <LobbyOverview :overview="overview" :overview-loading="overviewLoading" :overview-error="overviewError" />

      <div class="management-heading">
        <span><GameIcon name="gear" :size="18" /></span>
        <div><strong>{{ isOwner ? 'Управление кампанией' : 'Материалы кампании' }}</strong><small>{{ isOwner ? 'Приглашения, участники и перенос между серверами' : 'Доступные действия и перенос кампании' }}</small></div>
      </div>

      <InvitePanel
        v-if="isOwner"
        :campaign-id="selected.id"
        :campaign-name="selected.name"
        :server-url="props.serverUrl"
        :request="props.request"
      />
      <CampaignMembersPanel
        v-if="isOwner"
        :campaign-id="selected.id"
        :owner-id="props.currentUserId"
        :request="props.request"
      />
      <CampaignTransfer
        :campaign-id="selected.id"
        :campaign-name="selected.name"
        :is-owner="isOwner"
        :can-import="props.canCreateCampaigns"
        :token="props.token"
        @imported="emit('imported', $event)"
      />
    </div>
    <div v-else class="lobby-detail g-frame lobby-empty">
      <GameIcon name="castle" :size="64" />
      <p class="muted">Выберите кампанию слева — или начните новую.</p>
      <CampaignTransfer
        campaign-id=""
        campaign-name=""
        :is-owner="false"
        :can-import="props.canCreateCampaigns"
        :token="props.token"
        @imported="emit('imported', $event)"
      />
    </div>
  </section>
</template>

<style scoped src="./lobby/lobbyKit.css"></style>
