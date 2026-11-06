<script setup lang="ts">
import { t } from '../../i18n/i18n';
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { ApiError, errorHints, isLoopbackAddress, sameOrigin } from '../../connection/connection';
import {
  desktopMode,
  hostAutoStart,
  hostingEnabled,
  hostRunning,
  hostStatus,
  refreshHostStatus,
  startHosting,
} from '../../connection/hostStore';
import { useHostStep } from '../../connection/hostStep';
import { useLoginAccounts } from '../../connection/loginAccounts';
import { useServerProbe } from '../../connection/serverProbe';
import type { HelpTab } from '../settings/HelpModal.vue';
import LoginHostStep from './LoginHostStep.vue';
import LoginPlayerStep from './LoginPlayerStep.vue';
import LoginRoleStep from './LoginRoleStep.vue';
import LoginWelcomeStep from './LoginWelcomeStep.vue';
import VcRuntimeButton from './VcRuntimeButton.vue';
import GameIcon from '../game/GameIcon.vue';

export type Authenticated = {
  token: string;
  user: { id: string; username: string; displayName: string };
  serverUrl: string;
  server: ServerProbe | null;
  savedLoginId: string | null;
  inviteCode: string | null;
  joinedCampaignId: string | null;
};

const props = defineProps<{
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  allowAutoLogin: boolean;
  initialInvite?: string;
  notice?: string;
}>();

const emit = defineEmits<{
  authenticated: [Authenticated];
  help: [HelpTab];
}>();

type Step = 'welcome' | 'role' | 'connect' | 'account';
const STEPS: Step[] = ['role', 'connect', 'account'];
if (props.initialInvite) hostingEnabled.value = false;
const step = ref<Step>(!desktopMode ? 'account' : props.initialInvite ? 'connect' : 'role');
const stepNumber = computed(() => STEPS.indexOf(step.value) + 1);
const STEP_TITLES = computed(() => [t('Кто вы'), hostingEnabled.value ? t('Ваш сервер') : t('Подключение к мастеру'), t('Аккаунт')]);

function go(next: Step) {
  clearError();
  step.value = next;
  if (next === 'connect' && hostingEnabled.value) ensureHost();
  if (next === 'account') pickAccountTab();
  void nextTick(() => document.querySelector<HTMLElement>('.login-screen [data-autofocus]')?.focus());
}

function chooseRole(master: boolean) {
  hostingEnabled.value = master;
  go('connect');
}

const serverCheck = useServerProbe({ initialInvite: props.initialInvite });

const { ensureHost, playersWhere, choosePlayersWhere, hostStateText } = useHostStep();

const saved = ref<SavedLogins | null>(null);
const remember = ref(true);
const autoLoginAs = ref<SavedLogin | null>(null);
let autoLoginCancelled = false;

const { savedEntries, serverLabel, rememberRecent, quickAccounts, accountsHere } = useLoginAccounts({ saved, serverCheck });

const accountTab = ref<'login' | 'register'>('login');
const username = ref('');
const password = ref('');
const displayName = ref('');
const showPassword = ref(false);

const busy = ref(false);
const error = ref('');
const hints = ref<string[]>([]);

function showError(cause: unknown) {
  error.value = cause instanceof Error ? cause.message : t('Неизвестная ошибка.');
  hints.value = errorHints(cause);
}

function clearError() {
  error.value = '';
  hints.value = [];
}

const canSubmit = computed(() =>
  !busy.value &&
  username.value.trim() !== '' &&
  password.value !== '' &&
  (!desktopMode || (hostingEnabled.value ? hostRunning.value : serverCheck.targetAddress !== '')),
);

const quickPick = ref('');
function pickQuick(key: string) {
  const entry = quickAccounts.value.find(item => item.key === key);
  quickPick.value = '';
  if (!entry) return;
  if (entry.saved) {
    void loginWithSaved(entry.saved);
    return;
  }
  username.value = entry.username;
  accountTab.value = 'login';
  if (desktopMode) {
    hostingEnabled.value = isLoopbackAddress(entry.serverUrl);
    if (!hostingEnabled.value) serverCheck.serverAddress = entry.serverUrl;
  }
}

function pickAccountTab() {
  if (accountsHere.value.length) accountTab.value = 'login';
  else accountTab.value = hostingEnabled.value || serverCheck.invite.code ? 'register' : 'login';
}

async function finish(result: any, serverUrl: string, server: ServerProbe | null, savedLoginId: string | null) {
  if (typeof result?.user?.username === 'string') rememberRecent(result.user.username, serverUrl);
  emit('authenticated', {
    token: result.token,
    user: result.user,
    serverUrl,
    server,
    savedLoginId,
    inviteCode: hostingEnabled.value ? null : serverCheck.invite.code,
    joinedCampaignId: typeof result?.joinedCampaignId === 'string' ? result.joinedCampaignId : null,
  });
}

async function submit() {
  if (!canSubmit.value) return;

  busy.value = true;
  clearError();

  try {
    let serverUrl = '';
    let server: ServerProbe | null = null;

    if (window.desktop) {
      serverUrl = await window.desktop.setServer(serverCheck.targetAddress);
      server = serverCheck.probe?.ok && sameOrigin(serverCheck.probe.origin, serverUrl) ? serverCheck.probe : await serverCheck.runProbe();

      if (server && !server.ok) {
        throw new ApiError(server.error.message, 0, server.error.hints, true);
      }

      if (server?.ok && !sameOrigin(server.origin, serverUrl)) {
        serverUrl = await window.desktop.setServer(server.origin);
      }

      if (serverCheck.ownServerWarning) {
        throw new Error(t('Этот адрес ведёт на ваш собственный компьютер, а не к мастеру — вернитесь на шаг 2.'));
      }
    }

    const result = accountTab.value === 'register'
      ? await props.request('/auth/register', 'POST', {
          username: username.value,
          password: password.value,
          ...(displayName.value.trim() ? { displayName: displayName.value } : {}),
          ...(!hostingEnabled.value && serverCheck.invite.code ? { inviteCode: serverCheck.invite.code } : {}),
        })
      : await props.request('/auth/login', 'POST', {
          username: username.value,
          password: password.value,
        });

    let savedLoginId: string | null = null;

    if (window.desktop) {
      if (remember.value && saved.value?.encryptionAvailable) {
        saved.value = await window.desktop.auth.remember({
          username: username.value,
          password: password.value,
          hostName: server?.ok ? server.hostName : null,
          serverId: server?.ok ? server.serverId : null,
        });
        await window.desktop.auth.setAutoLogin(true);
        savedLoginId = saved.value.lastId;
      } else {
        saved.value = await window.desktop.auth.clearLast();
      }
    }

    password.value = '';
    await finish(result, serverUrl, server, savedLoginId);
  } catch (cause) {
    showError(cause);
  } finally {
    busy.value = false;
  }
}

async function loginWithSaved(entry: SavedLogin) {
  if (!window.desktop || busy.value) return;

  busy.value = true;
  clearError();
  autoLoginAs.value = entry;
  autoLoginCancelled = false;

  try {
    if (isLoopbackAddress(entry.serverUrl) && !hostRunning.value) {
      hostingEnabled.value = true;
      if (!await startHosting()) {
        throw new Error(hostStatus.value.code === 'vc-runtime' ? hostStatus.value.message : t('Не удалось запустить сервер на этом компьютере — см. раздел «Сервер».'));
      }
    }

    const response = await window.desktop.auth.loginSaved(entry.id);
    if (autoLoginCancelled) return;

    if (response.status < 200 || response.status >= 300) {
      username.value = entry.username;
      if (!isLoopbackAddress(entry.serverUrl)) serverCheck.serverAddress = entry.serverUrl;
      hostingEnabled.value = isLoopbackAddress(entry.serverUrl);

      const message = response.data?.message ?? t('Не удалось войти (ответ сервера {status}). Проверьте адрес сервера и попробуйте ещё раз.', { status: response.status });
      throw new ApiError(
        response.status === 401 ? `${message} ${t('Введите пароль заново — он сохранится.')}` : message,
        response.status,
        response.data?.hints ?? [],
        response.status === 0,
      );
    }

    const server = await window.desktop.probeServer(response.serverUrl);
    saved.value = await window.desktop.auth.markUsed(entry.id, server.ok ? { hostName: server.hostName, serverId: server.serverId } : {});
    await finish(response.data, response.serverUrl, server, entry.id);
  } catch (cause) {
    step.value = 'account';
    accountTab.value = 'login';
    showError(cause);
  } finally {
    busy.value = false;
    autoLoginAs.value = null;
  }
}

function cancelAutoLogin() {
  autoLoginCancelled = true;
  autoLoginAs.value = null;
  busy.value = false;
}

async function forgetSaved(entry: SavedLogin) {
  if (!window.desktop) return;
  saved.value = await window.desktop.auth.forget(entry.id);
  if (!saved.value.entries.length && step.value === 'welcome') step.value = 'role';
}

onMounted(async () => {
  if (!window.desktop) return;

  const [address, savedLogins] = await Promise.all([
    window.desktop.getServer(),
    window.desktop.auth.saved(),
    refreshHostStatus(),
  ]);

  saved.value = savedLogins;
  remember.value = savedLogins.encryptionAvailable;

  if (!serverCheck.invite.address && !isLoopbackAddress(address)) serverCheck.serverAddress = address;
  if (step.value === 'role' && savedLogins.entries.length) step.value = 'welcome';
  if (step.value === 'connect' && hostingEnabled.value) ensureHost();

  if (!props.allowAutoLogin) return;

  if (hostingEnabled.value && hostAutoStart.value && !hostRunning.value) {
    void startHosting();
  }

  const last = savedLogins.autoLogin && !props.initialInvite
    ? savedLogins.entries.find(entry => entry.id === savedLogins.lastId)
    : undefined;

  if (last) await loginWithSaved(last);
});

watch(hostingEnabled, () => clearError());
</script>

<template>
  <div class="login-screen">
    <p v-if="notice" class="notice warning" role="status">{{ notice }}</p>

    <div v-if="autoLoginAs" class="panel auto-login" role="status">
      <p>
        {{ t('Вхожу как') }} <strong>{{ autoLoginAs.username }}</strong> —
        {{ serverLabel(autoLoginAs) }}…
      </p>
      <p v-if="isLoopbackAddress(autoLoginAs.serverUrl) && hostStatus.state === 'starting'" class="muted">
        {{ hostStatus.message || t('Запускаю сервер…') }}
      </p>
      <button type="button" @click="cancelAutoLogin">{{ t('Отмена') }}</button>
    </div>

    <template v-else>
      <ol v-if="desktopMode && step !== 'welcome'" class="wizard-steps" :aria-label="t('Шаги входа')">
        <li v-for="(title, index) in STEP_TITLES" :key="index" :data-state="index + 1 < stepNumber ? 'done' : index + 1 === stepNumber ? 'current' : 'next'" :aria-current="index + 1 === stepNumber ? 'step' : undefined">
          <span class="step-dot"><GameIcon v-if="index + 1 < stepNumber" name="check" :size="14" /><template v-else>{{ index + 1 }}</template></span>
          <span>{{ title }}</span>
        </li>
      </ol>

      <LoginWelcomeStep
        v-if="step === 'welcome'" :saved-entries="savedEntries" :server-label="serverLabel" :busy="busy" :error="error"
        @login="loginWithSaved" @forget="forgetSaved" @other="go('role')"
      />

      <LoginRoleStep v-else-if="step === 'role'" :has-saved="savedEntries.length > 0" @choose="chooseRole" @help="emit('help', $event)" @saved="go('welcome')" />

      <LoginPlayerStep
        v-else-if="step === 'connect' && !hostingEnabled" :server-check="serverCheck" :busy="busy"
        @back="go('role')" @next="go('account')" @help="emit('help', $event)"
      />

      <LoginHostStep
        v-else-if="step === 'connect'" :players-where="playersWhere" :host-state-text="hostStateText"
        @choose="choosePlayersWhere" @back="go('role')" @next="go('account')" @help="emit('help', $event)"
      />

      <form v-else class="panel wizard account" aria-labelledby="account-title" @submit.prevent="submit">
        <h2 id="account-title">{{ hostingEnabled ? t('Ваш аккаунт мастера') : t('Ваш аккаунт у мастера') }}</h2>
        <p v-if="desktopMode && !hostingEnabled && serverCheck.targetAddress" class="muted where">
          {{ t('Сервер:') }} <strong>{{ serverCheck.serverName || serverCheck.targetAddress }}</strong>
          <button type="button" class="link-button" @click="go('connect')">{{ t('изменить') }}</button>
        </p>

        <div class="account-choice" role="radiogroup" :aria-label="t('Вход или регистрация')">
          <button type="button" class="choice-card" role="radio" :aria-checked="accountTab === 'register'" :data-on="accountTab === 'register'" @click="accountTab = 'register'; clearError()">
            <strong>{{ t('Я здесь впервые') }}</strong>
            <span>{{ t('создать аккаунт') }}</span>
          </button>
          <button type="button" class="choice-card" role="radio" :aria-checked="accountTab === 'login'" :data-on="accountTab === 'login'" @click="accountTab = 'login'; clearError()">
            <strong>{{ t('У меня уже есть аккаунт') }}</strong>
            <span>{{ t('войти') }}</span>
          </button>
        </div>

        <p v-if="accountTab === 'register' && !hostingEnabled && serverCheck.probe?.ok && serverCheck.probe.registration === 'invite' && !serverCheck.invite.code" class="notice warning">
          {{ t('Через интернет этот сервер регистрирует только по приглашению мастера — вернитесь на шаг 2 и вставьте его текст.') }}
        </p>

        <p class="muted">
          <template v-if="accountTab === 'register'">
            {{ hostingEnabled
              ? t('Придумайте любой логин и пароль — требований нет. Аккаунт создаётся на вашем сервере.')
              : t('Придумайте любой логин и пароль — требований нет. Аккаунт создаётся на сервере мастера; на других серверах его нет.') }}
          </template>
          <template v-else>
            {{ t('Введите логин и пароль, с которыми вы уже входили на этот сервер.') }}
          </template>
        </p>

        <label v-if="accountTab === 'login' && accountsHere.length" class="quick-accounts">
          {{ t('Вы уже входили сюда как') }}
          <select v-model="quickPick" :disabled="busy" @change="pickQuick(quickPick)">
            <option value="">{{ t('— выбрать —') }}</option>
            <option v-for="entry in accountsHere" :key="entry.key" :value="entry.key">
              {{ entry.saved ? t('{username} — войти сразу', { username: entry.username }) : t('{username} — ввести пароль', { username: entry.username }) }}
            </option>
          </select>
        </label>

        <label>
          {{ accountTab === 'register' ? t('Логин (имя для входа)') : t('Логин') }}
          <input v-model="username" data-autofocus autocomplete="username" maxlength="64" :disabled="busy" />
        </label>

        <label>
          {{ t('Пароль') }}
          <div class="password-field">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              :autocomplete="accountTab === 'register' ? 'new-password' : 'current-password'"
              maxlength="200"
              :disabled="busy"
            />
            <button
              type="button"
              :aria-pressed="showPassword"
              :aria-label="showPassword ? t('Скрыть пароль') : t('Показать пароль')"
              @click="showPassword = !showPassword"
            >
              {{ showPassword ? t('Скрыть') : t('Показать') }}
            </button>
          </div>
        </label>

        <label v-if="accountTab === 'register'">
          {{ t('Как вас называть в игре — необязательно') }}
          <input v-model="displayName" autocomplete="nickname" maxlength="100" :placeholder="username || t('как логин')" :disabled="busy" />
        </label>

        <label v-if="desktopMode" class="checkbox-label remember">
          <input v-model="remember" type="checkbox" :disabled="busy || !saved?.encryptionAvailable" />
          {{ t('Запомнить меня на этом компьютере — в следующий раз войти одной кнопкой') }}
        </label>
        <small v-if="desktopMode && saved && !saved.encryptionAvailable">
          {{ t('Шифрование Windows недоступно — пароль не будет сохранён.') }}
        </small>

        <div v-if="error" class="notice error" role="alert">
          <p>{{ error }}</p>
          <ul v-if="hints.length">
            <li v-for="hint in hints" :key="hint">{{ hint }}</li>
          </ul>
          <VcRuntimeButton />
        </div>

        <div class="wizard-actions">
          <button v-if="desktopMode" type="button" class="quiet" :disabled="busy" @click="go('connect')">← {{ t('Назад') }}</button>
          <button class="primary big submit" :disabled="!canSubmit">
            {{
              busy
                ? t('Подключение…')
                : accountTab === 'register'
                  ? t('Создать аккаунт и войти')
                  : t('Войти')
            }}
          </button>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped src="./loginKit.css"></style>

<style scoped>
.login-screen{max-width:720px;margin:24px auto;display:flex;flex-direction:column;gap:18px}
.wizard-steps{list-style:none;display:flex;gap:6px;padding:0;margin:0;flex-wrap:wrap}
.wizard-steps li{display:flex;align-items:center;gap:8px;flex:1 1 0;min-width:140px;padding:8px 10px;border:1px solid var(--brass-light);border-radius:6px;background:var(--surface-inset);opacity:.7}
.wizard-steps li[data-state="current"]{opacity:1;border-color:var(--brass,#b08d57);box-shadow:inset 0 -3px 0 var(--brass,#b08d57)}
.wizard-steps li[data-state="done"]{opacity:.9}
.step-dot{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;border:1px solid var(--brass-light);font-weight:700;flex-shrink:0}
.wizard-steps li[data-state="current"] .step-dot{background:var(--brass,#b08d57);color:#1b130b}
.wizard-steps li[data-state="done"] .step-dot{background:#3f8a4e;color:#fff;border-color:#3f8a4e}
.account-choice{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:4px 0 10px}
.account-choice .choice-card{flex-direction:column;gap:2px;margin:0}
.account-choice .choice-card strong{font-size:16px}
.account-choice .choice-card span{font-weight:400;font-size:13px}
.where{margin-top:-6px}
.remember{gap:10px}
.auto-login{display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.auto-login p{margin:0}
@media(max-width:600px){.account-choice{grid-template-columns:1fr}}
</style>
