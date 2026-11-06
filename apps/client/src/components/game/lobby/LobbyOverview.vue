<script setup lang="ts">
import GameIcon from '../GameIcon.vue';
import { worldTime, type CampaignOverview } from '../../../lobby/campaignCards';

defineProps<{ overview: CampaignOverview | null; overviewLoading: boolean; overviewError: string }>();
</script>

<template>
  <section class="campaign-overview" aria-labelledby="campaign-overview-title">
    <header>
      <div>
        <p class="eyebrow">Сводка кампании</p>
        <h3 id="campaign-overview-title">В этой кампании</h3>
      </div>
      <span v-if="overview" class="world-time"><GameIcon name="hourglass" :size="16" /> {{ worldTime(overview.worldMinutes) }}</span>
    </header>
    <div v-if="overview" class="overview-grid">
      <article><GameIcon name="group" :size="22" /><strong>{{ overview.members }}</strong><span>участников</span></article>
      <article><GameIcon name="shield" :size="22" /><strong>{{ overview.heroes }}</strong><span>героев</span></article>
      <article><GameIcon name="map" :size="22" /><strong>{{ overview.scenes }}</strong><span>сцен</span></article>
      <article><GameIcon name="scroll" :size="22" /><strong>{{ overview.activeQuests }}</strong><span>активных заданий</span></article>
    </div>
    <div v-if="overview" class="overview-details">
      <span><b>{{ overview.npcs }}</b> NPC</span>
      <span><b>{{ overview.objects }}</b> объектов</span>
      <span><b>{{ overview.rules }}</b> правил кампании</span>
    </div>
    <div v-else-if="overviewLoading" class="overview-state">Собираю сведения о кампании…</div>
    <div v-else class="overview-state overview-error">{{ overviewError || 'Сводка не загрузилась. Выберите кампанию ещё раз.' }}</div>
  </section>
</template>

<style scoped src="./lobbyKit.css"></style>
