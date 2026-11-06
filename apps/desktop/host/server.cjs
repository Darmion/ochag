// Runs migrate.ts, provision.ts and the server as children of Electron's own Node (ELECTRON_RUN_AS_NODE): no separate Node.js install.
const {app, net, safeStorage} = require('electron');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {listAddresses} = require('./network.cjs');
const {currentVersion, updatesDir} = require('./updates.cjs');
const {ensureServerCertificate} = require('./tls.cjs');
const tunnel = require('./tunnel.cjs');
const {bundledModsDir, enabledBundledMods} = require('./bundled-mods.cjs');
const publicNet = require('./public.cjs');

const STOPPED = {state: 'stopped', message: '', addresses: []};

let child = null;
let status = STOPPED;
let scheme = 'http';

function usesTls(config) {
  return (config.lanMode === true && config.lanTls !== false) || config.publicMode === true;
}

function listenHost(config) {
  if (config.publicMode) return '::';
  return config.lanMode ? '0.0.0.0' : '127.0.0.1';
}

let publicStatus = null;
let publicChecking = null;

// net.fetch, not Node fetch: Chromium accepts the server's own certificate by fingerprint (host/tls.cjs).
function localFetch(config, route, init = {}) {
  return net.fetch(`${scheme}://127.0.0.1:${config.serverPort}${route}`, init);
}

function appRoot() {
  return app.getAppPath();
}

// Uploads go to userData: the default next to the server source is inside read-only app.asar once packaged.
function assetsDir() {
  return path.join(app.getPath('userData'), 'assets');
}

function runNodeScript(relativePath, env, args = []) {
  return new Promise((resolve, reject) => {
    const entry = path.join(appRoot(), relativePath);
    let stderr = '';

    const proc = spawn(process.execPath, [entry, ...args], {
      env: {...process.env, ELECTRON_RUN_AS_NODE: '1', ...env},
      windowsHide: true,
    });

    proc.stdout.on('data', chunk => console.log(`[${relativePath}]`, chunk.toString().trim()));
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

    proc.once('error', reject);
    proc.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${relativePath} завершился с кодом ${code}`));
    });
  });
}

function friendlyMessage(error) {
  const text = error instanceof Error ? error.message : String(error);

  if (text.includes('APP_DB_PASSWORD')) return 'Не удалось подготовить пароль приложения. Попробуйте перезапустить.';
  if (text.includes('password authentication failed')) return 'Сохранённый пароль базы данных не подошёл. Попробуйте перезапустить приложение.';
  if (text.includes('ECONNREFUSED')) return 'Не удалось подключиться к встроенной базе данных. Перезапустите приложение.';
  if (text.includes('EADDRINUSE')) return 'Порт уже занят другой программой. Перезапустите приложение — будет выбран другой порт.';
  if (text.includes('Database schema must be version')) return 'Требуется обновление базы данных — оно будет выполнено автоматически при следующем запуске.';

  return text || 'Не удалось запустить сервер. Перезапустите приложение.';
}

// IPC passes only an error's message, so the reason code reaches the window through the status.
function markStartFailed(error) {
  status = {state: 'error', message: friendlyMessage(error), ...(error?.code === 'vc-runtime' ? {code: 'vc-runtime'} : {}), addresses: []};
}

function getStatus(config) {
  if (status.state !== 'running' || !config) return status;

  return {
    ...status,
    lanMode: config.lanMode,
    addresses: config.lanMode || config.publicMode ? listAddresses(config.serverPort, scheme) : [],
    tunnel: tunnel.getTunnelStatus(),
    public: config.publicMode ? {...(publicStatus ?? {}), checking: Boolean(publicChecking), port: config.publicPort, upnpEnabled: config.publicUpnp} : null,
  };
}

function tunnelToken(config) {
  if (!config.tunnelTokenEnc) return null;
  try {
    return safeStorage.decryptString(Buffer.from(config.tunnelTokenEnc, 'base64'));
  } catch {
    return null;
  }
}

async function applyNetwork(config) {
  const token = tunnelToken(config);
  if (status.state !== 'running') {
    await tunnel.stopTunnel();
    await publicNet.unmapPort();
    return;
  }
  const current = tunnel.getTunnelStatus();
  const wanted = config.tunnelMode;
  if (wanted === 'off') {
    if (current.state !== 'off') await tunnel.stopTunnel();
  } else if (current.mode !== wanted || current.state === 'off' || current.state === 'error') {
    await tunnel.startTunnel({mode: wanted, port: config.tunnelPort, token, publicUrl: config.tunnelPublicUrl, protocol: config.tunnelProtocol});
  }
  if (config.publicMode) void checkPublic(config);
  else {
    publicStatus = null;
    await publicNet.unmapPort();
  }
}

function checkPublic(config) {
  if (publicChecking) return publicChecking;
  publicChecking = publicNet.inspectPublic({upnp: config.publicUpnp, externalPort: config.publicPort, internalPort: config.serverPort})
    .then(result => { publicStatus = result; return result; })
    .catch(error => { publicStatus = {checkedAt: Date.now(), error: error instanceof Error ? error.message : String(error)}; return publicStatus; })
    .finally(() => { publicChecking = null; });
  return publicChecking;
}

// A second start request waits for the same start, otherwise that window keeps showing «Starting…».
let starting = null;

async function startServer(config) {
  if (status.state === 'running') return getStatus(config);
  if (!starting) starting = startServerOnce(config).finally(() => { starting = null; });
  return starting;
}

async function startServerOnce(config) {
  try {
    status = {state: 'starting', message: 'Применяю миграции…', addresses: []};

    const dbEnv = {
      DB_HOST: '127.0.0.1',
      DB_PORT: String(config.postgresPort),
      POSTGRES_PASSWORD: config.postgresPassword,
    };

    await runNodeScript('scripts/migrate.ts', dbEnv);

    status = {...status, message: 'Настраиваю права приложения…'};
    await runNodeScript('scripts/provision.ts', {...dbEnv, APP_DB_PASSWORD: config.appPassword});

    status = {...status, message: 'Запускаю сервер…'};

    const certificate = usesTls(config) ? await ensureServerCertificate() : null;
    scheme = certificate ? 'https' : 'http';

    const serverEnv = {
      DB_HOST: '127.0.0.1',
      DB_PORT: String(config.postgresPort),
      APP_DB_PASSWORD: config.appPassword,
      HOST: listenHost(config),
      PORT: String(config.serverPort),
      TUNNEL_PORT: String(config.tunnelPort),
      ASSETS_DIR: assetsDir(),
      MODS_DIR: path.join(app.getPath('userData'), 'mods'),
      BUNDLED_MODS_DIR: bundledModsDir(),
      MODS_ENABLED: (await enabledBundledMods()).join(','),
      APP_VERSION: currentVersion(),
      UPDATE_DIR: updatesDir(),
      CLIENT_DIST_DIR: path.join(appRoot(), 'apps/client/dist'),
      ...(certificate
        ? {TLS_CERT_PATH: certificate.certPath, TLS_KEY_PATH: certificate.keyPath}
        : config.lanMode && !config.publicMode ? {ALLOW_INSECURE_LAN: 'true'} : {}),
    };

    let identity = null;

    await new Promise((resolve, reject) => {
      const entry = path.join(appRoot(), 'apps/server/src/main.ts');
      let settled = false;
      let stderr = '';

      child = spawn(process.execPath, [entry], {
        env: {...process.env, ELECTRON_RUN_AS_NODE: '1', ...serverEnv},
        windowsHide: true,
      });

      child.stdout.on('data', chunk => console.log('[server]', chunk.toString().trim()));
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });

      child.once('error', error => { if (!settled) { settled = true; reject(error); } });

      child.once('exit', code => {
        const wasStarting = !settled;
        child = null;

        if (wasStarting) {
          settled = true;
          reject(new Error(stderr.trim() || `Сервер завершился с кодом ${code}`));
        } else if (code !== 0 && code !== null) {
          status = {state: 'error', message: friendlyMessage(new Error(stderr.trim())), addresses: []};
        } else {
          status = STOPPED;
        }
      });

      // Poll /health on loopback (reachable even with HOST=0.0.0.0) instead of parsing the logs.
      (async () => {
        // Electron as Node takes noticeably longer than plain node to start listening.
        for (let attempt = 0; attempt < 60 && !settled; attempt++) {
          try {
            const response = await localFetch(config, '/health', {signal: AbortSignal.timeout(1000)});
            if (response.ok) { identity = await response.json(); settled = true; resolve(); return; }
          } catch {
            // Not up yet — retry.
          }

          await new Promise(r => setTimeout(r, 250));
        }

        if (!settled) { settled = true; reject(new Error(stderr.trim() || 'Сервер не ответил за отведённое время. Перезапустите приложение.')); }
      })();
    });

    status = {
      state: 'running',
      message: '',
      port: config.serverPort,
      localUrl: `${scheme}://127.0.0.1:${config.serverPort}`,
      serverId: identity?.serverId ?? null,
      hostName: identity?.hostName ?? null,
      tls: certificate ? {fingerprint: certificate.fingerprint, code: certificate.code} : null,
      tunnelPort: config.tunnelPort,
      addresses: [],
    };
    void applyNetwork(config).catch(error => console.error('[network]', error));
  } catch (error) {
    markStartFailed(error);
    throw error;
  }

  return getStatus(config);
}

async function stopServer() {
  await tunnel.stopTunnel();
  await publicNet.unmapPort();
  publicStatus = null;
  if (!child) {
    status = STOPPED;
    return status;
  }

  await new Promise(resolve => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
  });

  child = null;
  status = STOPPED;
  return status;
}

async function getConnections(config) {
  if (status.state !== 'running') return null;

  const response = await localFetch(config, '/host/connections', {
    signal: AbortSignal.timeout(3000),
  });

  if (!response.ok) throw new Error(`Сервер ответил ${response.status}`);
  return response.json();
}

async function hostRequest(config, route, init = {}) {
  if (status.state !== 'running') throw new Error('Сервер на этом компьютере не запущен — нажмите «Запустить сервер».');

  const response = await localFetch(config, route, {
    ...init,
    signal: AbortSignal.timeout(5000),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) throw new Error(data?.message ?? `Сервер ответил ${response.status}`);
  return data;
}

function getAccounts(config) {
  return hostRequest(config, '/host/accounts');
}

function setCanCreateCampaigns(config, userId, value) {
  return hostRequest(config, `/host/accounts/${userId}/can-create-campaigns`, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({canCreateCampaigns: value === true}),
  });
}

function getHostSettings(config) {
  return hostRequest(config, '/host/settings');
}

function setHostSettings(config, settings) {
  return hostRequest(config, '/host/settings', {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({openRegistration: settings.openRegistration === true}),
  });
}

module.exports = {
  startServer, stopServer, markStartFailed, getStatus, getConnections, getAccounts, setCanCreateCampaigns, assetsDir,
  applyNetwork, checkPublic, getHostSettings, setHostSettings,
};
