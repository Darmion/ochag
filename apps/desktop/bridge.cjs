// The host behind the Tauri shell (src-tauri/src/bridge.rs): the channel handlers of main/ and the server, database,
// tunnels and backups of host/, reached through bridge/protocol.cjs.
const protocol = require('./bridge/protocol.cjs');

const ENTRY_URL = 'tauri://localhost/index.html';

async function start() {
  const init = await protocol.init;
  const runtime = require('./bridge/runtime.cjs');
  runtime.installRuntime(init, protocol);

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
  const { loadNativeTexts, registerNativeTextHandlers } = require('./main/native-texts.cjs');
  const { shellWindow, registerWindowHandlers } = require('./main/windows.cjs');

  const ctx = {
    entryUrl: ENTRY_URL,
    playerViewUrl: `${ENTRY_URL}?view=player`,
    mainWindow: null,
    playerViewWindow: null,
    playerViewState: null,
    serverUrl: `http://127.0.0.1:${DEFAULT_PORT}`,
    hostConfig: null,
  };
  ctx.mainWindow = shellWindow('main', ctx.entryUrl, protocol);

  let ready;
  const whenReady = new Promise(resolve => { ready = resolve; });
  protocol.onInvoke(async message => {
    await whenReady;
    if (message.channel === '__tls:check') return runtime.checkCertificate(...(Array.isArray(message.args) ? message.args : []));
    const handler = runtime.handlers.get(message.channel);
    if (!handler) throw new Error(`Неизвестная команда: ${message.channel}`);
    const window = message.sender === 'player-view' ? ctx.playerViewWindow : message.sender === 'main' ? ctx.mainWindow : null;
    if (!window) throw new Error('Недопустимый источник команды.');
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    const args = Array.isArray(message.args) ? message.args : [];
    try {
      const result = await handler(event, ...args);
      if (result && typeof result === 'object' && result.status === 0) {
        console.error(`[bridge] ${message.channel} ${args[0]?.path ?? ''}: ${result.data?.message ?? 'no answer'}`);
      }
      return result;
    } catch (error) {
      console.error(`[bridge] ${message.channel} failed: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  });

  // Quitting waits for a clean pg_ctl stop so the data directory is not left locked; then a scheduled update installs.
  let stopping = null;
  function shutdown() {
    stopping ??= (async () => {
      await stopServer().catch(() => {});
      await stopDatabase().catch(() => {});
      updates.runScheduledInstall();
    })().finally(() => process.exit(0));
    return stopping;
  }
  protocol.onEvent(message => {
    if (message.name === 'shutdown' || message.name === 'shell-gone') void shutdown();
  });

  loadNativeTexts();
  startBackupSchedule(ctx);
  const stale = tunnel.cleanupStaleTunnels();
  if (stale) console.log(`Остановлено cloudflared прошлого сеанса: ${stale}`);
  await loadConfig(ctx);
  ctx.hostConfig = await loadOrCreateHostConfig();
  await initTls();

  registerConnectionHandlers(ctx);
  registerApiRequestHandler(ctx);
  registerAuthHandlers(ctx);
  registerTransferHandlers(ctx);
  registerLocalesAndModsHandlers(ctx);
  registerUpdateHandlers(ctx);
  registerHostServerHandlers(ctx);
  registerHostBackupHandlers(ctx);
  registerHostNetworkHandlers(ctx);
  registerWindowHandlers(ctx, protocol);
  registerNativeTextHandlers(ctx);
  ready();
  protocol.notify('host.ready');
}

start().catch(error => {
  protocol.notify('host.failed', { message: error instanceof Error ? error.message : String(error) });
  console.error(error);
  setTimeout(() => process.exit(1), 200);
});
