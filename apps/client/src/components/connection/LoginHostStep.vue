<script setup lang="ts">
import { t } from '../../i18n/i18n';
import { hostBusy, hostRunning, hostStatus, startHosting } from '../../connection/hostStore';
import type { PlayersWhere } from '../../connection/hostStep';
import type { HelpTab } from '../settings/HelpModal.vue';
import HostErrorNotice from './HostErrorNotice.vue';
import HostPanel from './HostPanel.vue';
import GameIcon from '../game/GameIcon.vue';

defineProps<{
  playersWhere: PlayersWhere | null;
  hostStateText: string;
}>();
defineEmits<{
  choose: [where: PlayersWhere];
  back: [];
  next: [];
  help: [tab: HelpTab];
}>();
</script>

<template>
  <section class="panel wizard" aria-labelledby="host-title-step">
    <h2 id="host-title-step">{{ t('Ваш сервер') }}</h2>
    <p class="lead">{{ t('Игра хранится на этом компьютере: кампании, персонажи, карты. Сервер запускается сам — ничего настраивать не нужно.') }}</p>

    <div class="host-state" :data-state="hostStatus.state">
      <p>
        <span v-if="hostStatus.state === 'starting'" aria-hidden="true"><GameIcon class="inline-icon" name="hourglass" :size="16" /> </span>
        <strong>{{ hostStateText }}</strong>
      </p>
      <HostErrorNotice />
      <button v-if="hostStatus.state === 'error' || hostStatus.state === 'stopped'" type="button" class="primary" :disabled="hostBusy" @click="startHosting">
        {{ t('Запустить сервер') }}
      </button>
    </div>

    <fieldset class="players-where" :disabled="hostBusy">
      <legend>{{ t('Где будут ваши игроки?') }}</legend>
      <label class="choice-card" :data-on="playersWhere === 'solo'">
        <input type="radio" name="players-where" :checked="playersWhere === 'solo'" @change="$emit('choose', 'solo')" />
        <span><strong>{{ t('Пока только я') }}</strong> — {{ t('попробую сам, игроков позову позже.') }}</span>
      </label>
      <label class="choice-card" :data-on="playersWhere === 'lan'">
        <input type="radio" name="players-where" :checked="playersWhere === 'lan'" @change="$emit('choose', 'lan')" />
        <span><strong>{{ t('Дома или в виртуальной сети') }}</strong> — {{ t('у одного роутера или в одной виртуальной локальной сети.') }}</span>
      </label>
      <label class="choice-card" :data-on="playersWhere === 'internet'">
        <input type="radio" name="players-where" :checked="playersWhere === 'internet'" @change="$emit('choose', 'internet')" />
        <span><strong>{{ t('Через интернет, без общей сети') }}</strong> — {{ t('игроки далеко, общей сети с ними нет.') }}</span>
      </label>
      <p v-if="playersWhere === 'lan'" class="muted">
        {{ t('✔ Игроки смогут подключиться по сети. Если Windows спросит про брандмауэр — разрешите доступ.') }}
      </p>
      <p v-else-if="playersWhere === 'internet'" class="muted">
        {{ t('После входа откройте вкладку «Сервер» → «Игроки через интернет» и включите туннель Cloudflare — одной кнопкой.') }}
      </p>
      <p class="muted">{{ t('Пригласить игроков можно после входа: создайте кампанию и нажмите «Пригласить игрока» — приложение подготовит текст приглашения.') }}</p>
    </fieldset>

    <details class="advanced">
      <summary>{{ t('Подробные настройки сервера') }}</summary>
      <HostPanel @help="$emit('help', 'host')" />
    </details>

    <div class="wizard-actions">
      <button type="button" class="quiet" @click="$emit('back')">← {{ t('Назад') }}</button>
      <button type="button" class="primary big" :disabled="!hostRunning" @click="$emit('next')">{{ t('Далее') }} →</button>
    </div>
  </section>
</template>

<style scoped src="./loginKit.css"></style>

<style scoped>
.players-where{border:0;padding:0;margin:14px 0 0}
.players-where legend{font-weight:700;font-size:17px;margin-bottom:4px}
.host-state{padding:12px 14px;border:1px solid var(--brass-light);border-radius:6px;background:var(--surface-inset)}
.host-state[data-state="running"]{border-color:#3f8a4e}
.host-state p{margin:0 0 6px}
.advanced{margin-top:14px}
.advanced summary{font-size:15px;font-weight:600}
</style>
