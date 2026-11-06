<script setup lang="ts">
import { confirmAction } from '../../ui/confirmDialog';
import { onBeforeUnmount, onMounted, ref } from 'vue';

import { copyText } from '../../connection/connection';
import {
  firewallBusy,
  firewallSummary,
  hostAutoStart,
  hostBusy,
  hostLanMode,
  hostLanTls,
  hostRunning,
  hostStatus,
  internetAddresses,
  refreshFirewall,
  refreshHostStatus,
  setLanMode,
  setLanTls,
  startHosting,
  stopHosting,
} from '../../connection/hostStore';
import { useHostBackups } from '../../connection/hostBackups';
import { useHostSignals } from '../../connection/hostSignals';
import ConnectedPlayers from './ConnectedPlayers.vue';
import HostErrorNotice from './HostErrorNotice.vue';
import HostAddresses from './HostAddresses.vue';
import HostBackups from './HostBackups.vue';
import HostFirewall from './HostFirewall.vue';
import NetworkModes from './NetworkModes.vue';
import ServerAccounts from './ServerAccounts.vue';
import GameIcon from '../game/GameIcon.vue';
import ServerSection from './ServerSection.vue';

const props = defineProps<{
  full?: boolean;
  step?: number;
  ownerId?: string;
  request?: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{ help: [] }>();

const copied = ref('');

const {
  statusText, serviceAddresses, hasVpn, onlinePlayers, accessSummary, sharedAddress, securitySummary, accessTone,
  securityTone, basicSignal, internetSignal, addressesSignal, showFirewall, firewallSignal, playersSignal, firewallCheckedAt,
} = useHostSignals();

const accountCount = ref<number | null>(null);
const accountsPanel = ref<InstanceType<typeof ServerAccounts> | null>(null);

const basicSection = ref<InstanceType<typeof ServerSection> | null>(null);
const addressesSection = ref<InstanceType<typeof ServerSection> | null>(null);
const firewallSection = ref<InstanceType<typeof ServerSection> | null>(null);
const playersSection = ref<InstanceType<typeof ServerSection> | null>(null);
function reveal(section: InstanceType<typeof ServerSection> | null) {
  void section?.reveal();
}

async function copy(text: string) {
  if (await copyText(text)) {
    copied.value = text;
    setTimeout(() => { if (copied.value === text) copied.value = ''; }, 2000);
  }
}

async function stopServerSafely() {
  const players = onlinePlayers.value;
  const message = players
    ? `Сейчас подключено игроков: ${players}. Остановка сервера разорвёт их соединения и прервёт текущую игру.\n\nОстановить сервер?`
    : 'Сервер перестанет принимать подключения. Запустить его снова можно будет этой же кнопкой.';
  if (!(await confirmAction(message, {
    title: players ? 'Игроки потеряют связь' : 'Остановить сервер?',
    confirmLabel: 'Остановить сервер',
    danger: players > 0,
  }))) return;
  await stopHosting();
}

async function changeLanMode(event: Event) {
  const input = event.target as HTMLInputElement;
  const enabled = input.checked;
  if (!enabled && hostLanMode.value) {
    const players = onlinePlayers.value;
    const confirmed = await confirmAction(
      `${players ? `Подключено игроков: ${players}. ` : ''}Сетевые адреса перестанут работать, а сервер на несколько секунд перезапустится. Подключаться с этого компьютера по-прежнему будет можно.`,
      { title: 'Закрыть сетевой доступ?', confirmLabel: 'Закрыть доступ', danger: players > 0 },
    );
    if (!confirmed) {
      input.checked = hostLanMode.value;
      return;
    }
  }
  await setLanMode(enabled);
}

async function changeLanTls(event: Event) {
  const input = event.target as HTMLInputElement;
  const enabled = input.checked;
  if (!enabled && hostLanTls.value) {
    const confirmed = await confirmAction(
      'Без TLS пароли и ход игры могут быть видны другим участникам сети. Сервер перезапустится, а игрокам придётся переподключиться.',
      { title: 'Выключить шифрование?', confirmLabel: 'Выключить TLS', danger: true },
    );
    if (!confirmed) {
      input.checked = hostLanTls.value;
      return;
    }
  }
  await setLanTls(enabled);
}

const archive = useHostBackups();

function recheckFirewall() {
  if (hostRunning.value && hostLanMode.value && !firewallBusy.value) void refreshFirewall();
}

let firewallTimer: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  await refreshHostStatus();
  recheckFirewall();
  firewallTimer = setInterval(recheckFirewall, 30_000);
  window.addEventListener('focus', recheckFirewall);
  if (props.full) {
    void archive.refreshBackups();
    void archive.loadSchedule();
  }
});

onBeforeUnmount(() => {
  clearInterval(firewallTimer);
  window.removeEventListener('focus', recheckFirewall);
});
</script>

<template>
  <section class="panel host-panel" :class="{ 'host-panel-full': props.full }" aria-labelledby="host-title">
    <header class="host-hero">
      <div class="host-crest" aria-hidden="true"><GameIcon name="flame" :size="34" /></div>
      <div>
        <span class="eyebrow">УПРАВЛЕНИЕ ОЧАГОМ</span>
        <h2 id="host-title"><span v-if="props.step" class="step-badge">{{ props.step }}</span>{{ props.full ? 'Сердце вашего мира' : 'Сервер на этом компьютере' }}</h2>
        <p class="muted intro">
          Здесь хранятся кампании, персонажи и карты. Игроки подключаются к этому компьютеру.
          <button type="button" class="link-button" @click="emit('help')">Как это работает?</button>
        </p>
      </div>
      <div class="host-sigil" aria-hidden="true"><GameIcon name="castle" :size="72" /><span>◆</span></div>
    </header>

    <div class="host-status" :data-state="hostStatus.state">
      <span class="status-dot" aria-hidden="true" />
      <span class="status-copy"><small>СОСТОЯНИЕ СЕРВЕРА</small><strong>{{ statusText }}</strong></span>

      <button
        v-if="!hostRunning"
        type="button"
        class="primary"
        :disabled="hostBusy || hostStatus.state === 'starting'"
        @click="startHosting"
      >
        {{ hostStatus.state === 'starting' ? 'Запускается…' : 'Запустить сервер' }}
      </button>
      <button v-else type="button" class="quiet-danger" :disabled="hostBusy || archive.backupBusy" :title="archive.backupBusy ? 'Дождитесь завершения резервного копирования' : undefined" @click="stopServerSafely">
        Остановить сервер
      </button>
    </div>

    <div v-if="props.full" class="invite-banner">
      <GameIcon name="door" :size="26" />
      <div class="invite-copy">
        <span class="eyebrow">ПУТЬ К ВАШЕМУ СТОЛУ</span>
        <template v-if="sharedAddress">
          <strong class="invite-address">{{ sharedAddress }}</strong>
          <small>{{ internetAddresses.length ? 'Для игроков через интернет' : 'Для игроков в той же локальной сети или VPN' }} · приглашения в кампанию — на вкладке «Кампании».</small>
        </template>
        <template v-else>
          <strong>{{ hostRunning ? 'Откройте путь для игроков' : 'Приключение ждёт своего часа' }}</strong>
          <small>{{ hostRunning ? 'Проверьте сетевой доступ в настройках ниже, чтобы получить адрес подключения.' : 'Запустите сервер — здесь появится адрес для подключения отряда.' }}</small>
        </template>
      </div>
      <button v-if="sharedAddress" type="button" @click="copy(sharedAddress)">{{ copied === sharedAddress ? 'Скопировано' : 'Копировать адрес' }}</button>
      <button v-else-if="hostRunning" type="button" @click="reveal(basicSection)">Настроить доступ</button>
    </div>

    <div class="server-vitals" role="group" aria-label="Краткое состояние сервера">
      <button type="button" :data-tone="accessTone" @click="reveal(addressesSection ?? basicSection)">
        <GameIcon name="ping" :size="20" /><small>Доступ</small><strong>{{ accessSummary }}</strong>
      </button>
      <button type="button" :data-tone="securityTone" @click="reveal(basicSection)">
        <GameIcon name="shield" :size="20" /><small>Защита</small><strong>{{ securitySummary }}</strong>
      </button>
      <button v-if="showFirewall" type="button" :data-tone="firewallSignal.tone" @click="reveal(firewallSection)">
        <GameIcon name="wall" :size="20" /><small>Брандмауэр</small><strong>{{ firewallSignal.status }}</strong>
      </button>
      <button type="button" :data-tone="playersSignal.tone" :disabled="!props.full || !hostRunning" @click="reveal(playersSection)">
        <GameIcon name="group" :size="20" /><small>Игроки</small><strong>{{ onlinePlayers ? `На связи: ${onlinePlayers}` : 'Никого нет' }}</strong>
      </button>
    </div>

    <HostErrorNotice v-if="props.full" />

    <div class="server-workspace">
    <div class="server-column">
    <div v-if="props.full" class="column-heading"><GameIcon name="tower" :size="18" /><h3>Врата и подключения</h3><span aria-hidden="true">I</span></div>
    <ServerSection
      id="basic" ref="basicSection" icon="gear" eyebrow="БЫСТРЫЙ ЗАПУСК" title="Основные настройки"
      :summary="basicSignal.summary" :status="basicSignal.status" :tone="basicSignal.tone" default-open
    >
      <p class="muted section-note">Безопасные значения подходят для большинства игр.</p>
      <label class="setting-card checkbox-label" :data-on="hostLanMode">
        <input
          type="checkbox"
          :checked="hostLanMode"
          :disabled="hostBusy || archive.backupBusy"
          @change="changeLanMode"
        />
        <span><strong>Подключения игроков по сети</strong><small>Домашняя и виртуальная локальная сеть</small></span>
      </label>
      <small class="setting-note">
        Без этой галочки к серверу можно подключиться только с этого компьютера.
        При переключении работающий сервер перезапускается (на пару секунд).
      </small>

      <template v-if="hostLanMode">
        <label class="setting-card checkbox-label" :data-on="hostLanTls" :data-warning="!hostLanTls">
          <input
            type="checkbox"
            :checked="hostLanTls"
            :disabled="hostBusy || archive.backupBusy"
            @change="changeLanTls"
          />
          <span><strong>Защищённые подключения TLS</strong><small>Рекомендуется всегда оставлять включённым</small></span>
        </label>
        <small class="setting-note">
          Пароли и ход игры не видны другим в сети. При первом подключении игрок сверяет код
          сертификата с вашим. Выключайте, только если у игрока старая версия приложения и он не может подключиться.
        </small>
      </template>

      <label class="setting-card checkbox-label" :data-on="hostAutoStart">
        <input v-model="hostAutoStart" type="checkbox" />
        <span><strong>Автозапуск сервера</strong><small>Очаг будет готов сразу после запуска приложения</small></span>
      </label>
    </ServerSection>

    <ServerSection
      v-if="props.full" id="internet" icon="map" eyebrow="ДАЛЬНИЕ ДОРОГИ" title="Игроки через интернет"
      :summary="internetSignal.summary" :status="internetSignal.status" :tone="internetSignal.tone"
      :attention="internetSignal.tone === 'bad'"
    >
      <NetworkModes embedded />
    </ServerSection>
    <p v-else class="muted">Игроки через интернет (туннель Cloudflare, белый IP) — во вкладке «Сервер» после входа.</p>

    <ServerSection
      v-if="hostRunning" id="addresses" ref="addressesSection" icon="door" eyebrow="ПРИГЛАШЕНИЕ В ИГРУ" title="Куда подключаться игрокам"
      :summary="addressesSignal.summary" :status="addressesSignal.status" :tone="addressesSignal.tone" default-open
    >
      <HostAddresses :copied="copied" :service-addresses="serviceAddresses" :has-vpn="hasVpn" @copy="copy" />
    </ServerSection>

    <ServerSection
      v-if="showFirewall" id="firewall" ref="firewallSection" icon="wall" eyebrow="ЗАЩИТА WINDOWS" title="Брандмауэр Windows"
      :summary="firewallSignal.summary" :status="firewallSignal.status" :tone="firewallSignal.tone"
      :attention="firewallSummary === 'blocked'"
    >
      <HostFirewall :firewall-checked-at="firewallCheckedAt" />
    </ServerSection>

    </div>
    <div v-if="props.full" class="server-column">
      <div class="column-heading"><GameIcon name="book" :size="18" /><h3>Хранитель мира</h3><span aria-hidden="true">II</span></div>
      <ServerSection
        v-if="hostRunning" id="players" ref="playersSection" icon="group" eyebrow="ЗА СТОЛОМ" title="Подключённые игроки"
        :summary="playersSignal.summary" :status="playersSignal.status" :tone="playersSignal.tone" default-open
      >
        <ConnectedPlayers embedded />
      </ServerSection>

      <ServerSection
        v-if="hostRunning && ownerId && request" id="accounts" icon="crown" eyebrow="ДОСТУП" title="Аккаунты и права"
        summary="Кто может создавать кампании · права в ваших кампаниях"
        :status="accountCount === null ? undefined : `аккаунтов: ${accountCount}`" tone="info"
        @toggle="open => { if (open) accountsPanel?.refresh(); }"
      >
        <ServerAccounts ref="accountsPanel" :owner-id="ownerId" :request="request" @loaded="count => (accountCount = count)" />
      </ServerSection>

      <ServerSection
        id="backups" icon="chest" eyebrow="АРХИВ МИРА" title="Резервные копии"
        :summary="archive.backupSignal.summary" :status="archive.backupSignal.status" :tone="archive.backupSignal.tone"
      >
        <HostBackups :archive="archive" />
      </ServerSection>
    </div>
    </div>
  </section>
</template>

<style scoped>
.host-panel{position:relative;overflow:hidden}
.host-panel::before{content:"";position:absolute;inset:0 0 auto;height:150px;pointer-events:none;background:radial-gradient(ellipse at 14% 0,color-mix(in srgb,var(--brass) 18%,transparent),transparent 62%)}
.host-panel h3{font-size:19px;margin:0}
.host-hero{position:relative;display:flex;align-items:center;gap:16px;margin-bottom:16px;padding-bottom:15px;border-bottom:1px solid var(--brass-light)}
.host-hero h2{margin:2px 0 4px}
.host-crest{display:grid;place-items:center;width:54px;height:54px;flex:none;border:1px solid var(--brass);border-radius:50%;font:700 25px var(--g-title-font,serif);color:var(--brass);background:radial-gradient(circle,#ffffff0d,transparent 65%),var(--surface-inset);box-shadow:inset 0 0 0 4px #0002,0 5px 18px #0003}
.eyebrow{font:700 10px var(--g-title-font,serif);letter-spacing:.16em;color:var(--brass)}
.intro{margin-top:0}
.host-status{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 16px;border:1px solid var(--brass-light);border-radius:7px;background:linear-gradient(100deg,#ffffff09,transparent 45%),var(--surface-inset);box-shadow:inset 0 1px #ffffff0a}
.host-status button{margin-left:auto}
.status-copy{display:flex;flex-direction:column;gap:2px}
.status-copy small{font-size:9px;letter-spacing:.13em;color:var(--muted-ink)}
.status-copy strong{font:700 17px var(--g-title-font,serif)}
.quiet-danger{color:#a83a3a}
.status-dot{width:12px;height:12px;border-radius:50%;background:#8a7b66;box-shadow:0 0 0 2px #0002}
.host-status[data-state="running"] .status-dot{background:#3f8a4e;box-shadow:0 0 0 2px #0002,0 0 12px #3f8a4e88}
.host-status[data-state="starting"] .status-dot{background:#c49a2c}
.host-status[data-state="error"] .status-dot{background:#a83a3a}
.server-vitals{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin:10px 0 14px}
.server-vitals>button{--tone:var(--g-gold-lo);display:grid;grid-template-columns:32px minmax(0,1fr);grid-template-rows:auto auto;column-gap:8px;align-items:center;min-height:0;padding:10px 12px;text-align:left;border:1px solid color-mix(in srgb,var(--brass-light) 70%,transparent);border-radius:6px;background:linear-gradient(90deg,color-mix(in srgb,var(--tone) 14%,transparent),transparent 70%),#0000000b;box-shadow:inset 3px 0 var(--tone);font:inherit;color:inherit;cursor:pointer}
.server-vitals>button:disabled{cursor:default;opacity:1}
.server-vitals>button:not(:disabled):hover{border-color:var(--g-gold-lo)}
.server-vitals>button[data-tone="ok"]{--tone:var(--g-good)}
.server-vitals>button[data-tone="warn"]{--tone:var(--g-warn)}
.server-vitals>button[data-tone="bad"]{--tone:var(--g-bad)}
.server-vitals>button[data-tone="off"]{--tone:var(--g-text-faint)}
.server-vitals>button>svg{grid-row:1/3;align-self:center;justify-self:center;color:var(--tone)}
.server-vitals small{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted-ink)}
.server-vitals strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.server-vitals>button[data-tone="bad"] strong{color:var(--g-bad)}
.section-note{margin:8px 0 2px}
.setting-card{display:flex;align-items:center;gap:11px;margin:8px 0 3px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--brass-light) 65%,transparent);border-radius:5px;background:#0000000d;cursor:pointer}
.setting-card[data-on="true"]{border-color:color-mix(in srgb,var(--g-good) 55%,var(--brass-light));background:linear-gradient(90deg,color-mix(in srgb,var(--g-good) 10%,transparent),transparent)}
.setting-card[data-warning="true"]{border-color:color-mix(in srgb,var(--g-bad) 60%,var(--brass-light));background:linear-gradient(90deg,color-mix(in srgb,var(--g-bad) 10%,transparent),transparent)}
.setting-card>span{display:flex;flex-direction:column;gap:2px}
.setting-card strong{font-size:14px}
.setting-card small,.setting-note{color:var(--muted-ink)}
.setting-note{display:block;margin:0 12px 8px 37px}
.link-button{min-height:auto;padding:0;border:0;background:none;box-shadow:none;color:inherit;text-decoration:underline;font-weight:600}
@media (max-width:720px){.host-hero{align-items:flex-start}.host-crest{width:44px;height:44px}}

.host-panel{border-radius:12px;padding:26px;isolation:isolate}
.host-panel::before{height:300px;background:radial-gradient(ellipse at 10% 0,color-mix(in srgb,var(--brass) 20%,transparent),transparent 65%)}
.host-panel::after{display:none}
.host-panel .host-hero{gap:20px;padding:8px 0 24px;margin-bottom:20px;flex-wrap:nowrap}
.host-hero>div:nth-child(2){flex:1;min-width:0}
.host-panel .host-hero h2{font-size:clamp(24px,3.3vw,36px);line-height:1.2;border:0;padding:0;margin:8px 0 12px}
.host-panel .eyebrow{font:600 10px/1.4 var(--g-body-font,'Segoe UI',sans-serif);letter-spacing:2px}
.host-panel .intro{font:13px/1.7 var(--g-body-font,'Segoe UI',sans-serif);max-width:620px;margin:0}
.host-panel .intro button{font:inherit}
.host-panel .host-crest{width:72px;height:84px;border-radius:38px 38px 18px 18px;color:var(--brass);background:radial-gradient(ellipse at 50% 80%,color-mix(in srgb,var(--brass) 25%,transparent),transparent 70%),var(--surface-inset);box-shadow:inset 0 0 0 5px color-mix(in srgb,var(--brass) 10%,transparent),0 8px 28px #0002}
.host-sigil{position:relative;display:grid;place-items:center;flex:none;width:136px;height:120px;color:var(--brass);opacity:.55;border:1px solid var(--brass-light);border-radius:70px 70px 4px 4px;background:repeating-linear-gradient(90deg,transparent 0 21px,color-mix(in srgb,var(--brass) 12%,transparent) 21px 22px)}
.host-sigil::before{content:'';position:absolute;inset:7px;border:1px solid var(--brass-light);border-radius:inherit}
.host-sigil span{position:absolute;bottom:-9px;background:var(--input-bg);padding:0 8px;font-size:13px}
.host-panel .host-status{padding:16px 20px;border-radius:8px;border-color:color-mix(in srgb,var(--brass) 55%,transparent)}
.status-copy{min-width:0}
.status-copy strong{overflow-wrap:anywhere}
.invite-banner{display:flex;align-items:center;gap:16px;padding:20px;margin-top:12px;border:1px dashed var(--brass-light);border-radius:8px;background:linear-gradient(105deg,color-mix(in srgb,var(--brass) 8%,transparent),transparent)}
.invite-banner>svg{flex:none;color:var(--brass)}
.invite-copy{display:flex;flex-direction:column;gap:5px;flex:1;min-width:0}
.invite-copy .eyebrow{font-size:9px;margin:0}
.invite-copy>strong{font-size:16px}
.invite-copy .invite-address{font:600 16px/1.5 Consolas,monospace;overflow-wrap:anywhere;user-select:all}
.invite-copy small{font:12px/1.5 var(--g-body-font,'Segoe UI',sans-serif);margin:0}
.invite-banner button{flex:none;font-size:12px;padding:10px 14px}
.host-panel .server-vitals{gap:12px;margin:16px 0 28px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.host-panel .server-vitals>button{padding:16px 12px;row-gap:6px;border-radius:8px;box-shadow:inset 0 -2px var(--tone);background:linear-gradient(0deg,color-mix(in srgb,var(--tone) 8%,transparent),transparent),var(--surface-inset)}
.host-panel .server-vitals small{margin:0;font:600 9px/1.4 var(--g-body-font,'Segoe UI',sans-serif);letter-spacing:1.1px}
.host-panel .server-vitals strong{white-space:normal;font:600 12px/1.5 var(--g-body-font,'Segoe UI',sans-serif)}
.server-workspace{display:grid;gap:24px}
.host-panel-full .server-workspace{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)}
.server-column{min-width:0}
.column-heading{display:flex;align-items:center;gap:9px;margin:0 0 14px;color:var(--brass)}
.column-heading h3{font:17px/1.4 var(--g-title-font,Georgia,serif);color:var(--ink)}
.column-heading>span{margin-left:auto;color:var(--muted-ink);font:12px Georgia,serif}
.host-panel :deep(.server-section){margin:0 0 12px}
.host-panel :deep(.section-body){font:13px/1.65 var(--g-body-font,'Segoe UI',sans-serif)}
.host-panel :deep(.section-body button){font-size:12px;line-height:1.45}
.host-panel :deep(.section-body input:not([type=checkbox]):not([type=radio])),.host-panel :deep(.section-body select){min-width:0;max-width:100%;font:13px/1.4 var(--g-body-font,'Segoe UI',sans-serif)}
.host-panel .setting-card{padding:12px;gap:12px;margin-top:12px;border-radius:6px}
.setting-card input{flex:none;width:17px;height:17px;accent-color:var(--brass)}
.host-panel .setting-card strong{font:600 13px/1.4 var(--g-body-font,'Segoe UI',sans-serif)}
.host-panel .setting-card small{font:12px/1.5 var(--g-body-font,'Segoe UI',sans-serif);margin-top:3px}
.host-panel .setting-note{font:11px/1.6 var(--g-body-font,'Segoe UI',sans-serif);margin:6px 8px 12px 42px}
.host-panel code{overflow-wrap:anywhere}
.host-panel button:focus-visible{outline:2px solid var(--brass);outline-offset:3px}
@media (max-width:1100px){.host-panel-full .server-workspace{grid-template-columns:1fr}.host-sigil{display:none}.host-panel .server-vitals{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:600px){.host-panel .host-hero{gap:12px;align-items:flex-start}.host-panel .host-crest{width:46px;height:56px}.invite-banner{flex-wrap:wrap;padding:14px;gap:12px}.invite-copy{flex-basis:calc(100% - 42px)}.invite-banner button{margin-left:38px}.host-panel .host-status{padding:14px}.host-status button{width:100%;margin:4px 0 0}.host-panel .server-vitals>button{grid-template-columns:24px minmax(0,1fr);padding:12px 8px;column-gap:6px}}
@media(max-width:600px){.host-panel{padding:16px}}
</style>
