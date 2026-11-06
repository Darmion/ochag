const { app, dialog, Menu } = require('electron');

const path = require('node:path');
const { existsSync } = require('node:fs');
const { pathToFileURL } = require('node:url');

// Same data folder as every earlier version (%APPDATA%\ttrpg-foundation): Electron used to derive it from the package.json name.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'ttrpg-foundation'));

const windowIconPath = path.join(__dirname, '..', '..', 'branding', 'icon.png');
const windowIcon = existsSync(windowIconPath) ? { icon: windowIconPath } : {};

const { loadOrCreateHostConfig } = require('./host/config.cjs');
const { stopDatabase } = require('./host/database.cjs');
const { stopServer } = require('./host/server.cjs');
const tunnel = require('./host/tunnel.cjs');
const { initTls } = require('./host/tls.cjs');
const updates = require('./host/updates.cjs');
const { DEFAULT_PORT } = require('./main/server-url.cjs');
const { loadConfig, registerConnectionHandlers } = require('./main/connection.cjs');
const { registerApiRequestHandler } = require('./main/api-request.cjs');
const { registerAuthHandlers } = require('./main/auth.cjs');
const { registerTransferHandlers } = require('./main/transfer.cjs');
const { registerLocalesAndModsHandlers } = require('./main/locales-mods.cjs');
const { registerUpdateHandlers } = require('./main/update-handlers.cjs');
const { registerHostServerHandlers } = require('./main/host-server.cjs');
const { registerHostBackupHandlers, startBackupSchedule } = require('./main/host-backups.cjs');
const { registerHostNetworkHandlers } = require('./main/host-network.cjs');
const { createWindow, registerWindowHandlers } = require('./main/windows.cjs');
const { loadNativeTexts, nativeText, registerNativeTextHandlers } = require('./main/native-texts.cjs');

const entryPath = path.join(
  __dirname,
  '../client/dist/index.html',
);

const entryUrl = pathToFileURL(entryPath).href;
const playerViewUrl = `${entryUrl}?view=player`;

const ctx = {
  entryPath,
  entryUrl,
  playerViewUrl,
  preloadPath: path.join(__dirname, 'preload.cjs'),
  windowIcon,
  mainWindow: null,
  playerViewWindow: null,
  playerViewState: null,
  serverUrl: `http://127.0.0.1:${DEFAULT_PORT}`,
  hostConfig: null,
};

function registerHandlers() {
  registerConnectionHandlers(ctx);
  registerApiRequestHandler(ctx);
  registerAuthHandlers(ctx);
  registerTransferHandlers(ctx);
  registerLocalesAndModsHandlers(ctx);
  registerUpdateHandlers(ctx);
  registerHostServerHandlers(ctx);
  registerHostBackupHandlers(ctx);
  registerHostNetworkHandlers(ctx);
  registerWindowHandlers(ctx);
  registerNativeTextHandlers(ctx);
}

loadNativeTexts();
startBackupSchedule(ctx);

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
app.on('second-instance', () => {
  if (!ctx.mainWindow) return;
  if (ctx.mainWindow.isMinimized()) ctx.mainWindow.restore();
  ctx.mainWindow.focus();
});

app.whenReady()
  .then(async () => {
    if (!singleInstance) return;
    const stale = tunnel.cleanupStaleTunnels();
    if (stale) console.log(`Остановлено cloudflared прошлого сеанса: ${stale}`);
    // No default Electron menu: Alt showed «File Edit View…» over the game and Ctrl+R reloaded the window.
    Menu.setApplicationMenu(null);
    if (process.platform === 'win32') app.setAppUserModelId('local.ttrpg.tabletop');
    await loadConfig(ctx);
    ctx.hostConfig = await loadOrCreateHostConfig();
    await initTls();
    registerHandlers();
    await createWindow(ctx);

    app.on('activate', () => {
      if (!ctx.mainWindow) {
        void createWindow(ctx);
      }
    });
  })
  .catch(error => {
    dialog.showErrorBox(
      nativeText('Не удалось запустить «Очаг»'),
      error instanceof Error ? error.message : String(error),
    );

    app.quit();
  });

app.on('window-all-closed', () => {
  app.quit();
});

// Quitting waits for a clean pg_ctl stop so the data directory is not left locked.
let quitting = false;

app.on('before-quit', event => {
  if (quitting || !singleInstance) return;

  event.preventDefault();
  quitting = true;

  (async () => {
    await stopServer().catch(() => {});
    await stopDatabase().catch(() => {});
  })().finally(() => app.quit());
});

// The update installer runs once the server and the database are stopped (before-quit above).
app.on('will-quit', () => {
  updates.runScheduledInstall();
});
