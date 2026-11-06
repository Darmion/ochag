const {app, net} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const {spawn} = require('node:child_process');
const core = require('./update-core.cjs');

function updatesDir() {
  return path.join(app.getPath('userData'), 'updates');
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'update-settings.json');
}

function currentVersion() {
  return (!app.isPackaged && process.env.TTRPG_VERSION_OVERRIDE) || app.getVersion();
}

async function defaultRepository() {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(app.getAppPath(), 'package.json'), 'utf8'));
    return typeof pkg.updateRepository === 'string' ? pkg.updateRepository : '';
  } catch {
    return '';
  }
}

async function readSettings() {
  let saved = {};

  try {
    saved = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
  } catch {
    saved = {};
  }

  // Alpha builds shipped the placeholder «ttrpg-foundation»; anything not «owner/name» falls back to the built-in repository.
  const savedRepository = typeof saved.repository === 'string' ? saved.repository.trim() : '';
  return {
    repository: /^[\w.-]+\/[\w.-]+$/.test(savedRepository) ? savedRepository : await defaultRepository(),
    autoCheck: saved.autoCheck !== false,
  };
}

async function saveSettings(input) {
  const current = await readSettings();
  const next = {
    repository: typeof input?.repository === 'string' ? input.repository.trim().slice(0, 200) : current.repository,
    autoCheck: typeof input?.autoCheck === 'boolean' ? input.autoCheck : current.autoCheck,
  };

  await fs.mkdir(app.getPath('userData'), {recursive: true});
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function getState() {
  const settings = await readSettings();
  const manifest = await core.readManifest(updatesDir());
  const version = currentVersion();

  return {
    currentVersion: version,
    packaged: app.isPackaged,
    ...settings,
    installers: manifest.installers.map(({version: v, size, source, savedAt}) => ({version: v, size, source, savedAt})),
    sharingCurrent: Boolean(await core.installerFor(updatesDir(), version)),
  };
}

async function checkGitHub() {
  const {repository} = await readSettings();
  const release = await core.latestGitHubRelease(net.fetch, repository);
  const saved = await core.installerFor(updatesDir(), release.version);

  return {
    repository,
    currentVersion: currentVersion(),
    ...release,
    newer: core.compareVersions(release.version, currentVersion()) > 0,
    downloaded: Boolean(saved),
  };
}

async function downloadGitHub(onProgress) {
  const release = await checkGitHub();
  if (!release.newer) throw new Error(`Новее вашей версии ${release.currentVersion} на GitHub нет.`);
  if (release.downloaded) return release;

  const target = path.join(updatesDir(), `Ochag-Setup-${release.version}.exe`);
  await core.downloadFile(net.fetch, release.asset.url, target, {
    expectedSize: release.asset.size,
    ...(release.asset.sha256 ? {expectedSha256: release.asset.sha256} : {}),
    headers: {'User-Agent': 'Ochag-updater'},
    onProgress,
  });
  await core.registerInstaller(updatesDir(), target, release.version, 'github');
  return {...release, downloaded: true};
}

async function checkServer(serverUrl) {
  const response = await net.fetch(`${serverUrl}/update/info`, {signal: AbortSignal.timeout(8000)});
  if (!response.ok) throw new Error('Сервер мастера не сообщает версию — у него, скорее всего, старая версия приложения без обновлений.');

  const info = await response.json();
  const comparison = core.compareVersions(info.version, currentVersion());

  return {
    serverUrl,
    currentVersion: currentVersion(),
    serverVersion: String(info.version ?? ''),
    installerAvailable: Boolean(info.installer),
    newer: comparison > 0,
    older: comparison < 0,
  };
}

async function downloadFromServer(serverUrl, onProgress, {allowUnverified = false} = {}) {
  const response = await net.fetch(`${serverUrl}/update/info`, {signal: AbortSignal.timeout(8000)});
  const info = response.ok ? await response.json() : null;

  if (!info?.installer) {
    throw new Error('На сервере мастера нет установщика его версии. Попросите мастера открыть «Обновления» и скачать или выбрать установщик.');
  }

  const version = String(info.version ?? '');
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[0-9a-f]{64}$/.test(String(info.installer.sha256 ?? ''))) {
    throw new Error('Сервер мастера сообщил о своём установщике что-то непонятное — скачайте обновление с GitHub.');
  }

  if (core.compareVersions(version, currentVersion()) <= 0) {
    throw new Error(`У мастера версия ${version} — не новее вашей.`);
  }

  const official = await core.officialInstaller(net.fetch, (await readSettings()).repository, version);
  if (official.state === 'known' && official.sha256 !== info.installer.sha256) {
    throw new Error(`Установщик на сервере мастера не совпадает с официальным выпуском ${version} на GitHub, поэтому я его не скачал. Обновитесь через GitHub ниже.`);
  }
  if (official.state === 'missing') {
    throw new Error(`Версии ${version} нет среди официальных выпусков на GitHub, поэтому установщик мастера я не скачал. Если мастер собрал приложение сам, возьмите у него файл и выберите его кнопкой «Выбрать установщик…».`);
  }
  if (official.state === 'unknown' && !allowUnverified) return {version, unverified: true, reason: official.reason};

  const expectedSha256 = official.state === 'known' ? official.sha256 : info.installer.sha256;
  const saved = await core.installerFor(updatesDir(), version);
  if (saved && saved.sha256 === expectedSha256) return {version};

  const target = path.join(updatesDir(), `Ochag-Setup-${version}.exe`);
  await core.downloadFile(net.fetch, `${serverUrl}/update/installer`, target, {
    expectedSha256,
    expectedSize: info.installer.size,
    onProgress,
  });
  await core.registerInstaller(updatesDir(), target, version, 'server');
  return {version};
}

async function importInstaller(filePath) {
  const version = core.versionFromFileName(filePath);
  if (!version) throw new Error('В имени файла нет версии. Нужен установщик вида «Ochag-Setup-0.3.0.exe».');

  await core.registerInstaller(updatesDir(), filePath, version, 'manual');
  return {version};
}

let scheduledInstaller = null;

// The installer starts after a normal quit (main.cjs, will-quit), otherwise it hits the running app and its database.
async function scheduleInstall(version) {
  const installer = await core.installerFor(updatesDir(), version);
  if (!installer) throw new Error(`Установщика версии ${version} нет — скачайте его заново.`);

  scheduledInstaller = installer.path;
  app.quit();
}

function runScheduledInstall() {
  if (!scheduledInstaller) return;

  const child = spawn(scheduledInstaller, [], {detached: true, stdio: 'ignore', windowsHide: false});
  child.unref();
  scheduledInstaller = null;
}

module.exports = {
  updatesDir,
  currentVersion,
  getState,
  saveSettings,
  checkGitHub,
  downloadGitHub,
  checkServer,
  downloadFromServer,
  importInstaller,
  scheduleInstall,
  runScheduledInstall,
};
