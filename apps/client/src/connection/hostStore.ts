import { computed, ref, watch } from 'vue';

import { t } from '../i18n/i18n';

const HOSTING_PREF_KEY = 'ttrpg.hostingEnabled';
const AUTOSTART_PREF_KEY = 'ttrpg.hostAutoStart';

function readPref(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
  }
}

export const desktopMode = typeof window !== 'undefined' && Boolean(window.desktop);

export const hostingEnabled = ref(readPref(HOSTING_PREF_KEY, false));
export const hostAutoStart = ref(readPref(AUTOSTART_PREF_KEY, true));
export const hostStatus = ref<HostStatus>({ state: 'stopped', message: '', addresses: [] });
export const hostLanMode = ref(false);
export const hostLanTls = ref(true);
export const hostBusy = ref(false);
export const hostError = ref('');
export const firewall = ref<FirewallStatus | null>(null);
export const firewallBusy = ref(false);
export const firewallMessage = ref('');

watch(hostingEnabled, value => writePref(HOSTING_PREF_KEY, value));
watch(hostAutoStart, value => writePref(AUTOSTART_PREF_KEY, value));

export const hostRunning = computed(() => hostStatus.value.state === 'running');

export const hostLocalUrl = computed(() =>
  hostStatus.value.localUrl ?? (hostStatus.value.port ? `http://127.0.0.1:${hostStatus.value.port}` : null),
);

export const playerAddresses = computed(() =>
  hostStatus.value.addresses.filter(address => address.kind !== 'other'),
);

export const NETWORK_CATEGORY_LABELS: Record<string, string> = {
  Public: 'общедоступная',
  Private: 'частная',
  Domain: 'доменная',
};

function coversProfile(profile: string, category: string) {
  return profile === 'Any' || profile.split(',').map(part => part.trim()).includes(category);
}

function affectsPlayers(rule: FirewallRule, port: number) {
  const protocolOk = rule.protocol === 'Any' || rule.protocol.toUpperCase() === 'TCP';
  const portOk = rule.port === 'Any' || rule.port.split(',').map(part => part.trim()).includes(String(port));
  return protocolOk && portOk;
}

export const hostConnections = ref<HostConnections | null>(null);

export type FirewallVerdict = {
  state: 'ok' | 'blocked' | 'unknown';
  category: string | null;
  reason: string;
  rules: FirewallRule[];
  confirmedBy: string | null;
};

function confirmedPlayer(address: HostAddress): string | null {
  const data = hostConnections.value;
  if (!data) return null;

  const connection = data.connections.find(entry => !entry.fromThisComputer && entry.network === address.interfaceName);
  if (connection) return connection.displayName;

  const event = data.events.find(entry =>
    !entry.fromThisComputer && entry.network === address.interfaceName,
  );
  return event ? `попытка входа «${event.username || '?'}»` : null;
}

export function firewallVerdict(address: HostAddress): FirewallVerdict {
  const status = firewall.value;
  const confirmedBy = confirmedPlayer(address);

  if (!status || !status.supported || !status.known) {
    return confirmedBy
      ? { state: 'ok', category: null, reason: `подтверждено: через этот адрес подключился ${confirmedBy}`, rules: [], confirmedBy }
      : { state: 'unknown', category: null, reason: 'не удалось проверить', rules: [], confirmedBy };
  }

  const category = status.networks[address.interfaceName] ?? null;
  const label = category ? `«${NETWORK_CATEGORY_LABELS[category] ?? category}» сеть` : 'тип сети неизвестен';
  const relevant = [...status.portRules, ...status.appRules].filter(rule => affectsPlayers(rule, status.port));
  const applies = (rule: FirewallRule) => !category || coversProfile(rule.profile, category);
  const blocking = relevant.filter(rule => rule.action === 'Block' && category && coversProfile(rule.profile, category));
  const allowing = relevant.filter(rule => rule.action === 'Allow' && applies(rule));

  if (confirmedBy) {
    return { state: 'ok', category, reason: `подтверждено: через этот адрес подключился ${confirmedBy}`, rules: [...blocking, ...allowing], confirmedBy };
  }

  if (blocking.length) {
    return { state: 'blocked', category, reason: `${label}: приложение запрещено правилом «${blocking[0]!.name}»`, rules: blocking, confirmedBy };
  }

  if (!category) {
    return allowing.some(rule => rule.profile === 'Any')
      ? { state: 'ok', category, reason: `разрешено правилом «${allowing.find(rule => rule.profile === 'Any')!.name}» для всех сетей`, rules: allowing, confirmedBy }
      : { state: 'unknown', category, reason: 'Windows не сообщила тип этой сети', rules: allowing, confirmedBy };
  }

  return allowing.length
    ? { state: 'ok', category, reason: `${label}: разрешено правилом «${allowing[0]!.name}»`, rules: allowing, confirmedBy }
    : { state: 'blocked', category, reason: `${label}: нет правила, разрешающего TCP на порт ${status.port}`, rules: [], confirmedBy };
}

export const firewallSummary = computed<'ok' | 'blocked' | 'unknown' | 'na'>(() => {
  const status = firewall.value;
  if (!status) return 'unknown';
  if (!status.supported) return 'na';

  const verdicts = playerAddresses.value.map(address => firewallVerdict(address).state);
  if (verdicts.includes('blocked')) return 'blocked';
  if (verdicts.length > 0 && verdicts.every(state => state === 'ok')) return 'ok';
  return 'unknown';
});

export async function refreshHostStatus() {
  if (!window.desktop) return;

  hostLanMode.value = await window.desktop.host.getLanMode();
  hostLanTls.value = await window.desktop.host.getLanTls();
  hostStatus.value = await window.desktop.host.status();
}

let pendingStart: Promise<boolean> | null = null;

// The server may start without this window asking (restore, another caller): poll the status until it changes, or the button stays «Starting…».
let statusPoll: ReturnType<typeof setTimeout> | null = null;
watch(hostStatus, status => {
  if (statusPoll || status.state !== 'starting' || pendingStart || !window.desktop) return;
  statusPoll = setTimeout(() => {
    statusPoll = null;
    if (hostStatus.value.state === 'starting' && !pendingStart) void window.desktop!.host.status().then(next => { hostStatus.value = next; });
  }, 1000);
});

export function startHosting(): Promise<boolean> {
  if (!window.desktop) return Promise.resolve(false);
  if (hostRunning.value) return Promise.resolve(true);
  if (pendingStart) return pendingStart;

  const desktop = window.desktop;

  pendingStart = (async () => {
    hostBusy.value = true;
    hostError.value = '';

    try {
      hostStatus.value = { state: 'starting', message: 'Запускаю базу данных…', addresses: [] };
      hostStatus.value = await desktop.host.start();
      void refreshFirewall();
      return hostRunning.value;
    } catch (cause) {
      hostStatus.value = await desktop.host.status().catch(() => ({
        state: 'error' as const,
        message: '',
        addresses: [],
      }));
      hostError.value = cause instanceof Error
        ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        : 'Не удалось запустить сервер. Попробуйте ещё раз.';
      return false;
    } finally {
      hostBusy.value = false;
      pendingStart = null;
    }
  })();

  return pendingStart;
}

export async function stopHosting() {
  if (!window.desktop) return;
  hostBusy.value = true;

  try {
    hostStatus.value = await window.desktop.host.stop();
  } finally {
    hostBusy.value = false;
  }
}

export async function setLanMode(enabled: boolean) {
  if (!window.desktop) return;
  hostBusy.value = true;
  hostError.value = '';

  try {
    hostStatus.value = await window.desktop.host.setLanMode(enabled);
    hostLanMode.value = enabled;
    if (enabled) void refreshFirewall();
  } catch (cause) {
    hostError.value = cause instanceof Error ? cause.message : 'Не удалось переключить доступ по сети. Попробуйте ещё раз.';
    hostLanMode.value = await window.desktop.host.getLanMode();
  } finally {
    hostBusy.value = false;
  }
}

export async function setLanTls(enabled: boolean) {
  if (!window.desktop) return;
  hostBusy.value = true;
  hostError.value = '';

  try {
    hostStatus.value = await window.desktop.host.setLanTls(enabled);
    hostLanTls.value = enabled;
  } catch (cause) {
    hostError.value = cause instanceof Error ? cause.message : 'Не удалось переключить шифрование. Попробуйте ещё раз.';
    hostLanTls.value = await window.desktop.host.getLanTls();
  } finally {
    hostBusy.value = false;
  }
}

export async function refreshFirewall() {
  if (!window.desktop) return;

  try {
    firewall.value = await window.desktop.host.firewallStatus();
  } catch {
    firewall.value = { supported: true, known: false };
  }
}

export async function allowFirewall() {
  if (!window.desktop) return;
  firewallBusy.value = true;
  firewallMessage.value = 'Подтвердите запрос Windows «Разрешить этому приложению вносить изменения?»…';

  try {
    const result = await window.desktop.host.allowFirewall();
    firewallMessage.value = result.message;
    await refreshFirewall();
  } finally {
    firewallBusy.value = false;
  }
}

export const hostNetwork = ref<HostNetwork | null>(null);
export const hostSettings = ref<{ openRegistration: boolean } | null>(null);
export const cloudflaredInfo = ref<{ found: boolean; path: string | null; version: string | null; own: boolean } | null>(null);
export const networkBusy = ref(false);
export const networkError = ref('');
export const cloudflareTest = ref<CloudflareTest | null>(null);
export const cloudflareTesting = ref(false);

export const tunnelStatus = computed(() => hostStatus.value.tunnel ?? null);
export const publicStatus = computed(() => hostStatus.value.public ?? null);

export type InternetAddress = { url: string; kind: 'tunnel' | 'public' | 'ipv6'; label: string; certificate: boolean };
export const internetAddresses = computed<InternetAddress[]>(() => {
  const list: InternetAddress[] = [];
  const tunnel = hostStatus.value.tunnel;
  if (tunnel?.state === 'running' && tunnel.url) {
    list.push({ url: tunnel.url, kind: 'tunnel', label: tunnel.mode === 'named' ? 'постоянный туннель Cloudflare' : 'быстрый туннель Cloudflare', certificate: false });
  }
  const open = hostStatus.value.public;
  if (hostNetwork.value?.publicMode && open) {
    if (open.publicIp && open.verdict !== 'cgnat' && open.verdict !== 'double-nat') {
      list.push({ url: `https://${open.publicIp}:${open.port ?? hostStatus.value.port}`, kind: 'public', label: 'белый IP (через роутер)', certificate: true });
    }
    for (const entry of open.ipv6 ?? []) {
      list.push({ url: `https://[${entry.address}]:${hostStatus.value.port}`, kind: 'ipv6', label: `IPv6 («${entry.interfaceName}»)`, certificate: true });
    }
  }
  return list;
});

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : fallback;

export async function refreshNetwork() {
  if (!window.desktop?.host.getNetwork) return;
  hostNetwork.value = await window.desktop.host.getNetwork();
  cloudflaredInfo.value = await window.desktop.host.cloudflared().catch(() => null);
  hostSettings.value = hostRunning.value ? await window.desktop.host.getSettings().catch(() => null) : null;
}

let networkPoll: ReturnType<typeof setTimeout> | null = null;
function pollNetwork() {
  if (networkPoll || !window.desktop) return;
  const status = hostStatus.value;
  const pending = status.tunnel?.state === 'starting' || status.tunnel?.download?.active || status.public?.checking
    || (status.tunnel?.state === 'running' && status.tunnel.url && !status.tunnel.check);
  if (!pending) return;
  networkPoll = setTimeout(async () => {
    networkPoll = null;
    hostStatus.value = await window.desktop!.host.status();
    pollNetwork();
  }, 1000);
}
watch(hostStatus, pollNetwork);

async function networkAction(run: () => Promise<void>, fallback: string) {
  if (!window.desktop) return;
  networkBusy.value = true;
  networkError.value = '';
  try {
    await run();
  } catch (cause) {
    networkError.value = message(cause, fallback);
  } finally {
    networkBusy.value = false;
    pollNetwork();
  }
}

export function setTunnel(input: { mode: TunnelMode; token?: string; publicUrl?: string | null; protocol?: 'auto' | 'http2' }) {
  return networkAction(async () => {
    const result = await window.desktop!.host.setTunnel(input);
    hostNetwork.value = result.network;
    hostStatus.value = result.status;
  }, 'Не удалось переключить туннель. Попробуйте ещё раз.');
}

export function restartTunnel() {
  return networkAction(async () => { hostStatus.value = await window.desktop!.host.restartTunnel(); }, 'Не удалось перезапустить туннель. Попробуйте ещё раз.');
}

export function recheckTunnel() {
  return networkAction(async () => { hostStatus.value = await window.desktop!.host.recheckTunnel(); }, 'Не удалось проверить туннель. Попробуйте ещё раз.');
}

export function downloadCloudflared() {
  return networkAction(async () => {
    const done = window.desktop!.host.downloadCloudflared();
    const timer = setInterval(async () => { hostStatus.value = await window.desktop!.host.status(); }, 700);
    try {
      cloudflaredInfo.value = await done;
    } finally {
      clearInterval(timer);
      hostStatus.value = await window.desktop!.host.status();
    }
  }, 'Не удалось скачать cloudflared. Попробуйте ещё раз.');
}

export function setPublic(input: { enabled: boolean; upnp?: boolean; port?: number }) {
  return networkAction(async () => {
    const result = await window.desktop!.host.setPublic(input);
    hostNetwork.value = result.network;
    hostStatus.value = result.status;
    hostLanMode.value = result.network.lanMode;
    hostLanTls.value = result.network.lanTls;
    if (input.enabled) void refreshFirewall();
  }, 'Не удалось переключить доступ из интернета. Попробуйте ещё раз.');
}

export function checkPublic() {
  return networkAction(async () => { hostStatus.value = await window.desktop!.host.checkPublic(); }, 'Не удалось проверить белый IP. Попробуйте ещё раз.');
}

export function setOpenRegistration(value: boolean) {
  return networkAction(async () => { hostSettings.value = await window.desktop!.host.setSettings({ openRegistration: value }); }, 'Не удалось сохранить настройку регистрации. Попробуйте ещё раз.');
}

export async function testCloudflare() {
  if (!window.desktop?.cloudflareTest || cloudflareTesting.value) return;
  cloudflareTesting.value = true;
  try {
    cloudflareTest.value = await window.desktop.cloudflareTest();
  } finally {
    cloudflareTesting.value = false;
  }
}

export function describeCloudflareTest(result: CloudflareTest): string {
  const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(bytes < 1_000_000 ? 2 : 1);
  if (result.verdict === 'ok') return t('✔ Cloudflare доступна: 5 МБ за {seconds} с ({speed} МБ/с) — туннель должен работать.', { seconds: result.seconds, speed: megabytes(result.bytesPerSecond) });
  if (result.verdict === 'slow') return t('◐ Cloudflare медленная: {got} из 5 МБ за {seconds} с — играть можно, но карты и музыка будут грузиться долго.', { got: megabytes(result.received), seconds: result.seconds });
  if (result.verdict === 'throttled') return t('✖ Провайдер обрывает Cloudflare: пришло только {kb} КБ из 5 МБ. Через туннель играть не получится — нужен VPN/прокси или другой способ (домашняя или виртуальная локальная сеть, белый IP).', { kb: Math.round(result.received / 1024) });
  return result.error
    ? t('✖ Cloudflare недоступна отсюда ({error}) — туннель не заработает.', { error: result.error })
    : t('✖ Cloudflare недоступна отсюда — туннель не заработает.');
}
