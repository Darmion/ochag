<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

import { branding } from '../../ui/branding';
import { t, tr } from '../../i18n/i18n';
import BrandLogo from '../common/BrandLogo.vue';
import GameIcon from './GameIcon.vue';
import type { GameIconName } from '../../ui/gameIcons';

export type GameTab = 'book' | 'table' | 'characters' | 'rules' | 'look' | 'server';

const props = defineProps<{
  loggedIn: boolean;
  activeTab: GameTab;
  campaigns: Array<{ id: string; name: string }>;
  campaignId: string;
  serverTabLabel: string;
  version: string | null;
  updateAvailable: boolean;
  atTable?: boolean;
}>();

const emit = defineEmits<{
  tab: [tab: GameTab];
  campaign: [id: string];
  help: [];
  credits: [];
  hotkeys: [];
  updates: [];
  options: [];
  mods: [];
}>();

const helpOpen = ref(false);
const helpRoot = ref<HTMLElement | null>(null);
function onHelpOutside(event: PointerEvent) {
  if (helpRoot.value && !helpRoot.value.contains(event.target as Node)) helpOpen.value = false;
}
function onHelpEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !helpOpen.value) return;
  helpOpen.value = false;
  event.preventDefault();
}
watch(helpOpen, value => {
  if (value) {
    document.addEventListener('pointerdown', onHelpOutside);
    window.addEventListener('keydown', onHelpEscape);
  } else {
    document.removeEventListener('pointerdown', onHelpOutside);
    window.removeEventListener('keydown', onHelpEscape);
  }
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onHelpOutside);
  window.removeEventListener('keydown', onHelpEscape);
});
function helpPick(action: 'help' | 'hotkeys' | 'updates' | 'credits') {
  helpOpen.value = false;
  if (action === 'help') emit('help');
  else if (action === 'credits') emit('credits');
  else if (action === 'hotkeys') emit('hotkeys');
  else emit('updates');
}
function reportBug() {
  helpOpen.value = false;
  window.open(branding.issuesUrl, '_blank', 'noopener');
}

const TABS: Array<{ id: GameTab; label: string; icon: GameIconName; needsCampaign: boolean }> = [
  { id: 'book', label: tr('Кампании'), icon: 'castle', needsCampaign: false },
  { id: 'table', label: tr('Стол'), icon: 'map', needsCampaign: true },
  { id: 'characters', label: tr('Отряд'), icon: 'group', needsCampaign: true },
  { id: 'rules', label: tr('Правила'), icon: 'tome', needsCampaign: true },
  { id: 'look', label: tr('Облик'), icon: 'palette', needsCampaign: false },
  { id: 'server', label: '', icon: 'tower', needsCampaign: false },
];

</script>

<template>
  <header class="game-topbar">
    <div class="topbar-brand">
      <BrandLogo variant="monochrome" class="brand-symbol" />
      <strong class="brand-name" aria-hidden="true">{{ branding.appName }}</strong>
    </div>

    <nav v-if="props.loggedIn" class="topbar-tabs" :aria-label="t('Разделы')">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        class="topbar-tab"
        :title="tab.label ? t(tab.label) : props.serverTabLabel"
        :aria-label="tab.label ? t(tab.label) : props.serverTabLabel"
        :aria-pressed="props.activeTab === tab.id"
        :disabled="tab.needsCampaign && !props.campaignId"
        @click="emit('tab', tab.id)"
      >
        <GameIcon :name="tab.icon" :size="18" />
        <span>{{ tab.label ? t(tab.label) : props.serverTabLabel }}</span>
      </button>
    </nav>

    <label v-if="props.loggedIn && props.campaigns.length && props.activeTab !== 'book' && props.activeTab !== 'server'" class="topbar-campaign">
      <span class="visually-hidden">{{ t('Кампания') }}</span>
      <GameIcon name="castle" :size="16" />
      <select :value="props.campaignId" :aria-label="t('Кампания')" :title="props.campaigns.find(campaign => campaign.id === props.campaignId)?.name" @change="emit('campaign', ($event.target as HTMLSelectElement).value)">
        <option v-for="campaign in props.campaigns" :key="campaign.id" :value="campaign.id">{{ campaign.name }}</option>
      </select>
    </label>

    <div class="topbar-right">
      <slot name="status" />
      <button
        v-if="props.version"
        type="button"
        class="topbar-version"
        :class="{ 'has-update': props.updateAvailable }"
        :title="props.updateAvailable ? t('Есть обновление') : t('Версия {version} ({edition}) — обновления', { version: props.version, edition: t(branding.edition) })"
        @click="emit('updates')"
      >
        v{{ props.version }}<template v-if="props.updateAvailable"> · {{ t('обновить') }}</template><small v-else class="topbar-edition">{{ branding.edition }}</small>
      </button>
      <div ref="helpRoot" class="topbar-help">
        <button type="button" class="g-gem small" :title="t('Помощь: справка, горячие клавиши, что нового')" :aria-label="t('Помощь')" :aria-expanded="helpOpen" @click="helpOpen = !helpOpen">
          <GameIcon name="question" :size="18" />
        </button>
        <div v-if="helpOpen" class="topbar-help-menu g-frame" role="menu" :aria-label="t('Помощь')">
          <button type="button" role="menuitem" @click="helpPick('help')"><GameIcon name="question" :size="16" />{{ t('Справка: подключение и игра') }}</button>
          <button v-if="props.atTable" type="button" role="menuitem" @click="helpPick('hotkeys')"><GameIcon name="keyboard" :size="16" />{{ t('Горячие клавиши и мышь') }} <small>?</small></button>
          <button v-if="props.version" type="button" role="menuitem" @click="helpPick('updates')"><GameIcon name="sparkle" :size="16" />{{ t('Версия {version}: что нового, обновления', { version: props.version }) }}</button>
          <button type="button" role="menuitem" @click="helpPick('credits')"><GameIcon name="question" :size="16" />{{ t('Авторы и благодарности') }}</button>
          <button type="button" role="menuitem" :title="t('Откроет страницу ошибок проекта на GitHub в браузере')" @click="reportBug"><GameIcon name="quill" :size="16" />{{ t('Сообщить об ошибке') }}</button>
        </div>
      </div>
      <button type="button" class="g-gem small" :title="t('Моды: механика, картинки, оформление')" :aria-label="t('Моды')" @click="emit('mods')">
        <GameIcon name="puzzle" :size="18" />
      </button>
      <button type="button" class="g-gem small" :title="t('Настройки')" :aria-label="t('Настройки')" @click="emit('options')">
        <GameIcon name="gear" :size="18" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.topbar-help{position:relative}
.topbar-help-menu{position:absolute;right:0;top:calc(100% + 10px);z-index:2;display:flex;flex-direction:column;gap:2px;min-width:280px;padding:6px}
.topbar-help-menu button{display:flex;align-items:center;gap:8px;justify-content:flex-start;min-height:32px;padding:4px 10px;text-align:left;white-space:nowrap}
.topbar-help-menu small{margin-left:auto;opacity:.7}
.game-topbar{position:fixed;top:0;left:0;right:0;z-index:2500;height:var(--game-top,56px);display:flex;align-items:center;gap:14px;padding:0 14px 0 10px;background:var(--g-noise),linear-gradient(180deg,var(--g-stone-1),var(--g-stone-3));box-shadow:inset 0 -1px 0 #000,inset 0 -2px 0 var(--g-gold-lo),inset 0 -3px 0 var(--g-gold-hi),inset 0 -4px 0 #000,0 6px 16px #000c}
.topbar-brand{display:flex;align-items:center;gap:8px;flex-shrink:0}
.brand-symbol{width:40px;height:40px}
.brand-name{font:400 24px var(--g-display-font);color:var(--g-gold-hi);letter-spacing:.06em}
.topbar-tabs{display:flex;align-items:center;gap:6px;margin-left:10px}
.topbar-tab{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:4px 14px;font-size:14px;border-radius:5px}
.topbar-tab:disabled{opacity:.4}
/* Shrinks first but not below 90px, otherwise Help and Settings slid off the right edge at 160 %. */
.topbar-campaign{display:flex;align-items:center;gap:6px;margin:0;color:var(--g-gold);flex:0 10 auto;min-width:90px}
.topbar-campaign select{width:100%;min-width:0;max-width:260px;min-height:34px;padding:3px 8px}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.topbar-right{display:flex;align-items:center;gap:10px;margin-left:auto;min-width:0;flex:0 1 auto}
.topbar-right > *{flex-shrink:0}
.topbar-right > :deep(:first-child){flex-shrink:1;min-width:0}
.topbar-version{min-height:32px;padding:3px 10px;font-size:13px;white-space:nowrap}
.topbar-edition{display:inline;margin:0 0 0 6px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--g-gold)}
.topbar-version.has-update{color:#fff2cf;background:linear-gradient(180deg,#ffffff22,#0000 50%),linear-gradient(180deg,var(--g-accent-hi),var(--g-accent));animation:pulse 2.4s ease-in-out infinite}
@keyframes pulse{50%{box-shadow:0 0 0 1px var(--g-gold),0 0 14px var(--g-glow)}}
.g-gem.small{width:36px;height:36px}
.topbar-right :deep(.badge-button){min-height:36px;max-width:min(240px,100%);min-width:0;padding:3px 10px}
.topbar-right :deep(.badge-text){font-size:12px;line-height:1.2;white-space:nowrap;overflow:hidden}
.topbar-right :deep(.badge-text small){display:none}
/* Thresholds use the top bar's own width (@container): under UI zoom @media does not see the narrower layout. */
.game-topbar{container-type:inline-size;container-name:topbar}
@container topbar (max-width:1400px){.topbar-tab span{display:none}.topbar-tab{padding:4px 10px}}
@container topbar (max-width:1100px){.brand-name{display:none}}
@container topbar (min-width:1101px){.topbar-campaign{min-width:182px}}
@media(max-width:1100px){.game-topbar{gap:8px}}
</style>
