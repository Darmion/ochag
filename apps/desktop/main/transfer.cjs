const path = require('node:path');
const fs = require('node:fs/promises');
const { app, dialog, ipcMain, net } = require('electron');
const { isInternetName } = require('./server-url.cjs');
const { networkFailure } = require('./connection.cjs');
const { validateSender } = require('./senders.cjs');
const { nativeText } = require('./native-texts.cjs');

function registerTransferHandlers(ctx) {
  const campaignFilters = () => [{ name: nativeText('Кампания «Очага»'), extensions: ['ochag-campaign', 'ttrpg-campaign'] }];
  const TRANSFER_TIMEOUT = 10 * 60_000;

  function validToken(token) {
    return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
  }

  ipcMain.handle('campaign:export', async (event, input) => {
    validateSender(ctx, event);

    const campaignId = input?.campaignId;
    const campaignName = typeof input?.campaignName === 'string' ? input.campaignName : nativeText('Кампания');

    if (
      typeof campaignId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(campaignId) ||
      !validToken(input?.token)
    ) {
      throw new Error('Некорректный запрос экспорта.');
    }

    const safeName = campaignName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80).trim() || nativeText('Кампания');
    const { canceled, filePath } = await dialog.showSaveDialog(ctx.mainWindow, {
      title: nativeText('Сохранить кампанию в файл'),
      defaultPath: path.join(app.getPath('documents'), `${safeName}.ochag-campaign`),
      filters: campaignFilters(),
    });

    if (canceled || !filePath) return { canceled: true };

    try {
      const response = await net.fetch(`${ctx.serverUrl}/campaigns/${campaignId}/export`, {
        headers: { Authorization: `Bearer ${input.token}` },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(TRANSFER_TIMEOUT),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        return { ok: false, message: data?.message ?? `Сервер ответил ошибкой ${response.status}.` };
      }

      const data = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(filePath, data);
      return { ok: true, filePath, sizeBytes: data.length };
    } catch (error) {
      const failure = networkFailure(error, ctx.serverUrl);
      return { ok: false, message: failure.data.message, hints: failure.data.hints };
    }
  });

  ipcMain.handle('campaign:import', async (event, input) => {
    validateSender(ctx, event);
    if (!validToken(input?.token)) throw new Error('Некорректный запрос импорта.');

    const { canceled, filePaths } = await dialog.showOpenDialog(ctx.mainWindow, {
      title: nativeText('Загрузить кампанию из файла'),
      properties: ['openFile'],
      filters: campaignFilters(),
    });

    if (canceled || !filePaths[0]) return { canceled: true };

    const stat = await fs.stat(filePaths[0]);
    if (stat.size > 1024 * 1024 * 1024) return { ok: false, message: 'Файл больше 1 ГБ.' };
    if (stat.size > 100 * 1024 * 1024 && isInternetName(new URL(ctx.serverUrl).hostname)) {
      return {
        ok: false,
        message: 'Через туннель Cloudflare файл кампании больше 100 МБ не пройдёт.',
        hints: ['Загрузите кампанию на компьютере мастера (там сервер на этом же компьютере) или подключитесь к нему по домашней или виртуальной локальной сети.'],
      };
    }

    try {
      const form = new FormData();
      form.append('file', new Blob([await fs.readFile(filePaths[0])], { type: 'application/gzip' }), path.basename(filePaths[0]));

      const response = await net.fetch(`${ctx.serverUrl}/campaigns/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.token}` },
        body: form,
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(TRANSFER_TIMEOUT),
      });

      const data = await response.json().catch(() => null);
      if (response.status === 413 && !data) return { ok: false, message: 'Файл кампании слишком большой для этого подключения (Cloudflare пропускает до 100 МБ).' };
      if (!response.ok) return { ok: false, message: data?.message ?? `Сервер ответил ошибкой ${response.status}.` };
      return { ok: true, fileName: path.basename(filePaths[0]), report: data };
    } catch (error) {
      const failure = networkFailure(error, ctx.serverUrl);
      return { ok: false, message: failure.data.message, hints: failure.data.hints };
    }
  });

  const objectFilters = () => [{ name: nativeText('Объект «Очага»'), extensions: ['ochag-object', 'ttrpg-object'] }];
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  ipcMain.handle('object:export', async (event, input) => {
    validateSender(ctx, event);
    const { campaignId, characterId } = input ?? {};
    if (typeof campaignId !== 'string' || !UUID_PATTERN.test(campaignId) || typeof characterId !== 'string' || !UUID_PATTERN.test(characterId) || !validToken(input?.token)) {
      throw new Error('Некорректный запрос экспорта объекта.');
    }
    const name = typeof input?.name === 'string' ? input.name : nativeText('Объект');
    const safeName = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80).trim() || nativeText('Объект');
    const { canceled, filePath } = await dialog.showSaveDialog(ctx.mainWindow, {
      title: nativeText('Сохранить объект в файл'),
      defaultPath: path.join(app.getPath('documents'), `${safeName}.ochag-object`),
      filters: objectFilters(),
    });
    if (canceled || !filePath) return { canceled: true };
    try {
      const response = await net.fetch(`${ctx.serverUrl}/campaigns/${campaignId}/characters/${characterId}/export`, {
        headers: { Authorization: `Bearer ${input.token}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(TRANSFER_TIMEOUT),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        return { ok: false, message: data?.message ?? `Сервер ответил ошибкой ${response.status}.` };
      }
      const data = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(filePath, data);
      return { ok: true, filePath, sizeBytes: data.length };
    } catch (error) {
      const failure = networkFailure(error, ctx.serverUrl);
      return { ok: false, message: failure.data.message, hints: failure.data.hints };
    }
  });

  ipcMain.handle('object:import', async (event, input) => {
    validateSender(ctx, event);
    const campaignId = input?.campaignId;
    if (typeof campaignId !== 'string' || !UUID_PATTERN.test(campaignId) || !validToken(input?.token)) throw new Error('Некорректный запрос импорта объекта.');
    const { canceled, filePaths } = await dialog.showOpenDialog(ctx.mainWindow, {
      title: nativeText('Загрузить объект из файла'), properties: ['openFile'], filters: objectFilters(),
    });
    if (canceled || !filePaths[0]) return { canceled: true };
    const stat = await fs.stat(filePaths[0]);
    if (stat.size > 40 * 1024 * 1024) return { ok: false, message: 'Файл больше 40 МБ.' };
    let file;
    try {
      file = JSON.parse(await fs.readFile(filePaths[0], 'utf8'));
    } catch {
      return { ok: false, message: 'Файл не похож на объект «Очага» (.ochag-object).' };
    }
    try {
      const response = await net.fetch(`${ctx.serverUrl}/campaigns/${campaignId}/objects/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ file }),
        credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(TRANSFER_TIMEOUT),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) return { ok: false, message: data?.message ?? `Сервер ответил ошибкой ${response.status}.` };
      return { ok: true, fileName: path.basename(filePaths[0]), characterId: data.characterId, name: data.name, kind: data.kind };
    } catch (error) {
      const failure = networkFailure(error, ctx.serverUrl);
      return { ok: false, message: failure.data.message, hints: failure.data.hints };
    }
  });
}

module.exports = { registerTransferHandlers };
