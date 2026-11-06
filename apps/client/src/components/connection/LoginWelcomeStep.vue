<script setup lang="ts">
import { t } from '../../i18n/i18n';

defineProps<{
  savedEntries: SavedLogin[];
  serverLabel: (entry: SavedLogin) => string;
  busy: boolean;
  error: string;
}>();
defineEmits<{
  login: [entry: SavedLogin];
  forget: [entry: SavedLogin];
  other: [];
}>();
</script>

<template>
  <section class="panel wizard" aria-labelledby="welcome-title">
    <h2 id="welcome-title">{{ t('С возвращением!') }}</h2>
    <p class="lead">{{ t('Нажмите «Войти» — приложение подключится само.') }}</p>
    <ul class="saved-logins">
      <li v-for="entry in savedEntries" :key="entry.id">
        <div>
          <strong>{{ entry.username }}</strong>
          <small>{{ serverLabel(entry) }}</small>
        </div>
        <button type="button" class="primary big" :disabled="busy" @click="$emit('login', entry)">{{ t('Войти') }}</button>
        <button type="button" class="quiet" :disabled="busy" :aria-label="t('Забыть вход {login}', { login: entry.username })" :title="t('Забыть вход {login}', { login: entry.username })" @click="$emit('forget', entry)">{{ t('Забыть') }}</button>
      </li>
    </ul>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <div class="wizard-actions">
      <button type="button" @click="$emit('other')">{{ t('Другой аккаунт или первый вход') }}</button>
    </div>
  </section>
</template>

<style scoped src="./loginKit.css"></style>

<style scoped>
.saved-logins{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px}
.saved-logins li{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--brass-light);border-radius:6px;background:var(--surface-inset)}
.saved-logins li div{flex:1;min-width:0;display:flex;flex-direction:column}
.saved-logins li strong{font-size:17px}
</style>
