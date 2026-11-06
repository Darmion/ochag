<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { copyText } from '../../connection/connection';
import { confirmAction } from '../../ui/confirmDialog';
import GameIcon from '../game/GameIcon.vue';
import {
  checkPublic,
  cloudflaredInfo,
  cloudflareTest,
  cloudflareTesting,
  describeCloudflareTest,
  downloadCloudflared,
  hostNetwork,
  hostRunning,
  hostSettings,
  hostStatus,
  networkBusy,
  networkError,
  publicStatus,
  recheckTunnel,
  refreshNetwork,
  restartTunnel,
  setOpenRegistration,
  setPublic,
  setTunnel,
  testCloudflare,
  tunnelStatus,
} from '../../connection/hostStore';

const props = defineProps<{ embedded?: boolean }>();

const copied = ref('');
async function copy(text: string) {
  if (await copyText(text)) {
    copied.value = text;
    setTimeout(() => { if (copied.value === text) copied.value = ''; }, 2000);
  }
}

const token = ref('');
const publicUrl = ref('');
const externalPort = ref<number | ''>('');
watch(hostNetwork, network => {
  if (!network) return;
  if (!publicUrl.value) publicUrl.value = network.tunnelPublicUrl ?? '';
  if (externalPort.value === '') externalPort.value = network.publicPort;
}, { immediate: true });

const mode = computed(() => hostNetwork.value?.tunnelMode ?? 'off');
const internetOn = computed(() => mode.value !== 'off' || hostNetwork.value?.publicMode === true);
const validExternalPort = computed(() => {
  const value = Number(externalPort.value);
  return Number.isInteger(value) && value >= 1 && value <= 65535;
});
const modeVersion = ref(0);

async function chooseMode(next: TunnelMode) {
  if (next === 'named' && !hostNetwork.value?.hasTunnelToken && !token.value.trim()) {
    networkError.value = 'Для постоянного туннеля вставьте токен из панели Cloudflare и нажмите «Сохранить и запустить».';
    namedOpen.value = true;
    modeVersion.value += 1;
    return;
  }
  if (mode.value !== 'off' && next !== mode.value) {
    const turnsOff = next === 'off';
    const confirmed = await confirmAction(
      turnsOff
        ? 'Игроки, вошедшие через туннель, потеряют связь. Ссылки из приглашений через этот туннель перестанут работать.'
        : 'Активный туннель будет перезапущен. Игроки на несколько секунд потеряют связь; у быстрого туннеля также может измениться адрес.',
      { title: turnsOff ? 'Выключить интернет-туннель?' : 'Сменить режим туннеля?', confirmLabel: turnsOff ? 'Выключить туннель' : 'Сменить режим', danger: turnsOff },
    );
    if (!confirmed) {
      modeVersion.value += 1;
      return;
    }
  }
  await setTunnel({ mode: next });
  modeVersion.value += 1;
}
const namedOpen = ref(false);
async function saveNamed() {
  const address = publicUrl.value.trim();
  if (address) {
    try {
      const parsed = new URL(address);
      if (parsed.protocol !== 'https:' || !parsed.hostname) throw new Error();
    } catch {
      networkError.value = 'Адрес постоянного туннеля должен начинаться с https:// и содержать имя домена.';
      return;
    }
  }
  await setTunnel({ mode: 'named', ...(token.value.trim() ? { token: token.value.trim() } : {}), publicUrl: address || null });
  token.value = '';
}

async function restartTunnelSafely() {
  if (mode.value === 'quick') {
    const confirmed = await confirmAction(
      'Быстрый туннель получит новый адрес. Старые приглашения могут перестать работать, и подключённым игрокам придётся войти заново.',
      { title: 'Получить новый адрес?', confirmLabel: 'Перезапустить туннель', danger: true },
    );
    if (!confirmed) return;
  }
  await restartTunnel();
}

async function changePublicAccess(event: Event) {
  const input = event.target as HTMLInputElement;
  const enabled = input.checked;
  const confirmed = await confirmAction(
    enabled
      ? 'Сервер станет доступен из интернета через ваш роутер. Приложение включит TLS и попробует настроить порт. Продолжайте только если понимаете, что используете белый IP.'
      : 'Прямой адрес через белый IP перестанет работать. Игроки, подключённые этим способом, потеряют связь.',
    { title: enabled ? 'Открыть прямой доступ?' : 'Закрыть прямой доступ?', confirmLabel: enabled ? 'Открыть доступ' : 'Закрыть доступ', danger: !enabled },
  );
  if (!confirmed) {
    input.checked = Boolean(hostNetwork.value?.publicMode);
    return;
  }
  await setPublic({ enabled });
  input.checked = Boolean(hostNetwork.value?.publicMode);
}

async function saveExternalPort() {
  if (!validExternalPort.value) {
    networkError.value = 'Порт должен быть целым числом от 1 до 65535.';
    return;
  }
  await setPublic({ enabled: true, port: Number(externalPort.value) });
}

async function changeOpenRegistration(event: Event) {
  const input = event.target as HTMLInputElement;
  const enabled = input.checked;
  if (enabled) {
    const confirmed = await confirmAction(
      'Любой человек, который узнает адрес сервера, сможет создать аккаунт без приглашения. Для обычной игры безопаснее оставлять регистрацию по приглашениям.',
      { title: 'Открыть свободную регистрацию?', confirmLabel: 'Разрешить регистрацию', danger: true },
    );
    if (!confirmed) {
      input.checked = false;
      return;
    }
  }
  await setOpenRegistration(enabled);
  input.checked = Boolean(hostSettings.value?.openRegistration);
}

const TUNNEL_STATE = { off: 'выключен', starting: 'подключается…', running: 'работает', error: 'ошибка' } as const;

const download = computed(() => tunnelStatus.value?.download ?? null);
const downloadPercent = computed(() => download.value?.total ? Math.round((download.value.received / download.value.total) * 100) : null);

const VERDICT_TEXT: Record<string, string> = {
  white: '✔ У роутера белый IP — игроки из интернета дойдут до него, если порт проброшен.',
  cgnat: '✖ Провайдер даёт адрес из 100.64.0.0/10 (CGNAT): снаружи до роутера не достучаться. Проброс не поможет — нужен белый IP у провайдера или туннель Cloudflare.',
  'double-nat': '✖ Внешний адрес роутера — частный: перед ним стоит ещё один роутер (модем провайдера) или провайдер не даёт белый IP. Проброс на этом роутере не поможет — нужен белый IP у провайдера (или проброс и на модеме) либо туннель Cloudflare.',
  mismatch: '◐ Адрес роутера и публичный адрес не совпадают: провайдер за NAT или трафик этого компьютера идёт через VPN/прокси. Проверьте у провайдера, белый ли у вас IP.',
  unknown: '? Роутер не ответил по UPnP — белый ли IP, отсюда не выяснить. Сравните внешний адрес в настройках роутера с публичным адресом ниже: совпадают — IP белый.',
};

const manualForward = computed(() => {
  const open = publicStatus.value;
  if (!open || open.mapping) return null;
  return `В настройках роутера пробросьте TCP-порт ${open.port ?? hostStatus.value.port} на ${open.upnp?.localAddress ?? 'IP этого компьютера'}:${hostStatus.value.port}.`;
});

onMounted(() => { void refreshNetwork(); });
watch(hostRunning, () => { void refreshNetwork(); });
</script>

<template>
  <section v-if="hostNetwork" class="network-modes" :class="{ embedded: props.embedded }" :aria-labelledby="props.embedded ? undefined : 'internet-title'" :aria-label="props.embedded ? 'Игроки через интернет' : undefined">
    <p v-if="props.embedded" class="muted embedded-intro">Выберите способ, который подходит вашей сети. Для большинства групп проще быстрый туннель.</p>
    <header v-else class="network-heading">
      <div><span class="network-kicker">ДАЛЬНИЕ ДОРОГИ</span><h3 id="internet-title">Игроки через интернет</h3></div>
      <p class="muted">Выберите способ, который подходит вашей сети. Для большинства групп проще быстрый туннель.</p>
    </header>

    <div class="safety-hint">
      <span aria-hidden="true">◆</span>
      <p><strong>Приглашение безопаснее ручного адреса.</strong><small>Оно содержит нужный адрес и код кампании, поэтому игроку не приходится выбирать сервер самостоятельно.</small></p>
    </div>

    <p v-if="networkError" class="notice error" role="alert">{{ networkError }}</p>

    <div class="mode-card" :data-on="mode !== 'off'">
      <div class="mode-title"><span class="mode-icon" aria-hidden="true"><GameIcon class="inline-icon" name="cloud" :size="18" /></span><div><h4>Туннель Cloudflare</h4><small>Проще · не требует настройки роутера</small></div><span class="mode-state">{{ mode === 'off' ? 'выключен' : 'включён' }}</span></div>
      <p class="muted">
        Приложение само соединяется с Cloudflare и получает адрес <code>https://…</code> — роутер, белый IP и брандмауэр не нужны.
        Трафик игры проходит через Cloudflare.
      </p>
      <div :key="modeVersion" class="mode-choice" role="radiogroup" aria-label="Туннель Cloudflare">
        <label class="checkbox-label"><input type="radio" name="tunnel-mode" :checked="mode === 'off'" :disabled="networkBusy" @change="chooseMode('off')" /> Выключен</label>
        <label class="checkbox-label" title="Без учётной записи Cloudflare; адрес новый при каждом запуске — новое приглашение каждый раз">
          <input type="radio" name="tunnel-mode" :checked="mode === 'quick'" :disabled="networkBusy" @change="chooseMode('quick')" /> Быстрый (адрес меняется при каждом запуске)
        </label>
        <label class="checkbox-label" title="Свой туннель в панели Cloudflare (нужны учётная запись и домен): адрес не меняется">
          <input type="radio" name="tunnel-mode" :checked="mode === 'named'" :disabled="networkBusy" @change="chooseMode('named')" /> Постоянный (свой туннель по токену)
        </label>
      </div>

      <details class="named" :open="namedOpen || mode === 'named'">
        <summary>Постоянный туннель — токен и адрес</summary>
        <ol class="muted steps">
          <li>В панели Cloudflare: Zero Trust → Networks → Tunnels → «Create a tunnel» (Cloudflared).</li>
          <li>Скопируйте токен из команды установки (длинная строка после <code>--token</code>).</li>
          <li>Во вкладке «Public Hostname» добавьте адрес на своём домене, Service — <code>http://localhost:{{ hostNetwork.tunnelPort }}</code>.</li>
        </ol>
        <label>
          Токен туннеля
          <input v-model="token" type="password" autocomplete="off" spellcheck="false" :placeholder="hostNetwork.hasTunnelToken ? 'сохранён — вставьте новый, чтобы заменить' : 'eyJ…'" :disabled="networkBusy" />
        </label>
        <label>
          Адрес для игроков
          <input v-model="publicUrl" placeholder="https://game.example.com" spellcheck="false" :disabled="networkBusy" />
        </label>
        <button type="button" class="primary" :disabled="networkBusy || (!token.trim() && !hostNetwork.hasTunnelToken)" @click="saveNamed">Сохранить и запустить</button>
        <small class="muted">Токен хранится зашифрованным средствами Windows и никуда, кроме Cloudflare, не уходит.</small>
      </details>

      <div v-if="cloudflaredInfo && !cloudflaredInfo.found" class="cloudflared">
        <p class="notice warning">
          Для туннеля нужна программа cloudflared от Cloudflare (≈ 60 МБ). Приложение скачает её с GitHub Cloudflare и проверит подпись.
        </p>
        <button type="button" class="primary" :disabled="networkBusy || download?.active" @click="downloadCloudflared">
          {{ download?.active ? `Скачиваю… ${downloadPercent !== null ? `${downloadPercent} %` : `${Math.round((download.received ?? 0) / 1_000_000)} МБ`}` : 'Скачать cloudflared' }}
        </button>
        <p v-if="download?.error" class="notice error">{{ download.error }}</p>
      </div>
      <p v-else-if="cloudflaredInfo?.found" class="muted small">cloudflared {{ cloudflaredInfo.version ?? '' }} — {{ cloudflaredInfo.own ? 'скачан приложением' : cloudflaredInfo.path }}</p>

      <div v-if="mode !== 'off' && tunnelStatus" class="tunnel-state" :data-state="tunnelStatus.state">
        <p>
          Туннель: <strong>{{ hostRunning ? TUNNEL_STATE[tunnelStatus.state] : 'ждёт запуска сервера' }}</strong>
          <span v-if="tunnelStatus.message"> — {{ tunnelStatus.message }}</span>
        </p>
        <div v-if="tunnelStatus.url" class="address-row">
          <strong class="address">{{ tunnelStatus.url }}</strong>
          <button type="button" @click="copy(tunnelStatus.url)">{{ copied === tunnelStatus.url ? 'Скопировано' : 'Копировать' }}</button>
        </div>
        <p v-if="tunnelStatus.check" class="small" :class="tunnelStatus.check.ok ? 'ok' : 'bad'">
          {{ tunnelStatus.check.ok ? `✔ Сервер отвечает через туннель (${tunnelStatus.check.latencyMs} мс).` : `✖ ${tunnelStatus.check.message ?? 'Сервер не отвечает через туннель.'}` }}
        </p>
        <p v-if="tunnelStatus.state === 'running' && tunnelStatus.mode === 'quick'" class="muted small">
          Адрес быстрого туннеля меняется при каждом запуске сервера — тогда игрокам нужно новое приглашение (сохранённые входы переедут на новый адрес сами).
        </p>
        <div class="actions">
          <button type="button" :disabled="networkBusy || !hostRunning" @click="restartTunnelSafely">{{ mode === 'quick' ? 'Перезапустить (новый адрес)' : 'Перезапустить' }}</button>
          <button v-if="tunnelStatus.url" type="button" :disabled="networkBusy" @click="recheckTunnel">Проверить снова</button>
          <label class="checkbox-label small" title="QUIC (UDP) у части провайдеров не проходит — тогда HTTP/2 по TCP">
            <input type="checkbox" :checked="hostNetwork.tunnelProtocol === 'http2'" :disabled="networkBusy" @change="setTunnel({ mode, protocol: ($event.target as HTMLInputElement).checked ? 'http2' : 'auto' })" />
            только HTTP/2 (если не подключается)
          </label>
        </div>
        <details v-if="tunnelStatus.log.length" class="log">
          <summary>Журнал cloudflared</summary>
          <pre>{{ tunnelStatus.log.slice(-25).join('\n') }}</pre>
        </details>
      </div>

      <div class="cf-test">
        <button type="button" :disabled="cloudflareTesting" @click="testCloudflare">{{ cloudflareTesting ? 'Проверяю…' : 'Проверить Cloudflare на этом компьютере' }}</button>
        <small class="muted">У части провайдеров в России Cloudflare ограничена (обрыв после ≈ 16 КБ). Та же кнопка есть у игроков на экране входа — пусть проверят до игры.</small>
        <p v-if="cloudflareTest" class="small">{{ describeCloudflareTest(cloudflareTest) }}</p>
      </div>
    </div>

    <div class="mode-card advanced-mode" :data-on="hostNetwork.publicMode">
      <div class="mode-title"><span class="mode-icon" aria-hidden="true"><GameIcon class="inline-icon" name="globe" :size="18" /></span><div><h4>Белый IP этого компьютера</h4><small>Для опытных · требует настройки роутера</small></div><span class="mode-state">{{ hostNetwork.publicMode ? 'включён' : 'выключен' }}</span></div>
      <p class="muted">
        Игроки подключаются прямо к вашему роутеру, он передаёт подключение этому компьютеру. Нужен белый IP у провайдера
        и проброс порта на роутере (приложение попробует сделать его само по UPnP). Без посредников, шифрование — сертификатом сервера.
      </p>
      <label class="checkbox-label">
        <input type="checkbox" :checked="hostNetwork.publicMode" :disabled="networkBusy" @change="changePublicAccess" />
        Пускать игроков из интернета на белый IP
      </label>
      <small v-if="!hostNetwork.publicMode" class="muted">Включение перезапустит сервер и включит шифрование (TLS) — без него через интернет нельзя.</small>

      <template v-if="hostNetwork.publicMode">
        <label class="checkbox-label">
          <input type="checkbox" :checked="hostNetwork.publicUpnp" :disabled="networkBusy" @change="setPublic({ enabled: true, upnp: ($event.target as HTMLInputElement).checked })" />
          Пробросить порт на роутере автоматически (UPnP)
        </label>
        <label class="port">
          Внешний порт роутера
          <input v-model.number="externalPort" type="number" min="1" max="65535" :disabled="networkBusy" />
          <button type="button" :disabled="networkBusy || !validExternalPort" @click="saveExternalPort">Сохранить</button>
        </label>

        <div v-if="hostRunning && publicStatus" class="public-state">
          <p v-if="publicStatus.checking" class="muted">Проверяю адрес и роутер…</p>
          <template v-else-if="publicStatus.error">
            <p class="notice error">{{ publicStatus.error }}</p>
          </template>
          <template v-else-if="publicStatus.checkedAt">
            <p>Публичный адрес: <strong>{{ publicStatus.publicIp ?? 'не удалось узнать' }}</strong></p>
            <p v-if="publicStatus.routerIp">Внешний адрес роутера: <strong>{{ publicStatus.routerIp }}</strong></p>
            <p class="verdict" :data-verdict="publicStatus.verdict">{{ VERDICT_TEXT[publicStatus.verdict ?? 'unknown'] }}</p>
            <p v-if="publicStatus.mapMessage" class="small">{{ publicStatus.mapping ? '✔' : '✖' }} {{ publicStatus.mapMessage }}</p>
            <p v-if="manualForward && publicStatus.verdict !== 'cgnat' && publicStatus.verdict !== 'double-nat'" class="muted small">{{ manualForward }}</p>
            <p v-if="publicStatus.ipv6?.length" class="small">
              IPv6 (без NAT и проброса): <code v-for="entry in publicStatus.ipv6" :key="entry.address" class="ipv6">{{ entry.address }}</code>
            </p>
            <p class="muted small">
              Брандмауэр Windows должен пропускать порт {{ hostStatus.port }} и в «общедоступных» сетях — кнопка «Разрешить в брандмауэре» выше открывает его для всех.
              Проверить извне отсюда нельзя (роутер часто не пускает «сам к себе»): попросите игрока подключиться по адресу из приглашения.
            </p>
          </template>
          <button type="button" :disabled="networkBusy || publicStatus.checking" @click="checkPublic">Проверить снова</button>
        </div>
      </template>
    </div>

    <div v-if="internetOn && hostSettings" class="mode-card registration" :data-warning="hostSettings.openRegistration">
      <div class="mode-title"><span class="mode-icon" aria-hidden="true"><GameIcon class="inline-icon" name="person" :size="18" /></span><div><h4>Регистрация через интернет</h4><small>Кто может создавать аккаунты на сервере</small></div></div>
      <label class="checkbox-label">
        <input type="checkbox" :checked="hostSettings.openRegistration" :disabled="networkBusy" @change="changeOpenRegistration" />
        Разрешить регистрацию без приглашения
      </label>
      <small class="muted">
        По умолчанию из интернета (туннель, белый IP) аккаунт создаётся только с кодом приглашения в кампанию — игрок вставляет приглашение и регистрируется.
        В домашней и виртуальной локальной сети регистрация свободная.
      </small>
    </div>
  </section>
</template>

<style scoped>
.network-modes{margin-top:22px;padding-top:18px;border-top:1px solid var(--brass-light)}
.network-modes.embedded{margin-top:0;padding-top:0;border-top:0}
.embedded-intro{margin:8px 0 0}
.network-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:10px}
.network-heading>div{display:flex;flex-direction:column;gap:2px}
.network-heading p{max-width:520px;margin:0;text-align:right}
.network-kicker{font:700 10px var(--g-title-font,serif);letter-spacing:.16em;color:var(--brass)}
.network-modes h3{font-size:19px;margin:0}
.safety-hint{display:flex;align-items:center;gap:11px;margin:10px 0 14px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--brass-light) 70%,transparent);border-radius:6px;background:linear-gradient(90deg,color-mix(in srgb,var(--brass) 10%,transparent),transparent)}
.safety-hint>span{color:var(--brass)}
.safety-hint p,.safety-hint small{display:block;margin:0}
.safety-hint small{margin-top:2px;color:var(--muted-ink)}
.mode-card{position:relative;border:1px solid var(--brass-light);border-radius:8px;padding:14px 16px;margin:10px 0;background:linear-gradient(145deg,#ffffff08,transparent 35%),var(--surface-inset);box-shadow:inset 0 1px #ffffff0a}
.mode-card[data-on="true"]{border-color:color-mix(in srgb,var(--g-good) 70%,var(--brass-light));box-shadow:inset 3px 0 var(--g-good),inset 0 1px #ffffff0a}
.mode-card[data-warning="true"]{border-color:var(--g-bad);box-shadow:inset 3px 0 var(--g-bad)}
.mode-title{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.mode-title>div{display:flex;flex:1;flex-direction:column;gap:1px}
.mode-title h4{margin:0;font-size:17px}
.mode-title small{color:var(--muted-ink)}
.mode-icon{display:grid;place-items:center;width:34px;height:34px;flex:none;border:1px solid var(--brass-light);border-radius:50%;color:var(--brass);background:#0002}
.mode-state{padding:3px 8px;border:1px solid var(--brass-light);border-radius:12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted-ink)}
.mode-card[data-on="true"] .mode-state{border-color:var(--g-good);color:var(--g-good)}
.advanced-mode{margin-top:14px}
.mode-choice{display:flex;flex-direction:column;gap:0;margin:4px 0}
.mode-choice .checkbox-label{margin:2px 0;min-height:30px}
.named{margin:6px 0}
.named summary,.log summary{font-size:15px;font-weight:600}
.named label{display:flex;flex-direction:column;gap:3px;margin:6px 0}
.steps{margin:4px 0 4px 18px;padding:0;font-size:13px}
.tunnel-state{margin-top:8px}
.tunnel-state[data-state="error"] strong{color:var(--g-bad)}
.tunnel-state[data-state="running"] strong{color:var(--g-good)}
.address-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.address{font-family:Consolas,monospace;font-size:16px;word-break:break-all}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px}
.small{font-size:13px}
.ok{color:var(--g-good)}
.bad{color:var(--g-bad)}
.log pre{font-size:11px;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all;background:#0002;padding:6px;border-radius:4px}
.cf-test{margin-top:10px;display:flex;flex-direction:column;gap:4px;align-items:flex-start}
.port{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0}
.port input{width:100px}
.public-state p{margin:4px 0}
.verdict[data-verdict="white"]{color:var(--g-good)}
.verdict[data-verdict="cgnat"],.verdict[data-verdict="double-nat"]{color:var(--g-bad)}
.ipv6{margin-right:8px;font-family:Consolas,monospace}
code{font-family:Consolas,monospace}
@media (max-width:720px){.network-heading{align-items:flex-start;flex-direction:column}.network-heading p{text-align:left}.mode-title{align-items:flex-start}.mode-state{margin-left:auto}.safety-hint{align-items:flex-start}}
</style>
