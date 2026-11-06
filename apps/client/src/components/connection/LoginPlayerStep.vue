<script setup lang="ts">
import { t } from '../../i18n/i18n';
import { cloudflareTest, cloudflareTesting, describeCloudflareTest, testCloudflare } from '../../connection/hostStore';
import type { ServerCheck } from '../../connection/serverProbe';
import { compareVersions, updateState } from '../../connection/updateStore';
import type { HelpTab } from '../settings/HelpModal.vue';
import GameIcon from '../game/GameIcon.vue';

defineProps<{
  serverCheck: ServerCheck;
  busy: boolean;
}>();
defineEmits<{
  back: [];
  next: [];
  help: [tab: HelpTab];
}>();
</script>

<template>
  <section class="panel wizard" aria-labelledby="connect-title">
    <h2 id="connect-title">{{ t('Подключение к мастеру') }}</h2>
    <p class="lead">{{ t('Мастер присылает приглашение — несколько строк с адресом сервера и кодом. Скопируйте его целиком и вставьте сюда.') }}</p>

    <div class="invite-box">
      <textarea
        v-model="serverCheck.inviteText"
        rows="6"
        spellcheck="false"
        data-autofocus
        :aria-label="t('Приглашение от мастера')"
        :placeholder="t('Приглашение в «Очаг» — кампания «…»\nАдрес сервера: https://…\nКод приглашения: …')"
        :disabled="busy"
      />
      <button type="button" :disabled="busy" @click="serverCheck.pasteInvite"><GameIcon class="inline-icon" name="clipboard" :size="16" /> {{ t('Вставить из буфера обмена') }}</button>
    </div>
    <p v-if="serverCheck.pasteError" class="muted">{{ serverCheck.pasteError }}</p>
    <p v-if="serverCheck.invite.code" class="notice success">
      {{ serverCheck.invite.campaign
        ? t('✔ Приглашение в кампанию «{campaign}». После входа вы сразу в неё попадёте.', { campaign: serverCheck.invite.campaign })
        : t('✔ Код приглашения найден: после входа вы автоматически присоединитесь к кампании.') }}
    </p>

    <button v-if="!serverCheck.showAddress && !serverCheck.invite.address" type="button" class="link-button" @click="serverCheck.manualAddress = true">{{ t('Приглашения нет — ввести адрес сервера вручную') }}</button>
    <label v-if="serverCheck.showAddress">
      {{ t('Адрес сервера мастера') }}
      <input v-model="serverCheck.serverAddress" :placeholder="t('например, 26.34.12.5:3000')" spellcheck="false" :disabled="busy" />
      <small>
        {{ t('Мастер видит его у себя во вкладке «Сервер» → «Куда подключаться игрокам». Можно без http:// — порт 3000 подставится сам.') }}
        {{ t('Адрес в интернете (туннель Cloudflare, свой домен) — как есть, например abc-def.trycloudflare.com.') }}
      </small>
    </label>

    <div class="probe" aria-live="polite">
      <p v-if="serverCheck.probing" class="muted"><GameIcon class="inline-icon" name="hourglass" :size="16" /> {{ t('Ищу сервер мастера…') }}</p>

      <template v-else-if="serverCheck.probe">
        <div v-if="serverCheck.probe.ok && !serverCheck.probe.thisComputer" class="notice success">
          <p><strong>{{ t('✔ Сервер мастера найден') }}</strong> — {{ serverCheck.serverName }}. <small class="muted"><code>{{ serverCheck.probe.origin }}</code></small></p>
          <p v-if="serverCheck.probe.appVersion && updateState && compareVersions(serverCheck.probe.appVersion, updateState.currentVersion) !== 0" class="muted">
            {{ t('Версия у мастера {theirs}, у вас {mine} — после входа приложение предложит {what}.', {
              theirs: serverCheck.probe.appVersion, mine: updateState.currentVersion,
              what: compareVersions(serverCheck.probe.appVersion, updateState.currentVersion) > 0 ? t('обновиться у мастера') : t('попросить мастера обновиться'),
            }) }}
          </p>
        </div>

        <div v-else-if="serverCheck.probe.ok && serverCheck.ownServerWarning" class="notice warning">
          <p>
            {{ t('⚠ Этот адрес ведёт на ваш собственный компьютер{host}, а не к мастеру. Кампаний, созданных у мастера, здесь не будет: у каждого сервера свои аккаунты и кампании.', { host: serverCheck.probe.hostName ? ` («${serverCheck.probe.hostName}»)` : '' }) }}
          </p>
          <p>{{ t('Узнайте адрес у мастера (у него: вкладка «Сервер» → «Куда подключаться игрокам») или вставьте его приглашение.') }}</p>
          <button type="button" @click="serverCheck.allowOwnServer = true">{{ t('Всё равно подключиться к своему серверу') }}</button>
        </div>

        <div v-else-if="serverCheck.probe.ok" class="notice success">{{ t('✔ Подключение к серверу на этом компьютере.') }}</div>

        <div
          v-else-if="serverCheck.probe.error.fingerprint"
          class="notice certificate"
          :class="serverCheck.probe.error.code === 'certificate-changed' || serverCheck.inviteCertificateMismatch ? 'error' : 'warning'"
        >
          <template v-if="serverCheck.trusting">
            <p><GameIcon class="inline-icon" name="hourglass" :size="16" /> {{ t('Проверяю защиту подключения…') }}</p>
          </template>
          <template v-else>
            <p v-if="serverCheck.probe.error.code === 'certificate-changed'">⚠ {{ serverCheck.probe.error.message }}</p>
            <p v-else><strong>{{ t('Подтвердите, что это сервер вашего мастера.') }}</strong></p>
            <p>{{ t('Спросите у мастера код сертификата (у него: вкладка «Сервер»). Он должен совпасть с этим:') }}</p>
            <p class="big-code"><strong class="certificate-code">{{ serverCheck.probe.error.certificateCode }}</strong></p>
            <p v-if="serverCheck.inviteCertificateMismatch">
              {{ t('✖ В приглашении другой код ({code}). Не подключайтесь — уточните у мастера.', { code: serverCheck.invite.certificate ?? '' }) }}
            </p>
            <button type="button" class="primary" :disabled="serverCheck.trusting || serverCheck.inviteCertificateMismatch" @click="serverCheck.trustCertificate">
              {{ t('Коды совпадают — подключиться') }}
            </button>
            <p v-if="serverCheck.trustError" role="alert">✖ {{ serverCheck.trustError }}</p>
            <details>
              <summary>{{ t('Зачем это?') }}</summary>
              <p class="muted">{{ t('Подключение к мастеру зашифровано. Код подтверждает, что вы подключаетесь именно к нему, а не к чужому компьютеру. Сверить нужно один раз.') }}</p>
              <code class="fingerprint">{{ serverCheck.probe.error.fingerprint }}</code>
            </details>
          </template>
        </div>

        <div v-else class="notice error">
          <p>✖ {{ serverCheck.probe.error.message }}</p>
          <p v-if="serverCheck.probe.error.hints.length" class="muted">{{ t('Что проверить:') }}</p>
          <ul v-if="serverCheck.probe.error.hints.length">
            <li v-for="hint in serverCheck.probe.error.hints" :key="hint">{{ hint }}</li>
          </ul>
          <div class="inline-actions">
            <button type="button" @click="serverCheck.runProbe">{{ t('Проверить ещё раз') }}</button>
            <button type="button" class="link-button" @click="$emit('help', 'trouble')">{{ t('Что ещё проверить') }}</button>
          </div>
        </div>
      </template>

      <p v-else-if="!serverCheck.targetAddress" class="muted">{{ t('Как только вы вставите приглашение, приложение само найдёт сервер мастера.') }}</p>

      <div v-if="serverCheck.internetTarget && (!serverCheck.probe || !serverCheck.probe.ok)" class="cf-test">
        <button type="button" class="link-button" :disabled="cloudflareTesting" @click="testCloudflare">
          {{ cloudflareTesting ? t('Проверяю Cloudflare…') : t('Проверить, пропускает ли провайдер Cloudflare') }}
        </button>
        <p v-if="cloudflareTest" class="muted">{{ describeCloudflareTest(cloudflareTest) }}</p>
      </div>
    </div>

    <div class="wizard-actions">
      <button type="button" class="quiet" @click="$emit('back')">← {{ t('Назад') }}</button>
      <button type="button" class="primary big" :disabled="!serverCheck.playerReady" @click="$emit('next')">{{ t('Далее') }} →</button>
    </div>
  </section>
</template>

<style scoped src="./loginKit.css"></style>

<style scoped>
.invite-box{display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.invite-box textarea{width:100%;font-family:Consolas,monospace;font-size:13px}
.probe{margin-top:14px;display:flex;flex-direction:column;align-items:flex-start;gap:10px}
.probe .notice{width:100%}
.probe .notice p{margin:0 0 6px}
.probe .notice ul{margin:4px 0 8px;padding-left:20px}
.big-code{font-size:1.4em}
.certificate-code{font-family:ui-monospace,Consolas,monospace;letter-spacing:.08em}
.fingerprint{display:block;word-break:break-all;font-size:12px;margin-top:4px}
.inline-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
</style>
