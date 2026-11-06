const {app} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const {spawn} = require('node:child_process');
const {assetsDir} = require('./server.cjs');
const {autoBackupsToPrune, latestComplete, listBackupsIn} = require('./backup-core.cjs');

function backupsDir() {
  return path.join(app.getPath('userData'), 'backups');
}

function runScript(script, args, env, failure) {
  return new Promise((resolve, reject) => {
    const entry = path.join(app.getAppPath(), script);
    let stdout = '';
    let stderr = '';

    const proc = spawn(process.execPath, [entry, ...args], {
      env: {...process.env, ELECTRON_RUN_AS_NODE: '1', ...env},
      windowsHide: true,
    });

    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

    proc.once('error', reject);
    proc.once('exit', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(lastLine(stderr) || `${failure} (код ${code})`));
    });
  });
}

function lastLine(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const message = lines.find(line => /^error:/i.test(line));
  return (message ?? lines[lines.length - 1] ?? '').replace(/^error:\s*/i, '');
}

function dbEnv(config) {
  return {
    DB_HOST: '127.0.0.1',
    DB_PORT: String(config.postgresPort),
    POSTGRES_PASSWORD: config.postgresPassword,
    ASSETS_DIR: assetsDir(),
  };
}

async function createBackup(config, label = '') {
  await runScript('scripts/backup.ts', [], { ...dbEnv(config), BACKUP_DIR: backupsDir(), BACKUP_LABEL: label }, 'Резервное копирование не удалось');
  return listBackups();
}

async function assertBackupExists(name) {
  const backups = await listBackups();
  const backup = typeof name === 'string' && /^ttrpg-[0-9A-Za-z-]+$/.test(name) ? backups.find(entry => entry.name === name) : undefined;
  if (!backup) throw new Error('Такой резервной копии нет.');
  if (!backup.complete) throw new Error('Копия неполная: в папке нет данных базы (data.json) — восстановить из неё нельзя.');
}

async function restoreBackup(config, name) {
  await assertBackupExists(name);
  try {
    await runScript('scripts/restore.ts', [path.join(backupsDir(), name)], dbEnv(config), 'Восстановление не удалось');
  } catch (error) {
    const versions = /schema version (\d+), but this database is at version (\d+)/.exec(error.message);
    if (versions) {
      throw new Error(`Копия сделана более новой версией приложения (база версии ${versions[1]}, у этого приложения — ${versions[2]}): сначала обновите приложение. Данные не изменены.`);
    }
    throw error;
  }
}

async function pruneAutoBackups(keep) {
  for (const name of autoBackupsToPrune(await listBackups(), keep)) {
    await fs.rm(path.join(backupsDir(), name), {recursive: true, force: true, maxRetries: 3, retryDelay: 200});
  }
}

function listBackups() {
  return listBackupsIn(backupsDir());
}

async function latestBackup() {
  return latestComplete(await listBackups());
}

async function deleteBrokenBackup(name) {
  const backup = typeof name === 'string' && /^ttrpg-[0-9A-Za-z-]+$/.test(name)
    ? (await listBackups()).find(entry => entry.name === name)
    : undefined;
  if (!backup) throw new Error('Такой резервной копии нет.');
  if (backup.complete) throw new Error('Это целая копия — удалить её отсюда нельзя.');
  await fs.rm(path.join(backupsDir(), backup.name), {recursive: true, force: true, maxRetries: 3, retryDelay: 200});
  return listBackups();
}

module.exports = {createBackup, listBackups, latestBackup, assertBackupExists, restoreBackup, pruneAutoBackups, deleteBrokenBackup};
