const { ipcMain } = require('electron');
const { saveHostConfig } = require('../host/config.cjs');
const { ensureDatabaseRunning, stopDatabase } = require('../host/database.cjs');
const { startServer, stopServer, markStartFailed, getStatus, getConnections, getAccounts, setCanCreateCampaigns } = require('../host/server.cjs');
const { firewallStatus, allowThroughFirewall } = require('../host/network.cjs');
const { followLocalServer } = require('./connection.cjs');
const { runScheduledBackup } = require('./host-backups.cjs');
const { validateSender } = require('./senders.cjs');

function registerHostServerHandlers(ctx) {
  ipcMain.handle('host:start', async event => {
    validateSender(ctx, event);

    try {
      await ensureDatabaseRunning(ctx.hostConfig);
    } catch (error) {
      markStartFailed(error);
      throw error;
    }
    const status = await startServer(ctx.hostConfig);
    await followLocalServer(ctx);
    setTimeout(() => void runScheduledBackup(ctx), 60 * 1000).unref();
    return status;
  });

  ipcMain.handle('host:stop', async event => {
    validateSender(ctx, event);

    const result = await stopServer();
    await stopDatabase();
    return result;
  });

  ipcMain.handle('host:status', event => {
    validateSender(ctx, event);
    return getStatus(ctx.hostConfig);
  });

  ipcMain.handle('host:connections', async event => {
    validateSender(ctx, event);
    return getConnections(ctx.hostConfig);
  });

  ipcMain.handle('host:accounts', async event => {
    validateSender(ctx, event);
    return getAccounts(ctx.hostConfig);
  });

  ipcMain.handle('host:setCanCreateCampaigns', async (event, userId, value) => {
    validateSender(ctx, event);

    if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      throw new Error('Некорректный аккаунт.');
    }

    return setCanCreateCampaigns(ctx.hostConfig, userId, value === true);
  });

  ipcMain.handle('host:setLanMode', async (event, enabled) => {
    validateSender(ctx, event);

    ctx.hostConfig.lanMode = enabled === true;
    await saveHostConfig(ctx.hostConfig);

    if (getStatus().state === 'running') {
      await stopServer();
      await startServer(ctx.hostConfig);
      await followLocalServer(ctx);
    }

    return getStatus(ctx.hostConfig);
  });

  ipcMain.handle('host:getLanMode', event => {
    validateSender(ctx, event);
    return ctx.hostConfig.lanMode;
  });

  ipcMain.handle('host:setLanTls', async (event, enabled) => {
    validateSender(ctx, event);

    ctx.hostConfig.lanTls = enabled !== false;
    await saveHostConfig(ctx.hostConfig);

    if (ctx.hostConfig.lanMode && getStatus().state === 'running') {
      await stopServer();
      await startServer(ctx.hostConfig);
      await followLocalServer(ctx);
    }

    return getStatus(ctx.hostConfig);
  });

  ipcMain.handle('host:getLanTls', event => {
    validateSender(ctx, event);
    return ctx.hostConfig.lanTls !== false;
  });

  ipcMain.handle('host:firewallStatus', async event => {
    validateSender(ctx, event);
    return firewallStatus(ctx.hostConfig.serverPort, process.execPath);
  });

  ipcMain.handle('host:allowFirewall', async event => {
    validateSender(ctx, event);
    return allowThroughFirewall(ctx.hostConfig.serverPort, process.execPath);
  });
}

module.exports = { registerHostServerHandlers };
