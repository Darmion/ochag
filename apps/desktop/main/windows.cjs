// The window channels: the windows themselves live in the Tauri shell (src-tauri/src/main.rs), the host keeps their state
// and the checks of senders.cjs.
const { ipcMain } = require('../bridge/runtime.cjs');
const { senderKind, validateSender } = require('./senders.cjs');
const { nativeText } = require('./native-texts.cjs');

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

// What the handlers and senders.cjs know of a window: its label, webContents and main frame.
function shellWindow(label, url, protocol) {
  const window = { label, alive: true };
  const mainFrame = { url };
  window.webContents = {
    mainFrame,
    send: (channel, ...payload) => {
      if (window.alive) protocol.emitTo(label, channel, payload);
    },
    isDestroyed: () => !window.alive,
  };
  return window;
}

function registerWindowHandlers(ctx, protocol) {
  ipcMain.handle('window:attention', event => {
    validateSender(ctx, event);
    protocol.notify('window.attention', { label: 'main' });
  });

  ipcMain.handle('player-view:open', async (event, input) => {
    validateSender(ctx, event);
    ctx.playerViewState = parsePlayerView(input, true);

    if (ctx.playerViewWindow) {
      ctx.playerViewWindow.webContents.send('player-view:changed', publicPlayerView(ctx));
      await protocol.call('window.focus', { label: 'player-view' });
      return true;
    }

    ctx.playerViewWindow = shellWindow('player-view', ctx.playerViewUrl, protocol);
    try {
      await protocol.call('window.openPlayerView', { title: nativeText('Очаг — вид игроков') });
    } catch (error) {
      ctx.playerViewWindow = null;
      ctx.playerViewState = null;
      throw error;
    }
    return true;
  });

  ipcMain.handle('player-view:update', (event, input) => {
    validateSender(ctx, event);
    if (!ctx.playerViewWindow || !ctx.playerViewState) return false;
    ctx.playerViewState = { ...ctx.playerViewState, ...parsePlayerView(input, false) };
    ctx.playerViewWindow.webContents.send('player-view:changed', publicPlayerView(ctx));
    return true;
  });

  ipcMain.handle('player-view:close', async event => {
    validateSender(ctx, event);
    if (ctx.playerViewWindow) await protocol.call('window.close', { label: 'player-view' });
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

  protocol.onEvent(message => {
    if (message.name !== 'window-closed' || message.label !== 'player-view' || !ctx.playerViewWindow) return;
    ctx.playerViewWindow.alive = false;
    ctx.playerViewWindow = null;
    ctx.playerViewState = null;
    ctx.mainWindow?.webContents.send('player-view:closed');
  });
}

module.exports = { shellWindow, registerWindowHandlers };
