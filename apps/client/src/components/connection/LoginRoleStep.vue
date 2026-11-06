<script setup lang="ts">
import { t } from '../../i18n/i18n';
import type { HelpTab } from '../settings/HelpModal.vue';
import GameIcon from '../game/GameIcon.vue';

defineProps<{
  hasSaved: boolean;
}>();
defineEmits<{
  choose: [master: boolean];
  help: [tab: HelpTab];
  saved: [];
}>();
</script>

<template>
  <section class="panel wizard" aria-labelledby="role-title">
    <h2 id="role-title">{{ t('Кто вы в этой игре?') }}</h2>
    <p class="lead">{{ t('Игра идёт на компьютере мастера. Игроки подключаются к нему.') }}</p>
    <div class="role-cards">
      <button type="button" class="role-card" data-autofocus @click="$emit('choose', false)">
        <span class="role-icon" aria-hidden="true"><GameIcon name="rolePlayer" :size="34" /></span>
        <strong>{{ t('Я игрок') }}</strong>
        <span>{{ t('Мастер прислал мне приглашение, или я знаю адрес его сервера.') }}</span>
      </button>
      <button type="button" class="role-card" @click="$emit('choose', true)">
        <span class="role-icon" aria-hidden="true"><GameIcon name="roleMaster" :size="34" /></span>
        <strong>{{ t('Я мастер') }}</strong>
        <span>{{ t('Я веду игру: кампании и карты будут храниться на этом компьютере.') }}</span>
      </button>
    </div>
    <p class="muted">
      {{ t('Не уверены? Если вас позвали поиграть — вы игрок.') }}
      <button type="button" class="link-button" @click="$emit('help', 'how')">{{ t('Как это устроено') }}</button>
    </p>
    <div v-if="hasSaved" class="wizard-actions">
      <button type="button" class="quiet" @click="$emit('saved')">← {{ t('Сохранённые входы') }}</button>
    </div>
  </section>
</template>

<style scoped src="./loginKit.css"></style>

<style scoped>
.role-cards{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:6px 0 12px}
.role-card{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:18px;text-align:left;min-height:150px}
.role-card strong{font-family:var(--heading-font);font-size:22px}
.role-card span{font-weight:400;font-size:14px;line-height:1.4}
.role-icon{display:grid;place-items:center;width:56px;height:56px;border-radius:50%;color:var(--g-gold-hi,var(--brass));background:radial-gradient(circle at 50% 35%,color-mix(in srgb,var(--g-gold,#b08d57) 22%,transparent),transparent 70%);box-shadow:inset 0 0 0 1px var(--g-gold-lo,#6b5233),0 0 0 2px color-mix(in srgb,var(--g-gold,#b08d57) 55%,transparent)}
.role-card:hover .role-icon{color:var(--g-text,inherit)}
@media(max-width:600px){.role-cards{grid-template-columns:1fr}}
</style>
