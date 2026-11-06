const path = require('node:path');
const fs = require('node:fs/promises');
const { app, ipcMain, shell } = require('electron');
const { readVisualMods } = require('../host/visual-mods.cjs');
const { readArtPackSection, readArtPacks } = require('../host/art-packs.cjs');
const { bundledModsDir, enabledBundledMods, setBundledMod } = require('../host/bundled-mods.cjs');
const { senderKind, validateSender } = require('./senders.cjs');

function registerLocalesAndModsHandlers(ctx) {
  const localesDir = () => path.join(app.getPath('userData'), 'locales');
  const LOCALE_FILE_LIMIT = 5 * 1024 * 1024;

  ipcMain.handle('locales:list', async event => {
    senderKind(ctx, event);
    let names = [];
    try {
      names = (await fs.readdir(localesDir())).filter(name => /^[A-Za-z0-9_-]{2,16}\.json$/.test(name) && name.toLowerCase() !== 'template.json');
    } catch {
      return [];
    }
    const result = [];
    for (const name of names.sort().slice(0, 40)) {
      const file = path.join(localesDir(), name);
      try {
        const stat = await fs.stat(file);
        if (stat.size > LOCALE_FILE_LIMIT) {
          result.push({ file: name, error: 'файл больше 5 МБ' });
          continue;
        }
        result.push({ file: name, data: JSON.parse(await fs.readFile(file, 'utf8')) });
      } catch (error) {
        result.push({ file: name, error: String(error?.message ?? error).slice(0, 200) });
      }
    }
    return result;
  });

  ipcMain.handle('locales:openFolder', async event => {
    validateSender(ctx, event);
    await fs.mkdir(localesDir(), { recursive: true });
    await shell.openPath(localesDir());
    return localesDir();
  });

  ipcMain.handle('locales:saveTemplate', async (event, input) => {
    validateSender(ctx, event);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Шаблон — объект.');
    const text = JSON.stringify(input, null, 2);
    if (text.length > LOCALE_FILE_LIMIT) throw new Error('Шаблон больше 5 МБ.');
    await fs.mkdir(localesDir(), { recursive: true });
    const file = path.join(localesDir(), 'template.json');
    await fs.writeFile(file, text, 'utf8');
    shell.showItemInFolder(file);
    return file;
  });

  const modsDir = () => path.join(app.getPath('userData'), 'mods');

  ipcMain.handle('mods:visual', async event => {
    senderKind(ctx, event);
    return readVisualMods(modsDir());
  });

  const artDirs = () => [{ dir: bundledModsDir(), bundled: true }, { dir: modsDir(), bundled: false }];

  ipcMain.handle('mods:bundled', async event => {
    senderKind(ctx, event);
    return { enabled: await enabledBundledMods() };
  });

  ipcMain.handle('mods:setBundled', async (event, id, on) => {
    validateSender(ctx, event);
    return { enabled: await setBundledMod(id, on === true) };
  });

  ipcMain.handle('mods:art', async event => {
    senderKind(ctx, event);
    return readArtPacks(artDirs());
  });

  ipcMain.handle('mods:artFiles', async (event, id, section) => {
    senderKind(ctx, event);
    if (typeof id !== 'string' || typeof section !== 'string') throw new Error('Нужны id набора и раздела.');
    return readArtPackSection(artDirs(), id, section);
  });

  ipcMain.handle('mods:openFolder', async event => {
    validateSender(ctx, event);
    await fs.mkdir(modsDir(), { recursive: true });
    await shell.openPath(modsDir());
    return modsDir();
  });
}

module.exports = { registerLocalesAndModsHandlers };
