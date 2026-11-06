const { ipcMain, net } = require('electron');
const credentials = require('../host/credentials.cjs');
const { isCertificatePrompt, networkFailure, probeServer, setServerUrl } = require('./connection.cjs');
const { validateSender } = require('./senders.cjs');

function registerAuthHandlers(ctx) {
  ipcMain.handle('auth:saved', async event => {
    validateSender(ctx, event);
    return credentials.list();
  });

  ipcMain.handle('auth:remember', async (event, input) => {
    validateSender(ctx, event);

    if (
      !input || typeof input !== 'object' ||
      typeof input.username !== 'string' || input.username.trim() === '' || input.username.length > 64 ||
      typeof input.password !== 'string' || input.password === '' || input.password.length > 200
    ) {
      throw new Error('Некорректные данные входа.');
    }

    return credentials.remember({
      serverUrl: ctx.serverUrl,
      username: input.username,
      password: input.password,
      hostName: typeof input.hostName === 'string' ? input.hostName.slice(0, 100) : null,
      serverId: typeof input.serverId === 'string' ? input.serverId.slice(0, 64) : null,
    });
  });

  ipcMain.handle('auth:markUsed', async (event, id, info) => {
    validateSender(ctx, event);
    if (typeof id !== 'string') throw new Error('Некорректный вход.');

    return credentials.markUsed(id, {
      hostName: typeof info?.hostName === 'string' ? info.hostName.slice(0, 100) : undefined,
      serverId: typeof info?.serverId === 'string' ? info.serverId.slice(0, 64) : undefined,
    });
  });

  ipcMain.handle('auth:forget', async (event, id) => {
    validateSender(ctx, event);
    if (typeof id !== 'string') throw new Error('Некорректный вход.');
    return credentials.forget(id);
  });

  ipcMain.handle('auth:clearLast', async event => {
    validateSender(ctx, event);
    return credentials.clearLast();
  });

  ipcMain.handle('auth:setAutoLogin', async (event, enabled) => {
    validateSender(ctx, event);
    return credentials.setAutoLogin(enabled === true);
  });

  ipcMain.handle('auth:loginSaved', async (event, id) => {
    validateSender(ctx, event);
    if (typeof id !== 'string') throw new Error('Некорректный вход.');

    let secret;

    try {
      secret = await credentials.secretFor(id);
    } catch {
      return {
        status: 0,
        serverUrl: ctx.serverUrl,
        data: { message: 'Не удалось прочитать сохранённый пароль. Войдите вручную — он сохранится заново.' },
      };
    }

    const probe = await probeServer(ctx, secret.serverUrl);
    if (isCertificatePrompt(probe) || probe.error?.code === 'tls-disabled') {
      return {
        status: 0,
        serverUrl: probe.origin,
        data: { error: 'NETWORK', message: probe.error.message, hints: probe.error.hints, code: probe.error.code },
      };
    }

    await setServerUrl(ctx, probe.ok ? probe.origin : secret.serverUrl);

    try {
      const response = await net.fetch(`${ctx.serverUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: secret.username, password: secret.password }),
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok && ctx.serverUrl !== secret.serverUrl) await credentials.moveServer(id, ctx.serverUrl);

      return {
        status: response.status,
        serverUrl: ctx.serverUrl,
        data: await response.json().catch(() => null),
      };
    } catch (error) {
      return { ...networkFailure(error, ctx.serverUrl), serverUrl: ctx.serverUrl };
    }
  });
}

module.exports = { registerAuthHandlers };
