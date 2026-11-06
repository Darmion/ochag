const { ipcMain, net, safeStorage } = require('electron');
const { saveHostConfig } = require('../host/config.cjs');
const { startServer, stopServer, getStatus, applyNetwork, checkPublic, getHostSettings, setHostSettings } = require('../host/server.cjs');
const tunnel = require('../host/tunnel.cjs');
const { normalizeServerUrl } = require('./server-url.cjs');
const { followLocalServer } = require('./connection.cjs');
const { validateSender } = require('./senders.cjs');

async function cloudflareSpeedTest() {
  const total = 5_000_000;
  const started = Date.now();
  let received = 0;
  const controller = new AbortController();
  let stall = null;
  const restartStall = () => {
    clearTimeout(stall);
    stall = setTimeout(() => controller.abort(new Error('stalled')), 8000);
  };
  const overall = setTimeout(() => controller.abort(new Error('timeout')), 40_000);
  let failure = null;
  try {
    restartStall();
    const response = await net.fetch(`https://speed.cloudflare.com/__down?bytes=${total}`, { credentials: 'omit', cache: 'no-store', signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Cloudflare ответила ${response.status}`);
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      restartStall();
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(stall);
    clearTimeout(overall);
  }
  const seconds = Math.max(0.001, (Date.now() - started) / 1000);
  const verdict = received >= total ? 'ok' : received === 0 ? 'blocked' : received < 256 * 1024 ? 'throttled' : 'slow';
  return { verdict, received, total, seconds: Math.round(seconds * 10) / 10, bytesPerSecond: Math.round(received / seconds), error: verdict === 'ok' ? null : failure };
}

function registerHostNetworkHandlers(ctx) {
  const networkView = () => ({
    lanMode: ctx.hostConfig.lanMode,
    lanTls: ctx.hostConfig.lanTls !== false,
    tunnelMode: ctx.hostConfig.tunnelMode,
    hasTunnelToken: Boolean(ctx.hostConfig.tunnelTokenEnc),
    tunnelPublicUrl: ctx.hostConfig.tunnelPublicUrl,
    tunnelProtocol: ctx.hostConfig.tunnelProtocol,
    tunnelPort: ctx.hostConfig.tunnelPort,
    publicMode: ctx.hostConfig.publicMode,
    publicUpnp: ctx.hostConfig.publicUpnp,
    publicPort: ctx.hostConfig.publicPort,
  });

  ipcMain.handle('host:getNetwork', event => {
    validateSender(ctx, event);
    return networkView();
  });

  ipcMain.handle('host:setTunnel', async (event, input) => {
    validateSender(ctx, event);
    const mode = input?.mode;
    if (!['off', 'quick', 'named'].includes(mode)) throw new Error('Некорректный режим туннеля.');
    if (typeof input.token === 'string') {
      const token = input.token.trim();
      if (token && (token.length > 4000 || !/^[A-Za-z0-9_=+/.-]+$/.test(token))) throw new Error('Это не похоже на токен туннеля Cloudflare — скопируйте его из панели целиком.');
      if (token && !safeStorage.isEncryptionAvailable()) throw new Error('Шифрование Windows недоступно — токен не сохранить.');
      ctx.hostConfig.tunnelTokenEnc = token ? safeStorage.encryptString(token).toString('base64') : null;
    }
    if (input.publicUrl !== undefined) {
      if (input.publicUrl === null || input.publicUrl === '') ctx.hostConfig.tunnelPublicUrl = null;
      else {
        const url = normalizeServerUrl(String(input.publicUrl));
        if (!url.startsWith('https:')) throw new Error('Адрес постоянного туннеля — https://, как его показывает Cloudflare.');
        ctx.hostConfig.tunnelPublicUrl = url;
      }
    }
    if (input.protocol !== undefined) ctx.hostConfig.tunnelProtocol = input.protocol === 'http2' ? 'http2' : 'auto';
    if (mode === 'named' && !ctx.hostConfig.tunnelTokenEnc) throw new Error('Для постоянного туннеля вставьте токен из панели Cloudflare.');
    const restart = ctx.hostConfig.tunnelMode === mode && mode !== 'off' && (input.token !== undefined || input.protocol !== undefined);
    ctx.hostConfig.tunnelMode = mode;
    await saveHostConfig(ctx.hostConfig);
    if (restart) await tunnel.stopTunnel();
    await applyNetwork(ctx.hostConfig);
    return { network: networkView(), status: getStatus(ctx.hostConfig) };
  });

  ipcMain.handle('host:restartTunnel', async event => {
    validateSender(ctx, event);
    await tunnel.stopTunnel();
    await applyNetwork(ctx.hostConfig);
    return getStatus(ctx.hostConfig);
  });

  ipcMain.handle('host:recheckTunnel', async event => {
    validateSender(ctx, event);
    await tunnel.recheckTunnel();
    return getStatus(ctx.hostConfig);
  });

  ipcMain.handle('host:cloudflared', async event => {
    validateSender(ctx, event);
    return tunnel.cloudflaredInfo();
  });

  ipcMain.handle('host:downloadCloudflared', async event => {
    validateSender(ctx, event);
    const info = await tunnel.downloadCloudflared();
    if (ctx.hostConfig.tunnelMode !== 'off') await applyNetwork(ctx.hostConfig);
    return info;
  });

  ipcMain.handle('host:setPublic', async (event, input) => {
    validateSender(ctx, event);
    const enabled = input?.enabled === true;
    const port = input?.port === undefined ? ctx.hostConfig.publicPort : Number(input.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Внешний порт — число от 1 до 65535.');
    const restart = enabled !== ctx.hostConfig.publicMode || (enabled && (!ctx.hostConfig.lanMode || ctx.hostConfig.lanTls === false));
    ctx.hostConfig.publicMode = enabled;
    if (enabled) {
      ctx.hostConfig.lanMode = true;
      ctx.hostConfig.lanTls = true;
    }
    if (input?.upnp !== undefined) ctx.hostConfig.publicUpnp = input.upnp !== false;
    ctx.hostConfig.publicPort = port;
    await saveHostConfig(ctx.hostConfig);
    if (getStatus().state === 'running') {
      if (restart) {
        await stopServer();
        await startServer(ctx.hostConfig);
        await followLocalServer(ctx);
      } else {
        await applyNetwork(ctx.hostConfig);
      }
    }
    return { network: networkView(), status: getStatus(ctx.hostConfig) };
  });

  ipcMain.handle('host:checkPublic', async event => {
    validateSender(ctx, event);
    if (getStatus().state === 'running' && ctx.hostConfig.publicMode) await checkPublic(ctx.hostConfig);
    return getStatus(ctx.hostConfig);
  });

  ipcMain.handle('host:getSettings', async event => {
    validateSender(ctx, event);
    return getHostSettings(ctx.hostConfig);
  });

  ipcMain.handle('host:setSettings', async (event, input) => {
    validateSender(ctx, event);
    return setHostSettings(ctx.hostConfig, { openRegistration: input?.openRegistration === true });
  });

  ipcMain.handle('net:cloudflareTest', async event => {
    validateSender(ctx, event);
    return cloudflareSpeedTest();
  });
}

module.exports = { registerHostNetworkHandlers };
