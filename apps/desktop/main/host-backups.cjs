const { ipcMain } = require('electron');
const { saveHostConfig } = require('../host/config.cjs');
const { ensureDatabaseRunning, isDatabaseRunning, stopDatabase } = require('../host/database.cjs');
const { startServer, stopServer, getStatus } = require('../host/server.cjs');
const { createBackup, listBackups, latestBackup, assertBackupExists, restoreBackup, pruneAutoBackups, deleteBrokenBackup } = require('../host/backups.cjs');
const { validateSender } = require('./senders.cjs');

let restoring = false;
let backingUp = false;

async function runScheduledBackup(ctx) {
  if (!ctx.hostConfig || backingUp || restoring) return;
  if (!ctx.hostConfig.autoBackupHours || getStatus(ctx.hostConfig).state !== 'running') return;

  const latest = await latestBackup();
  const age = latest ? Date.now() - Date.parse(latest.createdAt) : Infinity;
  if (age < ctx.hostConfig.autoBackupHours * 3600 * 1000) return;

  backingUp = true;
  try {
    await createBackup(ctx.hostConfig, 'auto');
    await pruneAutoBackups(ctx.hostConfig.autoBackupKeep);
  } catch (error) {
    console.error('Автоматическая резервная копия не удалась:', error instanceof Error ? error.message : error);
  } finally {
    backingUp = false;
  }
}

function startBackupSchedule(ctx) {
  setInterval(() => void runScheduledBackup(ctx), 10 * 60 * 1000).unref();
}

function registerHostBackupHandlers(ctx) {
  ipcMain.handle('host:backup', async event => {
    validateSender(ctx, event);
    return createBackup(ctx.hostConfig);
  });

  ipcMain.handle('host:listBackups', async event => {
    validateSender(ctx, event);
    return listBackups();
  });

  ipcMain.handle('host:deleteBrokenBackup', async (event, name) => {
    validateSender(ctx, event);
    if (restoring || backingUp) throw new Error('Идёт резервное копирование или восстановление — повторите через минуту.');
    return deleteBrokenBackup(name);
  });

  ipcMain.handle('host:restore', async (event, name) => {
    validateSender(ctx, event);
    if (restoring) throw new Error('Восстановление уже идёт.');
    if (backingUp) throw new Error('Идёт резервное копирование — повторите через минуту.');
    await assertBackupExists(name);
    restoring = true;

    const databaseWasRunning = isDatabaseRunning();
    const serverWasRunning = getStatus(ctx.hostConfig).state === 'running';
    try {
      await ensureDatabaseRunning(ctx.hostConfig);
      await createBackup(ctx.hostConfig, 'before-restore');
      await stopServer();
      try {
        await restoreBackup(ctx.hostConfig, name);
      } finally {
        if (serverWasRunning) await startServer(ctx.hostConfig);
      }
      return listBackups();
    } finally {
      if (!databaseWasRunning && !serverWasRunning) await stopDatabase().catch(() => {});
      restoring = false;
    }
  });

  ipcMain.handle('host:getBackupSchedule', event => {
    validateSender(ctx, event);
    return { hours: ctx.hostConfig.autoBackupHours, keep: ctx.hostConfig.autoBackupKeep };
  });

  ipcMain.handle('host:setBackupSchedule', async (event, input) => {
    validateSender(ctx, event);
    const hours = Number(input?.hours);
    const keep = Number(input?.keep);
    if (![0, 6, 12, 24, 72, 168].includes(hours)) throw new Error('Некорректный интервал.');
    if (!Number.isInteger(keep) || keep < 1 || keep > 50) throw new Error('Хранить можно от 1 до 50 копий.');
    ctx.hostConfig.autoBackupHours = hours;
    ctx.hostConfig.autoBackupKeep = keep;
    await saveHostConfig(ctx.hostConfig);
    void runScheduledBackup(ctx);
    return { hours, keep };
  });
}

module.exports = { runScheduledBackup, startBackupSchedule, registerHostBackupHandlers };
