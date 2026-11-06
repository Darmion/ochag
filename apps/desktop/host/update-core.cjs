// No Electron dependency: used by the tests and by the server (serving the installer).
//   { installers: [{ version, file, sha256, size, source, savedAt }] }
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MANIFEST = 'manifest.json';

function parseVersion(value) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(value ?? ''));
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;

  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }

  return 0;
}

function versionFromFileName(name) {
  const parsed = parseVersion(path.basename(String(name)));
  return parsed ? parsed.join('.') : null;
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function readManifest(dir) {
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(dir, MANIFEST), 'utf8'));
    return { installers: Array.isArray(parsed.installers) ? parsed.installers : [] };
  } catch {
    return { installers: [] };
  }
}

async function writeManifest(dir, manifest) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2), 'utf8');
}

async function installerFor(dir, version) {
  const manifest = await readManifest(dir);
  const entry = manifest.installers.find(item => item.version === version);
  if (!entry) return null;

  const file = path.join(dir, path.basename(entry.file));

  try {
    const stat = await fsp.stat(file);
    if (stat.size !== entry.size) return null;
    return { ...entry, path: file };
  } catch {
    return null;
  }
}

async function registerInstaller(dir, sourceFile, version, source) {
  await fsp.mkdir(dir, { recursive: true });
  const fileName = `Ochag-Setup-${version}.exe`;
  const target = path.join(dir, fileName);

  if (path.resolve(sourceFile) !== path.resolve(target)) {
    await fsp.copyFile(sourceFile, target);
  }

  const stat = await fsp.stat(target);
  const entry = {
    version,
    file: fileName,
    sha256: await sha256File(target),
    size: stat.size,
    source,
    savedAt: new Date().toISOString(),
  };

  const manifest = await readManifest(dir);
  manifest.installers = [entry, ...manifest.installers.filter(item => item.version !== version)];
  await writeManifest(dir, manifest);
  return { ...entry, path: target };
}

async function downloadFile(fetchImpl, url, target, { expectedSha256, expectedSize, headers, onProgress, timeoutMs = 30 * 60_000 } = {}) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.part`;

  const response = await fetchImpl(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || !response.body) throw new Error(`Не удалось скачать: ответ ${response.status}.`);

  const total = Number(response.headers.get('content-length')) || expectedSize || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(partial);
  let received = 0;

  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      hash.update(buffer);
      received += buffer.length;
      if (!out.write(buffer)) await new Promise(resolve => out.once('drain', resolve));
      onProgress?.({ received, total });
    }
    await new Promise((resolve, reject) => out.end(error => (error ? reject(error) : resolve())));
  } catch (error) {
    out.destroy();
    await fsp.rm(partial, { force: true });
    throw error;
  }

  const sha256 = hash.digest('hex');

  if ((expectedSize && received !== expectedSize) || (expectedSha256 && sha256 !== expectedSha256)) {
    await fsp.rm(partial, { force: true });
    throw new Error('Скачанный файл повреждён (не совпала контрольная сумма). Попробуйте ещё раз.');
  }

  await fsp.rm(target, { force: true });
  await fsp.rename(partial, target);
  return { sha256, size: received };
}

function assertRepository(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) {
    throw new Error('Укажите репозиторий в виде «владелец/репозиторий», например «Darmion/ochag».');
  }
}

function githubJson(fetchImpl, url) {
  return fetchImpl(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Ochag-updater' },
    signal: AbortSignal.timeout(15_000),
  });
}

function installerAsset(release) {
  return (release.assets ?? []).find(item => /\.exe$/i.test(item.name) && /setup/i.test(item.name))
    ?? (release.assets ?? []).find(item => /\.exe$/i.test(item.name));
}

function assetSha256(asset) {
  return /^sha256:([0-9a-f]{64})$/i.exec(String(asset?.digest ?? ''))?.[1].toLowerCase() ?? null;
}

async function latestGitHubRelease(fetchImpl, repository) {
  assertRepository(repository);
  const response = await githubJson(fetchImpl, `https://api.github.com/repos/${repository}/releases/latest`);

  if (response.status === 404) throw new Error(`В репозитории ${repository} нет опубликованных релизов (или он закрытый).`);
  if (!response.ok) throw new Error(`GitHub ответил ${response.status}. Попробуйте позже.`);

  const release = await response.json();
  const version = versionFromFileName(release.tag_name) ?? versionFromFileName(release.name);
  const asset = installerAsset(release);

  if (!version) throw new Error('У последнего релиза нет номера версии в теге (например v0.3.0).');
  if (!asset) throw new Error(`В релизе ${release.tag_name} нет установщика .exe.`);

  return {
    version,
    tag: release.tag_name,
    notes: String(release.body ?? '').slice(0, 4000),
    publishedAt: release.published_at ?? null,
    asset: { name: asset.name, url: asset.browser_download_url, size: asset.size, sha256: assetSha256(asset) },
  };
}

// An installer from the GM's server runs on the player's computer, so its checksum is compared with the official release, never only with what the server itself reports.
async function officialInstaller(fetchImpl, repository, version) {
  assertRepository(repository);
  let response;
  try {
    response = await githubJson(fetchImpl, `https://api.github.com/repos/${repository}/releases/tags/v${version}`);
  } catch {
    return { state: 'unknown', reason: 'GitHub недоступен с этого компьютера.' };
  }
  if (response.status === 404) return { state: 'missing' };
  if (!response.ok) return { state: 'unknown', reason: `GitHub ответил ${response.status}.` };
  const sha256 = assetSha256(installerAsset(await response.json()));
  return sha256 ? { state: 'known', sha256 } : { state: 'unknown', reason: `У выпуска ${version} нет контрольной суммы установщика.` };
}

module.exports = {
  compareVersions,
  versionFromFileName,
  sha256File,
  readManifest,
  installerFor,
  registerInstaller,
  downloadFile,
  latestGitHubRelease,
  officialInstaller,
};
