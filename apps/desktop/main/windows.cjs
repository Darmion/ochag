const { BrowserWindow, ipcMain, screen, shell } = require('electron');
const { senderKind, validateSender } = require('./senders.cjs');
const { nativeText } = require('./native-texts.cjs');

const EXTERNAL_LINKS = new Set([
  'https://github.com/Darmion/ochag/issues',
  'https://aka.ms/vs/17/release/vc_redist.x64.exe',
  'https://helloiamsinan.itch.io/rpg-essentials-ultimate-fantasy-icons-gui-pack',
  'https://tommusic.itch.io/',
  'https://dnd.wizards.com/resources/systems-reference-document',
  'https://creativecommons.org/licenses/by/4.0/legalcode',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePlayerView(input, full) {
  if (!input || typeof input !== 'object') throw new Error('Некорректные параметры окна игроков.');
  const result = {};

  if (full || input.token !== undefined) {
    if (typeof input.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw new Error('Некорректный токен.');
    result.token = input.token;
  }

  for (const key of ['campaignId', 'sceneId', 'viewAs', 'currentUserId']) {
    if (!full && input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || !UUID.test(input[key])) throw new Error(`Некорректный параметр ${key}.`);
    result[key] = input[key];
  }

  if (full || input.viewerName !== undefined) {
    result.viewerName = typeof input.viewerName === 'string' ? input.viewerName.slice(0, 100) : '';
  }

  return result;
}

function publicPlayerView(ctx) {
  return ctx.playerViewState ? { ...ctx.playerViewState } : null;
}

async function createPlayerViewWindow(ctx) {
  const primary = screen.getPrimaryDisplay();
  const external = screen.getAllDisplays().find(display => display.id !== primary.id);
  const area = external?.workArea;
  const width = area ? Math.min(1280, area.width) : 1280;
  const height = area ? Math.min(800, area.height) : 800;

  ctx.playerViewWindow = new BrowserWindow({
    ...(area
      ? { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height }
      : { width, height }),
    minWidth: 480,
    minHeight: 360,
    title: nativeText('Очаг — вид игроков'),
    ...ctx.windowIcon,
    backgroundColor: '#0b0704',
    autoHideMenuBar: true,
    webPreferences: {
      preload: ctx.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  ctx.playerViewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ctx.playerViewWindow.webContents.on('will-navigate', event => event.preventDefault());

  ctx.playerViewWindow.on('closed', () => {
    ctx.playerViewWindow = null;
    ctx.playerViewState = null;
    ctx.mainWindow?.webContents.send('player-view:closed');
  });

  ctx.playerViewWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F11' || !ctx.playerViewWindow) return;
    event.preventDefault();
    ctx.playerViewWindow.setFullScreen(!ctx.playerViewWindow.isFullScreen());
  });

  await ctx.playerViewWindow.loadFile(ctx.entryPath, { query: { view: 'player' } });
  if (external) ctx.playerViewWindow.maximize();
}

async function createWindow(ctx) {
  ctx.mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 850,
    minHeight: 620,
    title: 'Очаг',
    ...ctx.windowIcon,
    backgroundColor: '#0b0704',
    autoHideMenuBar: true,
    webPreferences: {
      preload: ctx.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  ctx.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL_LINKS.has(url)) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  ctx.mainWindow.webContents.on('will-navigate', event => {
    event.preventDefault();
  });

  ctx.mainWindow.on('focus', () => ctx.mainWindow?.flashFrame(false));

  ctx.mainWindow.on('closed', () => {
    ctx.mainWindow = null;
    ctx.playerViewWindow?.close();
  });

  await ctx.mainWindow.loadFile(ctx.entryPath);
}

function registerWindowHandlers(ctx) {
  ipcMain.handle('window:attention', event => {
    validateSender(ctx, event);
    if (ctx.mainWindow && !ctx.mainWindow.isFocused()) ctx.mainWindow.flashFrame(true);
  });

  ipcMain.handle('player-view:open', async (event, input) => {
    validateSender(ctx, event);
    const next = parsePlayerView(input, true);
    ctx.playerViewState = next;

    if (ctx.playerViewWindow) {
      ctx.playerViewWindow.webContents.send('player-view:changed', publicPlayerView(ctx));
      ctx.playerViewWindow.focus();
      return true;
    }

    await createPlayerViewWindow(ctx);
    return true;
  });

  ipcMain.handle('player-view:update', (event, input) => {
    validateSender(ctx, event);
    if (!ctx.playerViewWindow || !ctx.playerViewState) return false;
    ctx.playerViewState = { ...ctx.playerViewState, ...parsePlayerView(input, false) };
    ctx.playerViewWindow.webContents.send('player-view:changed', publicPlayerView(ctx));
    return true;
  });

  ipcMain.handle('player-view:close', event => {
    validateSender(ctx, event);
    ctx.playerViewWindow?.close();
    return true;
  });

  ipcMain.handle('player-view:isOpen', event => {
    validateSender(ctx, event);
    return Boolean(ctx.playerViewWindow);
  });

  ipcMain.handle('player-view:state', event => {
    if (senderKind(ctx, event) !== 'player-view') throw new Error('Недопустимый источник команды.');
    return publicPlayerView(ctx);
  });
}

module.exports = { createWindow, registerWindowHandlers };
