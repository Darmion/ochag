const os = require('node:os');
const {execFile} = require('node:child_process');

const GAME_VPN_PATTERN = /radmin|hamachi|zerotier|tailscale/i;

// Service adapters (VMs, WSL/Docker, VPN and proxy tunnels) are not offered as the LAN address.
const SERVICE_PATTERN = /vethernet|hyper-v|virtualbox|vmware|vmnet|wsl|docker|loopback|\btun\b|-tun|tun\d|\btap\b|tap-|wintun|throne|nekoray|clash|v2ray|xray|sing-?box|outline|proxy|wireguard|openvpn|nordvpn|proton|vpn/i;

function classifyAddress(name, address) {
  if (GAME_VPN_PATTERN.test(name) || /^2[56]\./.test(address)) return 'vpn';
  if (SERVICE_PATTERN.test(name)) return 'other';
  return 'lan';
}

const KIND_ORDER = {vpn: 0, lan: 1, other: 2};

function listAddresses(port, scheme = 'http') {
  const result = [];

  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;

      result.push({
        url: `${scheme}://${entry.address}:${port}`,
        ip: entry.address,
        interfaceName: name,
        kind: classifyAddress(name, entry.address),
      });
    }
  }

  return result.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

function isLoopbackUrl(value) {
  try {
    const {hostname} = new URL(value);
    return hostname === 'localhost' || hostname === '[::1]' || hostname.startsWith('127.');
  } catch {
    return false;
  }
}

function ownAddresses() {
  return new Set(listAddresses(0).map(entry => entry.ip));
}

function pointsToThisComputer(value) {
  try {
    const {hostname} = new URL(value);
    return isLoopbackUrl(value) || ownAddresses().has(hostname);
  } catch {
    return false;
  }
}

// net.fetch reports Chromium network errors as «net::ERR_…»; map them to a cause and a fix.
function describeNetworkError(error, target) {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const where = target ? ` (${target})` : '';

  if (/CONNECTION_REFUSED|ECONNREFUSED/.test(text)) {
    return {
      code: 'refused',
      message: `Компьютер по этому адресу доступен, но сервер игры на нём не отвечает${where}.`,
      hints: [
        'Мастер ещё не нажал «Запустить сервер» или сервер остановлен.',
        'У мастера не включено «Подключения игроков по сети» — тогда сервер принимает подключения только с его собственного компьютера.',
        'Неверный порт: сверьте число после двоеточия с адресом, который показывает приложение мастера.',
      ],
    };
  }

  if (/StallError|download stalled/.test(text)) {
    return {
      code: 'stalled',
      message: `Файл перестал скачиваться посреди передачи${where}: полминуты не пришло ни байта.`,
      hints: [
        'Сеть до мастера медленная или рвётся (виртуальная сеть, Wi-Fi): приложение попробует ещё раз само; файлы, скачанные целиком, оно запоминает.',
        'Большие файлы (музыка, карты) лучше ужимать: MP3 128–192 кбит/с или OGG весят в 2–3 раза меньше.',
      ],
    };
  }

  if (/TIMED_OUT|TimeoutError|AbortError|aborted|timed out|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ADDRESS_UNREACHABLE|NETWORK_UNREACHABLE|INTERNET_DISCONNECTED/i.test(text)) {
    return {
      code: 'timeout',
      message: `Компьютер по этому адресу не отвечает${where}.`,
      hints: [
        'Брандмауэр Windows на компьютере мастера блокирует подключение — мастеру нужно нажать «Разрешить в брандмауэре» в разделе «Сервер».',
        'Виртуальная локальная сеть не подключена у вас или у мастера: оба компьютера должны быть в одной сети.',
        'Опечатка в IP-адресе: сверьте его с адресом в приглашении.',
      ],
    };
  }

  if (/ERR_CERT_|ERR_SSL_|CERTIFICATE|SELF_SIGNED/i.test(text)) {
    return {
      code: 'certificate',
      message: `Сертификат сервера не подтверждён${where}.`,
      hints: [
        'Подключитесь заново через экран входа: там можно сверить код сертификата с экраном мастера и доверять серверу.',
        'Если мастер переустановил приложение или сменил компьютер, код у него новый — сверьте его ещё раз.',
      ],
    };
  }

  if (/NAME_NOT_RESOLVED|ENOTFOUND/.test(text)) {
    return {
      code: 'dns',
      message: `Такого имени компьютера не существует${where}.`,
      hints: ['Укажите IP-адрес мастера цифрами, например http://26.34.12.5:3000.'],
    };
  }

  if (/Некорректный адрес|Адрес должен|Укажите только адрес|Invalid URL/.test(text)) {
    return {
      code: 'address',
      message: error instanceof Error ? error.message : 'Некорректный адрес сервера.',
      hints: ['Адрес выглядит так: http://26.34.12.5:3000 — протокол, IP мастера и порт.'],
    };
  }

  return {
    code: 'unknown',
    message: `Не удалось связаться с сервером${where}: ${error instanceof Error ? error.message : String(error)}`,
    hints: ['Проверьте адрес и что сервер мастера запущен.'],
  };
}

const RULE_NAME = 'Ochag Server';
const OLD_RULE_NAMES = ['TTRPG Server'];
const ruleNames = () => [RULE_NAME, ...OLD_RULE_NAMES].map(psQuote).join(',');

function runPowerShell(script, timeout = 30000) {
  return new Promise(resolve => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {windowsHide: true, timeout},
      (error, stdout, stderr) => resolve({error, stdout: String(stdout), stderr: String(stderr)}),
    );
  });
}

const psQuote = value => `'${String(value).replace(/'/g, "''")}'`;

async function firewallStatus(port, programPath) {
  if (process.platform !== 'win32') return {supported: false};

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$target = ${psQuote(programPath)}
function Describe($rule) {
  $pf = $rule | Get-NetFirewallPortFilter
  [pscustomobject]@{ name = [string]$rule.DisplayName; action = [string]$rule.Action; profile = [string]$rule.Profile; protocol = [string]$pf.Protocol; port = [string](@($pf.LocalPort) -join ',') }
}
$portRules = @(Get-NetFirewallRule -DisplayName ${ruleNames()} -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' } | ForEach-Object { Describe $_ })
$filters = @(Get-NetFirewallApplicationFilter | Where-Object { $_.Program -and [Environment]::ExpandEnvironmentVariables($_.Program) -ieq $target })
$appRules = @($filters | Get-NetFirewallRule | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' } | ForEach-Object { Describe $_ })
$nets = @(Get-NetConnectionProfile | ForEach-Object { [pscustomobject]@{ alias = [string]$_.InterfaceAlias; category = [string]$_.NetworkCategory } })
[pscustomobject]@{ portRules = $portRules; appRules = $appRules; nets = $nets } | ConvertTo-Json -Compress -Depth 4
`;

  const {error, stdout} = await runPowerShell(script, 60000);
  if (error) return {supported: true, known: false};

  try {
    const parsed = JSON.parse(stdout.replace(/^﻿/, '').trim());
    const rules = value => [].concat(value ?? []).filter(Boolean).map(rule => ({
      name: String(rule.name ?? ''),
      action: String(rule.action ?? ''),
      profile: String(rule.profile ?? ''),
      protocol: String(rule.protocol ?? 'Any'),
      port: String(rule.port ?? 'Any'),
    }));
    const networks = {};

    for (const net of [].concat(parsed.nets ?? [])) {
      if (net?.alias) networks[net.alias] = String(net.category).replace('Authenticated', '');
    }

    return {
      supported: true,
      known: true,
      port,
      programPath,
      checkedAt: Date.now(),
      portRules: rules(parsed.portRules),
      appRules: rules(parsed.appRules),
      networks,
    };
  } catch {
    return {supported: true, known: false};
  }
}

async function allowThroughFirewall(port, programPath) {
  if (process.platform !== 'win32') return {ok: false, message: 'Доступно только в Windows.'};

  const elevated = `
$ErrorActionPreference = 'Stop'
Get-NetFirewallRule -DisplayName ${ruleNames()} -ErrorAction SilentlyContinue | Remove-NetFirewallRule
$target = ${psQuote(programPath)}
Get-NetFirewallApplicationFilter | Where-Object { $_.Program -and [Environment]::ExpandEnvironmentVariables($_.Program) -ieq $target } | Get-NetFirewallRule | Where-Object { $_.Action -eq 'Block' -and $_.Direction -eq 'Inbound' } | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName ${psQuote(RULE_NAME)} -Description 'Incoming player connections to the Ochag game server' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${Number(port)} -Profile Any | Out-Null
`;
  const inner = Buffer.from(elevated, 'utf16le').toString('base64');

  const launcher = `
try {
  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${inner}'
  exit $p.ExitCode
} catch {
  exit 1223
}
`;

  const {error} = await runPowerShell(launcher, 120000);

  if (!error) return {ok: true, message: `Порт ${port} открыт для входящих подключений во всех сетях.`};
  if (error.code === 1223) return {ok: false, message: 'Запрос прав администратора отклонён — правило не добавлено.'};
  return {ok: false, message: 'Не удалось добавить правило брандмауэра. Сделайте это вручную по инструкции в «Справке».'};
}

module.exports = {
  listAddresses,
  isLoopbackUrl,
  pointsToThisComputer,
  describeNetworkError,
  firewallStatus,
  allowThroughFirewall,
};
