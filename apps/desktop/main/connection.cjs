const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { app, ipcMain, net } = require('electron');
const { getStatus } = require('../host/server.cjs');
const { describeNetworkError, pointsToThisComputer } = require('../host/network.cjs');
const { inspectServerCertificate, isPinned, trustServer, sameFingerprint } = require('../host/tls.cjs');
const { DEFAULT_PORT, normalizeServerUrl } = require('./server-url.cjs');
const { senderKind, validateSender } = require('./senders.cjs');

function configPath() {
  return path.join(app.getPath('userData'), 'connection.json');
}

async function loadConfig(ctx) {
  try {
    const saved = JSON.parse(
      await fs.readFile(configPath(), 'utf8'),
    );

    ctx.serverUrl = normalizeServerUrl(saved.serverUrl);
  } catch {
    ctx.serverUrl = `http://127.0.0.1:${DEFAULT_PORT}`;
  }
}

async function saveConfig(ctx) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });

  await fs.writeFile(
    configPath(),
    JSON.stringify({ serverUrl: ctx.serverUrl }, null, 2),
    'utf8',
  );
}

async function setServerUrl(ctx, value) {
  ctx.serverUrl = normalizeServerUrl(value);
  await saveConfig(ctx);
  return ctx.serverUrl;
}

function networkFailure(error, target) {
  const described = describeNetworkError(error, target);

  return {
    status: 0,
    data: {
      error: 'NETWORK',
      message: described.message,
      hints: described.hints,
      code: described.code,
    },
  };
}

function withLocalScheme(ctx, origin) {
  const local = getStatus(ctx.hostConfig);
  if (local.state !== 'running' || !local.localUrl) return origin;

  const url = new URL(origin);
  const own = new URL(local.localUrl);
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname.startsWith('127.');
  return loopback && url.port === own.port ? own.origin : origin;
}

async function followLocalServer(ctx) {
  try {
    const next = withLocalScheme(ctx, ctx.serverUrl);
    if (next !== ctx.serverUrl) await setServerUrl(ctx, next);
  } catch {
  }
}

const NO_SERVER_AT_ALL = ['refused', 'timeout', 'dns', 'address'];

function isCertificatePrompt(result) {
  return !result.ok && typeof result.error?.fingerprint === 'string';
}

async function probeServer(ctx, value) {
  let origin;

  try {
    origin = withLocalScheme(ctx, normalizeServerUrl(value));
  } catch (error) {
    return { ok: false, origin: null, error: describeNetworkError(error) };
  }

  const order = origin.startsWith('https:')
    ? [origin, origin.replace(/^https:/, 'http:')]
    : [origin, origin.replace(/^http:/, 'https:')];
  let first = null;

  for (const candidate of order) {
    const result = candidate.startsWith('https:') ? await probeSecure(ctx, candidate) : await probeHealth(ctx, candidate);

    if (result.ok && candidate !== origin && candidate.startsWith('http:') && await isPinned(new URL(candidate).hostname)) {
      return {
        ok: false,
        origin,
        error: {
          code: 'tls-disabled',
          message: `Сервер ${new URL(origin).host} раньше шифровал подключение, а сейчас отвечает без шифрования.`,
          hints: [
            'Если мастер сам выключил «Защищённые подключения TLS», введите адрес с http:// — например, ' + candidate + '.',
            'Если мастер ничего не менял, не подключайтесь и сообщите ему: кто-то в сети может подменять сервер.',
          ],
        },
      };
    }

    if (result.ok || isCertificatePrompt(result)) return result;
    first ??= result;
    if (NO_SERVER_AT_ALL.includes(result.error?.code)) break;
  }

  return first;
}

// Check the certificate via node:tls first so Chromium never sees (and caches) an unpinned one, then /health.
async function probeSecure(ctx, origin) {
  let inspected;

  try {
    inspected = await inspectServerCertificate(origin);
  } catch (error) {
    return { ok: false, origin, error: describeNetworkError(error, origin) };
  }

  if (inspected.trusted) return probeHealth(ctx, origin);

  return {
    ok: false,
    origin,
    error: inspected.changed
      ? {
          code: 'certificate-changed',
          message: `Сертификат сервера ${origin} изменился с прошлого подключения.`,
          hints: [
            'Так бывает, если мастер переустановил приложение или перенёс сервер на другой компьютер — спросите у него новый код сертификата (раздел «Сервер»).',
            'Если мастер ничего не менял, не подключайтесь: кто-то в сети может подменять сервер.',
          ],
          fingerprint: inspected.fingerprint,
          certificateCode: inspected.code,
        }
      : {
          code: 'certificate',
          message: `Сервер ${origin} шифрует подключение собственным сертификатом.`,
          hints: [
            'Сверьте код сертификата с тем, что видит мастер в разделе «Сервер» (или с кодом в приглашении), и нажмите «Коды совпадают — подключиться».',
          ],
          fingerprint: inspected.fingerprint,
          certificateCode: inspected.code,
        },
  };
}

async function probeHealth(ctx, origin) {
  const started = Date.now();

  try {
    const response = await net.fetch(`${origin}/health`, {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });

    const info = await response.json().catch(() => null);

    if (!response.ok || info?.status !== 'ok') {
      return {
        ok: false,
        origin,
        error: {
          code: 'not-ttrpg',
          message: `По адресу ${origin} отвечает не сервер игры (или он работает с ошибкой).`,
          hints: [
            'Проверьте порт: у мастера в разделе «Сервер» показан точный адрес.',
            'Если на этом порту работает другая программа, мастеру нужно её закрыть.',
          ],
        },
      };
    }

    const local = getStatus(ctx.hostConfig);
    const sameAsLocalServer =
      local.state === 'running' &&
      Boolean(local.serverId) &&
      info.serverId === local.serverId;

    return {
      ok: true,
      origin,
      latencyMs: Date.now() - started,
      serverId: typeof info.serverId === 'string' ? info.serverId : null,
      hostName: typeof info.hostName === 'string' ? info.hostName : null,
      apiVersion: info.apiVersion ?? null,
      appVersion: typeof info.appVersion === 'string' ? info.appVersion : null,
      registration: info.registration === 'invite' ? 'invite' : 'open',
      thisComputer:
        sameAsLocalServer ||
        info.hostName === os.hostname() ||
        pointsToThisComputer(origin),
    };
  } catch (error) {
    return { ok: false, origin, error: describeNetworkError(error, origin) };
  }
}

function registerConnectionHandlers(ctx) {
  ipcMain.handle('server:get', event => {
    senderKind(ctx, event);
    return ctx.serverUrl;
  });

  ipcMain.handle('server:set', async (event, value) => {
    validateSender(ctx, event);
    return setServerUrl(ctx, value);
  });

  ipcMain.handle('server:trust', async (event, origin, fingerprint) => {
    validateSender(ctx, event);
    const target = normalizeServerUrl(origin);
    if (!target.startsWith('https:')) throw new Error('Доверять можно только адресу https://.');

    const inspected = await inspectServerCertificate(target);
    if (!sameFingerprint(inspected.fingerprint, fingerprint)) {
      throw new Error('Сертификат сервера сменился, пока вы сверяли код. Сверьте новый код ещё раз.');
    }
    if (!inspected.trusted) await trustServer(new URL(target).hostname, inspected.fingerprint);
    return probeServer(ctx, target);
  });

  ipcMain.handle('server:probe', async (event, value) => {
    validateSender(ctx, event);
    return probeServer(ctx, value);
  });
}

module.exports = { loadConfig, setServerUrl, networkFailure, followLocalServer, probeServer, isCertificatePrompt, registerConnectionHandlers };
