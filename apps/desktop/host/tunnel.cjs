const {app, net} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const {spawn, execFile} = require('node:child_process');
const {createTunnelProcs} = require('./tunnel-procs.cjs');

const DOWNLOAD_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const LOG_LINES = 60;

let child = null;
let state = {state: 'off', mode: 'off', url: null, message: '', check: null};
let procs = null;
function tunnelProcs() {
  if (!procs) procs = createTunnelProcs({pidFile: path.join(app.getPath('userData'), 'tunnel.pid')});
  return procs;
}
process.on('exit', () => procs?.killAllSync());
let queue = Promise.resolve();
function serial(work) {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}
let log = [];
let download = null;

function binDir() {
  return path.join(app.getPath('userData'), 'bin');
}

function ownBinary() {
  return path.join(binDir(), process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}

function run(file, args, timeout = 15000) {
  return new Promise(resolve => {
    execFile(file, args, {windowsHide: true, timeout}, (error, stdout, stderr) => resolve({error, stdout: String(stdout), stderr: String(stderr)}));
  });
}

async function findCloudflared() {
  if (fs.existsSync(ownBinary())) return ownBinary();
  const {error, stdout} = await run(process.platform === 'win32' ? 'where.exe' : 'which', ['cloudflared'], 5000);
  if (error) return null;
  const first = stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean);
  return first && fs.existsSync(first) ? first : null;
}

async function cloudflaredInfo() {
  const file = await findCloudflared();
  if (!file) return {found: false, path: null, version: null, own: false};
  const {stdout, stderr} = await run(file, ['--version'], 10000);
  const version = /version\s+([0-9][\w.-]*)/i.exec(`${stdout} ${stderr}`)?.[1] ?? null;
  return {found: true, path: file, version, own: file === ownBinary()};
}

async function verifySignature(file) {
  if (process.platform !== 'win32') return {ok: true, signer: null};
  const script = `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "$($s.Status)|$($s.SignerCertificate.Subject)"`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const {error, stdout} = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], 30000);
  if (error) return {ok: false, signer: null};
  const [status, signer = ''] = stdout.trim().split('|');
  return {ok: status === 'Valid' && /cloudflare/i.test(signer), signer: signer || null, status};
}

async function downloadCloudflared() {
  if (download?.active) throw new Error('cloudflared уже скачивается.');
  download = {active: true, received: 0, total: null, error: null};
  const target = ownBinary();
  const partial = `${target}.download`;
  try {
    await fsp.mkdir(binDir(), {recursive: true});
    const response = await net.fetch(DOWNLOAD_URL, {redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000)});
    if (!response.ok || !response.body) throw new Error(`GitHub ответил ${response.status}. Попробуйте позже.`);
    download.total = Number(response.headers.get('content-length')) || null;
    const out = fs.createWriteStream(partial);
    const reader = response.body.getReader();
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        download.received += value.byteLength;
        if (!out.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength))) await new Promise(resolve => out.once('drain', resolve));
      }
    } finally {
      await new Promise(resolve => out.end(resolve));
    }
    if (download.received < 5 * 1024 * 1024) throw new Error('Скачанный файл слишком мал — это не cloudflared.');
    const signature = await verifySignature(partial);
    if (!signature.ok) throw new Error('У скачанного файла нет действительной подписи Cloudflare — он удалён. Попробуйте ещё раз позже.');
    await fsp.rm(target, {force: true});
    await fsp.rename(partial, target);
    download = {active: false, received: download.received, total: download.total, error: null};
    return cloudflaredInfo();
  } catch (error) {
    await fsp.rm(partial, {force: true}).catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    download = {active: false, received: download?.received ?? 0, total: download?.total ?? null, error: /fetch|net::|ERR_/i.test(message) ? `Не удалось скачать cloudflared с GitHub: ${message}` : message};
    throw new Error(download.error);
  }
}

function remember(line) {
  const text = line.replace(/\s+$/, '');
  if (!text) return;
  log.push(text.replace(/eyJ[A-Za-z0-9_-]{20,}/g, '«токен»'));
  if (log.length > LOG_LINES) log = log.slice(-LOG_LINES);
}

async function checkUrl(url, attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const started = Date.now();
    try {
      const response = await net.fetch(`${url}/health`, {credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000)});
      const info = await response.json().catch(() => null);
      if (response.ok && info?.status === 'ok') return {ok: true, latencyMs: Date.now() - started, at: Date.now()};
    } catch {
    }
    if (!child) return {ok: false, at: Date.now(), message: 'Туннель остановлен.'};
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  return {
    ok: false, at: Date.now(),
    message: 'Туннель запущен, но сервер по его адресу не отвечает отсюда. Возможно, провайдер ограничивает Cloudflare — нажмите «Проверить Cloudflare на этом компьютере».',
  };
}

function startTunnel(options) {
  return serial(() => startTunnelNow(options));
}
async function startTunnelNow(options) {
  await stopTunnelNow();
  const file = await findCloudflared();
  if (!file) {
    state = {state: 'error', mode: options.mode, url: null, message: 'cloudflared не найден — нажмите «Скачать cloudflared».', check: null};
    return getTunnelStatus();
  }
  if (options.mode === 'named' && !options.token) {
    state = {state: 'error', mode: 'named', url: null, message: 'Для постоянного туннеля нужен токен из панели Cloudflare.', check: null};
    return getTunnelStatus();
  }
  log = [];
  const protocol = options.protocol === 'http2' ? 'http2' : 'auto';
  const args = options.mode === 'quick'
    ? ['tunnel', '--no-autoupdate', '--protocol', protocol, '--url', `http://127.0.0.1:${options.port}`]
    : ['tunnel', '--no-autoupdate', '--protocol', protocol, 'run'];
  // A quick tunnel fails with a config.yml in the profile, so cloudflared gets its own home in the data folder; the named tunnel token goes via the environment.
  const home = path.join(app.getPath('userData'), 'tunnel-home');
  await fsp.mkdir(home, {recursive: true});
  const env = {
    ...process.env,
    ...(options.mode === 'quick' ? {USERPROFILE: home, HOME: home} : {TUNNEL_TOKEN: options.token}),
  };
  state = {state: 'starting', mode: options.mode, url: options.mode === 'named' ? options.publicUrl ?? null : null, message: 'Подключаюсь к Cloudflare…', check: null};
  const proc = spawn(file, args, {env, windowsHide: true});
  child = proc;
  tunnelProcs().track(proc);
  let buffer = '';
  let registered = false;
  const onOutput = chunk => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      remember(line);
      if (child !== proc) continue;
      const quick = options.mode === 'quick' ? QUICK_URL.exec(line)?.[0] : null;
      if (quick && !state.url) {
        state = {...state, url: quick.toLowerCase(), message: 'Адрес получен, проверяю…'};
      }
      if (/Registered tunnel connection/i.test(line)) registered = true;
      if (registered && state.state === 'starting' && (state.url || options.mode === 'named')) {
        state = {...state, state: 'running', message: ''};
        if (state.url) void checkUrl(state.url).then(check => { if (child === proc) state = {...state, check}; });
      }
      if (/429 Too Many Requests|failed to request quick Tunnel/i.test(line) && state.state === 'starting') {
        state = {...state, message: 'Cloudflare не выдал быстрый туннель (слишком много запросов) — подождите минуту и перезапустите.'};
      }
      if (/Unauthorized|Invalid tunnel secret|token is not valid/i.test(line)) {
        state = {...state, state: 'error', message: 'Cloudflare не принял токен туннеля — скопируйте его заново из панели.'};
      }
    }
  };
  proc.stdout.on('data', onOutput);
  proc.stderr.on('data', onOutput);
  proc.once('error', error => {
    if (child !== proc) return;
    child = null;
    state = {...state, state: 'error', message: `cloudflared не запустился: ${error.message}`};
  });
  proc.once('exit', code => {
    if (child !== proc) return;
    child = null;
    state = state.state === 'error'
      ? state
      : {...state, state: 'error', message: `cloudflared завершился (код ${code ?? '—'}). Последние строки — в журнале туннеля.`};
  });
  return getTunnelStatus();
}

function stopTunnel() {
  return serial(stopTunnelNow);
}
async function stopTunnelNow() {
  child = null;
  state = {state: 'off', mode: 'off', url: null, message: '', check: null};
  await tunnelProcs().killAll();
  return getTunnelStatus();
}

function cleanupStaleTunnels() {
  try {
    return tunnelProcs().cleanupStale();
  } catch {
    return 0;
  }
}

async function recheckTunnel() {
  if (!state.url || state.state !== 'running') return getTunnelStatus();
  state = {...state, check: await checkUrl(state.url, 2)};
  return getTunnelStatus();
}

function getTunnelStatus() {
  return {...state, log: [...log], download: download ? {...download} : null};
}

module.exports = {cloudflaredInfo, downloadCloudflared, startTunnel, stopTunnel, recheckTunnel, getTunnelStatus, findCloudflared, cleanupStaleTunnels};
