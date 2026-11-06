import { computed } from 'vue';

import type { SectionTone } from '../components/connection/ServerSection.vue';
import { tn } from '../i18n/i18n';
import {
  firewall,
  firewallSummary,
  hostAutoStart,
  hostConnections,
  hostLanMode,
  hostLanTls,
  hostNetwork,
  hostRunning,
  hostSettings,
  hostStatus,
  internetAddresses,
  playerAddresses,
  tunnelStatus,
} from './hostStore';

export type Signal = { status: string; tone: SectionTone; summary: string };

export function useHostSignals() {
  const statusText = computed(() => ({
    stopped: 'Остановлен',
    starting: hostStatus.value.message || 'Запускается…',
    running: `Работает · порт ${hostStatus.value.port}`,
    error: 'Ошибка',
  }[hostStatus.value.state]));

  const serviceAddresses = computed(() =>
    hostStatus.value.addresses.filter(address => address.kind === 'other'),
  );
  const hasVpn = computed(() => playerAddresses.value.some(address => address.kind === 'vpn'));
  const onlinePlayers = computed(() => hostConnections.value?.connections.filter(entry => entry.online && !entry.fromThisComputer).length ?? 0);
  const accessSummary = computed(() => {
    if (!hostRunning.value) return 'Доступ закрыт';
    if (!hostLanMode.value && !internetAddresses.value.length) return 'Только этот компьютер';
    if (internetAddresses.value.length) return 'Локальная сеть и интернет';
    return 'Локальная сеть или VPN';
  });
  const sharedAddress = computed(() => hostRunning.value ? internetAddresses.value[0]?.url ?? (hostLanMode.value ? playerAddresses.value[0]?.url : undefined) : undefined);
  const securitySummary = computed(() => hostLanTls.value ? 'Шифрование TLS' : 'Без шифрования');

  const onOff = (value: boolean) => (value ? 'вкл.' : 'выкл.');
  function addressCount(count: number) {
    return tn(count, '{n} адрес|{n} адреса|{n} адресов');
  }

  const accessTone = computed<SectionTone>(() => {
    if (!hostRunning.value) return 'off';
    return !hostLanMode.value && !internetAddresses.value.length ? 'warn' : 'ok';
  });
  const securityTone = computed<SectionTone>(() => {
    if (!hostRunning.value || (!hostLanMode.value && !internetAddresses.value.length)) return 'off';
    return hostLanTls.value ? 'ok' : 'bad';
  });

  const basicSignal = computed<Signal>(() => {
    const summary = `Сеть: ${onOff(hostLanMode.value)} · TLS: ${onOff(hostLanTls.value)} · автозапуск: ${onOff(hostAutoStart.value)}`;
    if (!hostLanMode.value) return { status: 'только этот компьютер', tone: 'off', summary };
    if (!hostLanTls.value) return { status: 'без шифрования', tone: 'bad', summary };
    return { status: 'сеть и TLS', tone: 'ok', summary };
  });

  const internetSignal = computed<Signal>(() => {
    const network = hostNetwork.value;
    const tunnel = tunnelStatus.value;
    const tunnelOn = (network?.tunnelMode ?? 'off') !== 'off';
    const ways = [
      ...(tunnelOn ? [network?.tunnelMode === 'named' ? 'постоянный туннель' : 'быстрый туннель'] : []),
      ...(network?.publicMode ? ['белый IP'] : []),
    ];
    if (!ways.length) return { status: 'выключено', tone: 'off', summary: 'Туннель Cloudflare или белый IP — для игроков без общей сети и VPN' };
    const openRegistration = Boolean(hostSettings.value?.openRegistration);
    const summary = [ways.join(' + '), tunnel?.url ?? '', openRegistration ? 'регистрация без приглашения' : ''].filter(Boolean).join(' · ');
    if (!hostRunning.value) return { status: 'ждёт запуска сервера', tone: 'off', summary };
    if (tunnelOn && tunnel?.state === 'error') return { status: 'ошибка туннеля', tone: 'bad', summary };
    if (tunnelOn && tunnel?.state === 'starting') return { status: 'подключается…', tone: 'warn', summary };
    if (tunnelOn && tunnel?.check && !tunnel.check.ok) return { status: 'не отвечает', tone: 'warn', summary };
    if (openRegistration) return { status: 'регистрация открыта', tone: 'warn', summary };
    return internetAddresses.value.length ? { status: 'работает', tone: 'ok', summary } : { status: 'нет адреса', tone: 'warn', summary };
  });

  const addressesSignal = computed<Signal>(() => {
    if (!hostLanMode.value && !internetAddresses.value.length) {
      return { status: 'игроки не войдут', tone: 'warn', summary: 'Сервер принимает подключения только с этого компьютера' };
    }
    const total = playerAddresses.value.length + internetAddresses.value.length;
    if (!total) return { status: 'нет адреса', tone: 'warn', summary: 'Компьютер не подключён ни к домашней, ни к виртуальной локальной сети' };
    const best = internetAddresses.value[0]?.url ?? playerAddresses.value[0]?.url;
    return { status: addressCount(total), tone: hostStatus.value.tls ? 'ok' : 'warn', summary: `Лучше всего: ${best} — или приглашение на вкладке «Кампании»` };
  });

  const showFirewall = computed(() =>
    hostRunning.value && firewallSummary.value !== 'na' && (hostLanMode.value || internetAddresses.value.length > 0),
  );
  const firewallSignal = computed<Signal>(() => {
    if (firewallSummary.value === 'ok') return { status: 'пропускает', tone: 'ok', summary: 'Подключения игроков проходят по всем адресам' };
    if (firewallSummary.value === 'blocked') return { status: 'блокирует', tone: 'bad', summary: 'Часть адресов закрыта — нажмите «Разрешить в брандмауэре»' };
    return { status: firewall.value ? 'не проверен' : 'проверяю…', tone: 'warn', summary: 'Если игроки не могут подключиться — «Разрешить в брандмауэре»' };
  });

  const playersSignal = computed<Signal>(() => ({
    status: onlinePlayers.value ? `на связи: ${onlinePlayers.value}` : 'никого',
    tone: onlinePlayers.value ? 'ok' : 'off',
    summary: 'Кто подключён, откуда и где сейчас; последние попытки входа',
  }));

  const firewallCheckedAt = computed(() =>
    firewall.value && firewall.value.supported && firewall.value.known
      ? new Date(firewall.value.checkedAt).toLocaleTimeString('ru-RU')
      : null,
  );


  return {
    statusText, serviceAddresses, hasVpn, onlinePlayers, accessSummary, sharedAddress, securitySummary, accessTone,
    securityTone, basicSignal, internetSignal, addressesSignal, showFirewall, firewallSignal, playersSignal, firewallCheckedAt,
  };
}
