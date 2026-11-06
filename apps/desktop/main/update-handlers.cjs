const { dialog, ipcMain } = require('electron');
const updates = require('../host/updates.cjs');
const { validateSender } = require('./senders.cjs');
const { nativeText } = require('./native-texts.cjs');

function registerUpdateHandlers(ctx) {
  const progressTo = (event, source) => ({ received, total }) => {
    if (!event.sender.isDestroyed()) event.sender.send('update:progress', { source, received, total });
  };

  ipcMain.handle('update:state', async event => {
    validateSender(ctx, event);
    return updates.getState();
  });

  ipcMain.handle('update:saveSettings', async (event, input) => {
    validateSender(ctx, event);
    return updates.saveSettings(input);
  });

  ipcMain.handle('update:checkGitHub', async event => {
    validateSender(ctx, event);
    return updates.checkGitHub();
  });

  ipcMain.handle('update:downloadGitHub', async event => {
    validateSender(ctx, event);
    return updates.downloadGitHub(progressTo(event, 'github'));
  });

  ipcMain.handle('update:checkServer', async event => {
    validateSender(ctx, event);
    return updates.checkServer(ctx.serverUrl);
  });

  ipcMain.handle('update:downloadServer', async (event, options) => {
    validateSender(ctx, event);
    return updates.downloadFromServer(ctx.serverUrl, progressTo(event, 'server'), { allowUnverified: options?.allowUnverified === true });
  });

  ipcMain.handle('update:importInstaller', async event => {
    validateSender(ctx, event);

    const { canceled, filePaths } = await dialog.showOpenDialog(ctx.mainWindow, {
      title: nativeText('Выберите установщик приложения'),
      properties: ['openFile'],
      filters: [{ name: nativeText('Установщик (.exe)'), extensions: ['exe'] }],
    });

    if (canceled || !filePaths[0]) return { canceled: true };
    return updates.importInstaller(filePaths[0]);
  });

  ipcMain.handle('update:install', async (event, version) => {
    validateSender(ctx, event);
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Некорректная версия.');
    await updates.scheduleInstall(version);
    return true;
  });
}

module.exports = { registerUpdateHandlers };
