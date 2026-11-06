const {app} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
// Transpiled ESM: require() returns the interop wrapper, hence .default.
const EmbeddedPostgres = require('embedded-postgres').default;
const {missingVcRuntime, isDllNotFound, vcRuntimeError} = require('./vc-runtime.cjs');

const execFileAsync = promisify(execFile);

// embedded-postgres stops with `taskkill /f /t` (a WAL recovery on every start), so stop uses pg_ctl. Required lazily: a require during the package's own dynamic import throws ERR_REQUIRE_ESM_RACE_CONDITION.
function pgCtlPath() {
  return require('@embedded-postgres/windows-x64').pg_ctl;
}

let instance = null;
let runningDir = null;

function databaseDir() {
  return path.join(app.getPath('userData'), 'pgdata');
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

// Idempotent: starting again while Postgres runs fails on postmaster.pid and rejects with undefined.
let starting = null;

async function ensureDatabaseRunning(config) {
  if (instance && runningDir) return;
  if (starting) return starting;

  starting = (async () => {
    try {
      await startDatabase(config);
    } catch (error) {
      instance = null;
      runningDir = null;
      if (isDllNotFound(error)) throw vcRuntimeError();
      throw error instanceof Error ? error : new Error('Не удалось запустить базу данных. Перезапустите приложение.');
    }
  })().finally(() => { starting = null; });
  return starting;
}

function isDatabaseRunning() {
  return Boolean(instance && runningDir);
}

async function startDatabase(config) {
  const systemRoot = (!app.isPackaged && process.env.TTRPG_SYSTEM_ROOT_OVERRIDE) || undefined;
  if (missingVcRuntime({systemRoot}).length) throw vcRuntimeError();
  const dir = databaseDir();
  const alreadyInitialised = await pathExists(path.join(dir, 'PG_VERSION'));

  instance = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'ttrpg_dev',
    password: config.postgresPassword,
    port: config.postgresPort,
    persistent: true,
    // Force UTF-8: the Windows binaries default to the OS codepage (WIN1251 on Russian Windows).
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  if (!alreadyInitialised) {
    await instance.initialise();
    await instance.start();
    await instance.createDatabase('ttrpg');
  } else {
    await instance.start();
  }

  runningDir = dir;
}

async function stopDatabase() {
  if (!instance || !runningDir) return;

  await execFileAsync(pgCtlPath(), ['stop', '-D', runningDir, '-m', 'fast', '-w']);
  instance = null;
  runningDir = null;
}

module.exports = {ensureDatabaseRunning, isDatabaseRunning, stopDatabase};
