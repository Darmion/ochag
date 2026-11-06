<script setup lang="ts">
import ConfirmDialog from './components/common/ConfirmDialog.vue';
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { protectNames } from './i18n/domTranslate';

import { branding } from './ui/branding';
import { ApiError } from './connection/connection';
import { useSessionHeartbeat } from './connection/sessionHeartbeat';
import { desktopMode, hostingEnabled } from './connection/hostStore';
import LoginScreen, { type Authenticated } from './components/connection/LoginScreen.vue';
import BrandLogo from './components/common/BrandLogo.vue';
import HostPanel from './components/connection/HostPanel.vue';
import HelpModal, { type HelpTab } from './components/settings/HelpModal.vue';
import ConnectionBadge, { type SessionConnection } from './components/connection/ConnectionBadge.vue';
import PlayersPanel from './components/campaign/PlayersPanel.vue';
import UpdatesModal from './components/connection/UpdatesModal.vue';
import BackgroundMusic from './components/tabletop/BackgroundMusic.vue';
import CampaignToasts from './components/campaign/CampaignToasts.vue';
import CharacterImportForm from './components/characters/CharacterImportForm.vue';
import CharacterImportPreview from './components/characters/CharacterImportPreview.vue';
import { useSheetImport } from './characterImport/sheetImport';
import { onCampaignEvent } from './campaign/campaignEvents';
import { useCampaignLive } from './campaign/campaignLive';
import { useCampaignSelection, type Campaign } from './campaign/campaignSelection';
import { loadCampaignArt } from './art/campaignArt';
import { musicOffTable } from './campaign/backgroundMusic';
import HandoutViewer, { type Handout } from './components/campaign/HandoutViewer.vue';
import DialogueOverlay from './components/campaign/DialogueOverlay.vue';
import { autoCheckGitHub, compareVersions, githubUpdate, updateState } from './connection/updateStore';
import './settings/uiMode';
import { cssZoom } from './settings/uiScale';
import GameTopBar from './components/game/GameTopBar.vue';
import GameLobby from './components/game/GameLobby.vue';
import GameOptionsModal from './components/game/GameOptionsModal.vue';
import ModsDialog from './components/settings/ModsDialog.vue';
import { tableHotkeysRequest, tableSettingsAvailable, tableSettingsRequest } from './settings/settingsBus';
import GameIcon from './components/game/GameIcon.vue';

const token = ref('');
const currentUserId = ref('');
const currentUser = ref({ username: '', displayName: '' });

const isServerHost = ref(false);
const canCreateCampaigns = ref(false);

const serverUrl = ref('');
const serverInfo = ref<ServerProbe | null>(null);
const sessionConnection = ref<SessionConnection | null>(null);
const connectionState = ref<'ok' | 'lost' | 'expired'>('ok');
const savedLoginId = ref<string | null>(null);

const allowAutoLogin = ref(true);
const loginNotice = ref('');
const loginInvite = ref('');
const loginScreenKey = ref(0);

const updatesOpen = ref(false);

onMounted(() => { void autoCheckGitHub(); });

const serverVersionDiff = computed(() => {
  const serverVersion = serverInfo.value?.ok ? serverInfo.value.appVersion : null;
  const own = updateState.value?.currentVersion;
  if (!loggedIn.value || !serverVersion || !own || isServerHost.value) return null;
  const diff = compareVersions(serverVersion, own);
  return diff === 0 ? null : { newer: diff > 0, serverVersion, own };
});

const updateAvailable = computed(() => Boolean(githubUpdate.value?.newer) || Boolean(serverVersionDiff.value?.newer));

const helpOpen = ref(false);
const helpTab = ref<HelpTab>('how');

function openHelp(tab: HelpTab = 'how') {
  helpTab.value = tab;
  helpOpen.value = true;
}

const campaigns = ref<Campaign[]>([]);
watch(() => campaigns.value.map(campaign => campaign.name).join('\n'), names => protectNames('campaigns', names.split('\n')), { immediate: true });
const campaignId = ref('');

const busy = ref(false);
const error = ref('');
const errorHints = ref<string[]>([]);
const message = ref('');
let messageTimer: ReturnType<typeof setTimeout> | undefined;
watch(message, value => {
  clearTimeout(messageTimer);
  if (value) messageTimer = setTimeout(() => { message.value = ''; }, 8000);
});

const loggedIn = computed(() => token.value !== '');
type MainTab = 'book' | 'table' | 'characters' | 'rules' | 'look' | 'server';
const activeTab = ref<MainTab>('book');
const loadTabletop = () => import('./components/tabletop/TabletopView.vue');
const TabletopView = defineAsyncComponent(loadTabletop);
// The Babylon table is a separate ~6 MB chunk, prefetched when idle; Safari has no requestIdleCallback.
onMounted(() => {
  const prefetch = () => { void loadTabletop(); };
  if (window.requestIdleCallback) window.requestIdleCallback(prefetch, { timeout: 2000 });
  else setTimeout(prefetch, 1000);
});
const CharactersTab = defineAsyncComponent(
  () => import('./components/characters/CharactersTab.vue'),
);
const RulesTab = defineAsyncComponent(
  () => import('./components/rules/RulesTab.vue'),
);
const PersonalizationTab = defineAsyncComponent(
  () => import('./components/campaign/PersonalizationTab.vue'),
);

const sheetCharacterId = ref('');
const CharacterSheet = defineAsyncComponent(
  () => import('./components/sheet/CharacterSheet.vue'),
);

const { invitationCode, campaignName, isMaster, currentCampaignName, inviteServerMismatch, refreshCampaigns, joinCampaign, onCampaignImported, createCampaign } = useCampaignSelection({
  api, run, campaigns, campaignId, serverUrl, currentUserId, canCreateCampaigns, message, showLobby: () => { activeTab.value = 'book'; },
});

// `file` is uploaded as multipart/form-data; `body` is then ignored.
async function api(
  path: string,
  method = 'GET',
  body?: unknown,
  file?: File,
) {
  if (window.desktop) {
    const response = await window.desktop.request({
      path,
      method,
      token: token.value,
      ...(file
        ? {
            file: {
              name: file.name,
              type: file.type,
              data: await file.arrayBuffer(),
            },
          }
        // IPC structured clone cannot copy Vue reactive proxies («An object could not be cloned»), so the body goes through JSON.
        : { body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) }),
    });

    if (response.status < 200 || response.status >= 300) {
      throw Object.assign(new ApiError(
        response.data?.message ??
        `Сервер ответил ошибкой ${response.status}. Попробуйте ещё раз.`,
        response.status,
        Array.isArray(response.data?.hints) ? response.data.hints : [],
        response.status === 0,
      ), { code: typeof response.data?.error === 'string' ? response.data.error : undefined, details: response.data?.details });
    }

    return response.binary ? new Blob([response.data], response.contentType ? { type: response.contentType } : {}) : response.data;
  }

  let payload: BodyInit | undefined;
  const headers: Record<string, string> = {};

  if (file) {
    const form = new FormData();
    form.append('file', file);
    payload = form;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }

  if (token.value) headers.Authorization = `Bearer ${token.value}`;

  let response: Response;

  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      ...(payload !== undefined ? { body: payload } : {}),
    });
  } catch {
    throw new ApiError('Сервер разработки недоступен.', 0, ['Запустите сервер: npm start.'], true);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  const result = response.status === 204
    ? null
    : isJson
      ? await response.json()
      : await response.blob();

  if (!response.ok) {
    throw Object.assign(new ApiError(
      (isJson ? result?.message : undefined) ??
      `Сервер ответил ошибкой ${response.status}. Попробуйте ещё раз.`,
      response.status,
    ), isJson ? { code: typeof result?.error === 'string' ? result.error : undefined, details: result?.details } : {});
  }

  return result;
}

async function run(action: () => Promise<void>) {
  if (busy.value) return;

  busy.value = true;
  error.value = '';
  errorHints.value = [];
  message.value = '';

  try {
    await action();
  } catch (cause) {
    error.value = cause instanceof Error
      ? cause.message
      : 'Неизвестная ошибка.';
    errorHints.value = cause instanceof ApiError ? cause.hints : [];
  } finally {
    busy.value = false;
  }
}

const { startHeartbeat, stopHeartbeat, checkSession } = useSessionHeartbeat({
  api, resetSession, token, currentUserId, savedLoginId, sessionConnection, isServerHost, canCreateCampaigns, connectionState,
});

useCampaignLive({ loggedIn, campaignId, token });
watch(activeTab, () => {
  error.value = '';
  errorHints.value = [];
});

const openHandout = ref<Handout | null>(null);
const stopHandouts = onCampaignEvent('handout', handout => { openHandout.value = handout; });
onBeforeUnmount(stopHandouts);
watch(campaignId, () => { openHandout.value = null; });
watch([campaignId, loggedIn], ([id, logged]) => { void loadCampaignArt(api, logged ? id : ''); }, { immediate: true });

function resetSession(notice = '', invite = '') {
  stopHeartbeat();
  token.value = '';
  currentUserId.value = '';
  currentUser.value = { username: '', displayName: '' };
  isServerHost.value = false;
  canCreateCampaigns.value = false;
  campaigns.value = [];
  campaignId.value = '';
  draft.value = null;
  sheetCharacterId.value = '';
  activeTab.value = 'book';
  sessionConnection.value = null;
  serverInfo.value = null;
  savedLoginId.value = null;
  allowAutoLogin.value = false;
  loginNotice.value = notice;
  loginInvite.value = invite;
  loginScreenKey.value++;
}

async function onAuthenticated(payload: Authenticated) {
  token.value = payload.token;
  currentUserId.value = payload.user.id;
  currentUser.value = { username: payload.user.username, displayName: payload.user.displayName };
  serverUrl.value = payload.serverUrl;
  serverInfo.value = payload.server;
  savedLoginId.value = payload.savedLoginId;
  connectionState.value = 'ok';
  loginNotice.value = '';
  loginInvite.value = '';
  error.value = '';
  errorHints.value = [];
  message.value = '';

  startHeartbeat();
  void checkSession();

  await run(async () => {
    let joinedId: string | undefined;
    let joinError: unknown;

    let alreadyMember = false;
    if (payload.joinedCampaignId) {
      joinedId = payload.joinedCampaignId;
    } else if (payload.inviteCode) {
      try {
        const joined = await api('/campaigns/join', 'POST', { code: payload.inviteCode });
        joinedId = joined.campaignId;
        alreadyMember = joined.alreadyMember === true;
      } catch (cause) {
        if (!(cause instanceof ApiError && cause.status === 409)) joinError = cause;
      }
    }

    await refreshCampaigns(joinedId);
    if (joinError) throw joinError;

    if (joinedId) {
      message.value = alreadyMember
        ? `Вы уже в кампании «${currentCampaignName.value}» — она выбрана в списке.`
        : `Вы присоединились к кампании «${currentCampaignName.value}».`;
    } else if (campaigns.value.length === 0) {
      message.value = hostingEnabled.value
        ? 'Вы вошли на свой сервер. Создайте кампанию ниже, затем «Пригласить игрока» — приглашение уже будет содержать адрес для игроков.'
        : payload.server?.ok && payload.server.thisComputer && serverUrl.value
        ? 'Вы вошли на свой сервер (этот компьютер). Кампаний здесь пока нет: создайте свою или, чтобы играть у мастера, выйдите и подключитесь к его адресу.'
        : 'Вы подключились к серверу. Вставьте приглашение мастера или создайте свою кампанию.';
    }
  });
}

function logout() {
  return run(async () => {
    try {
      await api('/auth/logout', 'POST');
    } catch {
    }

    await window.desktop?.auth.clearLast();
    resetSession();
  });
}

const { targetCharacterId, draft, proposal, extrasText, keepCurrent, keepCurrentExtras, importers, loadImporters, importFile, editField, confirmImport, cancelImport } = useSheetImport({
  api, run, campaignId, message,
});
watch(loggedIn, logged => { if (logged) void loadImporters(); else importers.value = []; }, { immediate: true });

function switchToInviteServer() {
  const invite = invitationCode.value;
  invitationCode.value = '';

  return run(async () => {
    try {
      await api('/auth/logout', 'POST');
    } catch {
    }

    await window.desktop?.auth.clearLast();
    resetSession('', invite);
  });
}

const gameOptionsOpen = ref(false);
const modsOpen = ref(false);
// --ui-zoom: vh limits inside CSS zoom are multiplied again and style.css divides them back; in the desktop app cssZoom is 1.
const gameAppStyle = computed(() => (cssZoom.value !== 1 ? { zoom: `${Math.round(cssZoom.value * 100)}%`, '--ui-zoom': String(cssZoom.value) } : undefined));
const importOpen = ref(false);
const atTable = computed(() => loggedIn.value && !draft.value && activeTab.value === 'table' && Boolean(campaignId.value));
const serverTabLabel = computed(() => (desktopMode && isServerHost.value ? 'Сервер' : 'Игроки'));

function openFromLobby(tab: 'table' | 'characters' | 'rules') {
  if (campaignId.value) activeTab.value = tab;
}

</script>

<template>
  <div v-if="!atTable" class="game-backdrop" aria-hidden="true" />
  <main :class="['game-app', { 'at-table': atTable }]" :style="gameAppStyle">
    <GameTopBar
      :logged-in="loggedIn && !draft"
      :active-tab="activeTab"
      :campaigns="campaigns"
      :campaign-id="campaignId"
      :server-tab-label="serverTabLabel"
      :version="desktopMode && updateState ? updateState.currentVersion : null"
      :update-available="updateAvailable"
      :at-table="tableSettingsAvailable"
      @tab="activeTab = $event"
      @campaign="campaignId = $event"
      @help="openHelp(loggedIn ? 'trouble' : 'how')"
      @credits="openHelp('credits')"
      @updates="updatesOpen = true"
      @hotkeys="tableHotkeysRequest++"
      @options="tableSettingsAvailable ? tableSettingsRequest++ : (gameOptionsOpen = true)"
      @mods="modsOpen = true"
    >
      <template #status>
        <ConnectionBadge
          v-if="loggedIn"
          compact
          :server-url="serverUrl"
          :server="serverInfo"
          :username="currentUser.username"
          :display-name="currentUser.displayName"
          :connection="sessionConnection"
          :state="connectionState"
          @switch-server="logout"
          @help="openHelp('trouble')"
        />
      </template>
    </GameTopBar>


    <div v-if="error" class="notice error app-error" role="alert">
      <button type="button" class="app-message-close" aria-label="Закрыть сообщение" @click="error = ''; errorHints = []"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      <p>{{ error }}</p>
      <ul v-if="errorHints.length">
        <li v-for="hint in errorHints" :key="hint">{{ hint }}</li>
      </ul>
    </div>

    <p v-if="message" class="notice success app-message" role="status">
      <span>{{ message }}</span>
      <button type="button" class="app-message-close" aria-label="Закрыть сообщение" @click="message = ''"><GameIcon class="inline-icon" name="close" :size="16" /></button>
    </p>

    <div v-if="serverVersionDiff" class="notice warning version-banner">
      <p v-if="serverVersionDiff.newer">
        У мастера версия {{ serverVersionDiff.serverVersion }}, у вас {{ serverVersionDiff.own }} — обновитесь,
        чтобы всё работало одинаково. Скачивание идёт прямо с сервера мастера, без интернета.
      </p>
      <p v-else>
        У мастера более старая версия ({{ serverVersionDiff.serverVersion }}), чем у вас ({{ serverVersionDiff.own }}).
        Попросите мастера обновиться — при разных версиях что-то может работать не так.
      </p>
      <button v-if="serverVersionDiff.newer" type="button" class="primary" @click="updatesOpen = true">Обновиться</button>
    </div>

    <div v-if="!loggedIn" class="game-title-screen" aria-hidden="true">
      <p class="eyebrow">{{ branding.tagline }}</p>
      <BrandLogo class="game-title-logo" />
      <p class="game-subtitle">Кампании, карты и бои за одним столом · <span class="game-edition">{{ branding.edition }}</span></p>
    </div>


    <GameLobby
      v-if="loggedIn && !draft && activeTab === 'book'"
      v-model:campaign-id="campaignId"
      v-model:invitation-code="invitationCode"
      v-model:campaign-name="campaignName"
      :campaigns="campaigns"
      :current-user-id="currentUserId"
      :can-create-campaigns="canCreateCampaigns"
      :is-master="isMaster"
      :busy="busy"
      :server-url="serverUrl"
      :token="token"
      :invite-server-mismatch="inviteServerMismatch"
      :request="api"
      @create="createCampaign"
      @join="joinCampaign"
      @switch-server="switchToInviteServer"
      @open="openFromLobby"
      :can-import="importers.length > 0"
      @import-character="importOpen = !importOpen"
      @imported="onCampaignImported"
      @appearance-changed="refreshCampaigns"
    />


    <HostPanel
      v-if="desktopMode && isServerHost && loggedIn && !draft && activeTab === 'server'"
      full
      :owner-id="currentUserId"
      :request="api"
      @help="openHelp('host')"
    />

    <PlayersPanel
      v-if="!(desktopMode && isServerHost) && loggedIn && !draft && activeTab === 'server'"
      :request="api"
      :current-user-id="currentUserId"
    />

    <LoginScreen
      v-if="!loggedIn"
      :key="loginScreenKey"
      :request="api"
      :allow-auto-login="allowAutoLogin"
      :initial-invite="loginInvite"
      :notice="loginNotice"
      @authenticated="onAuthenticated"
      @help="openHelp"
    />

    <CharacterImportForm
      v-else-if="!draft && activeTab === 'book' && importOpen"
      v-model:campaign-id="campaignId"
      v-model:target-character-id="targetCharacterId"
      :campaigns="campaigns"
      :busy="busy"
      :importers="importers"
      @file="importFile"
    />

    <CharacterImportPreview
      v-else-if="draft"
      v-model:extras-text="extrasText"
      v-model:keep-current-extras="keepCurrentExtras"
      :draft="draft"
      :proposal="proposal"
      :keep-current="keepCurrent"
      :busy="busy"
      @edit-field="editField"
      @confirm="confirmImport"
      @cancel="cancelImport"
    />
    <BackgroundMusic v-if="loggedIn && campaignId && !atTable && musicOffTable" :key="campaignId" :campaign-id="campaignId" :request="api" />

    <TabletopView
      v-if="loggedIn && !draft && activeTab === 'table' && campaignId"
      :key="campaignId"
      :campaign-id="campaignId"
      :token="token"
      :current-user-id="currentUserId"
      :request="api"
      @open-character-sheet="sheetCharacterId = $event"
    />

    <CharactersTab
      v-if="loggedIn && !draft && activeTab === 'characters' && campaignId"
      :key="campaignId"
      :campaign-id="campaignId"
      :current-user-id="currentUserId"
      :request="api"
      :token="token"
      @open-character-sheet="sheetCharacterId = $event"
      :importers="importers"
      @import-file="(importerId: string, file: File) => { targetCharacterId = ''; importFile(importerId, file); }"
    />

    <PersonalizationTab
      v-if="loggedIn && !draft && activeTab === 'look'"
      :request="api"
      :campaign-id="campaignId"
      :campaign-name="currentCampaignName"
    />

    <RulesTab
      v-if="loggedIn && !draft && activeTab === 'rules' && campaignId"
      :key="campaignId"
      :campaign-id="campaignId"
      :request="api"
    />

    <DialogueOverlay
      v-if="loggedIn && campaignId"
      :key="`dialogue-${campaignId}`"
      :campaign-id="campaignId"
      :current-user-id="currentUserId"
      :request="api"
    />

    <HandoutViewer
      v-if="loggedIn && campaignId && openHandout"
      :campaign-id="campaignId"
      :handout="openHandout"
      :request="api"
      @close="openHandout = null"
    />

    <CampaignToasts
      v-if="loggedIn && campaignId && activeTab !== 'table'"
      :key="`toasts-${campaignId}`"
      :campaign-id="campaignId"
      :current-user-id="currentUserId"
      :request="api"
    />

    <CharacterSheet
      v-if="loggedIn && sheetCharacterId && campaignId"
      :campaign-id="campaignId"
      :character-id="sheetCharacterId"
      :token="token"
      :current-user-id="currentUserId"
      :request="api"
      @close="sheetCharacterId = ''"
    />

    <HelpModal v-if="helpOpen" :initial-tab="helpTab" @close="helpOpen = false" />

    <UpdatesModal
      v-if="updatesOpen"
      :server-url="serverUrl"
      :own-server="isServerHost"
      @close="updatesOpen = false"
    />

    <GameOptionsModal v-if="gameOptionsOpen" :request="api" @close="gameOptionsOpen = false" />
    <ModsDialog v-if="modsOpen" :request="loggedIn ? api : undefined" @close="modsOpen = false; if (loggedIn) void loadImporters()" />

    <ConfirmDialog />
  </main>
</template>

<style scoped>
.app-message{display:flex;align-items:center;gap:10px}
.app-message span{flex:1}
.app-message-close{min-height:0;padding:2px 8px}
.app-error{position:relative;padding-right:44px}
.app-error .app-message-close{position:absolute;top:8px;right:8px}
.header-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.update-available{background:linear-gradient(var(--burgundy-light),var(--burgundy));color:var(--burgundy-text)}
.version-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}

.game-app{min-height:100vh;padding:calc(var(--game-top,56px) + 28px) 28px 40px}
.game-app.at-table{padding:0}
.game-app > .notice{max-width:900px;margin:0 auto 16px}
.game-app.at-table > .notice{position:fixed;top:calc(var(--game-top,56px) + 80px);left:50%;translate:-50% 0;z-index:2200;width:min(720px,80vw)}
.game-app > .panel{max-width:1100px;margin:0 auto 24px}
.game-app > .personalization{max-width:1500px}
.game-app > .game-import{max-width:720px;margin-top:28px}
.game-title-screen{text-align:center;margin:3vh auto 2vh;pointer-events:none}
.game-title-screen .eyebrow{font-size:13px;letter-spacing:.4em}
.game-title-logo{width:min(480px,84vw);height:clamp(90px,12vw,160px)}
.game-subtitle{margin:12px 0 0;font:600 17px var(--g-title-font);color:var(--g-text-dim);letter-spacing:.12em}
.game-edition{display:inline-block;margin-left:4px;padding:1px 10px;border-radius:12px;font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:var(--g-gold-hi);border:1px solid var(--g-gold-lo);background:#0006}
</style>
