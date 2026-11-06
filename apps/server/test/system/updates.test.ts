import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

const core = createRequire(import.meta.url)('../../../desktop/host/update-core.cjs');

test('update system: versions, installers, downloads and serving', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ttrpg-updates-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const fakeInstaller = Buffer.from('MZ fake installer bytes '.repeat(200));
  const source = path.join(dir, 'TTRPG Setup 0.3.0.exe');
  await writeFile(source, fakeInstaller);

  await t.test('versions are compared numerically and read from file names', () => {
    assert.ok(core.compareVersions('0.10.0', '0.9.9') > 0);
    assert.ok(core.compareVersions('0.2.0', '0.3.0') < 0);
    assert.equal(core.compareVersions('v1.2.3', '1.2.3'), 0);
    assert.equal(core.versionFromFileName('C:/x/TTRPG Setup 0.3.0.exe'), '0.3.0');
    assert.equal(core.versionFromFileName('installer.exe'), null);
  });

  await t.test('a registered installer is found by version, a damaged one is not', async () => {
    const entry = await core.registerInstaller(dir, source, '0.3.0', 'manual');
    assert.equal(entry.size, fakeInstaller.length);
    assert.equal((await core.installerFor(dir, '0.3.0')).sha256, entry.sha256);
    assert.equal(await core.installerFor(dir, '0.4.0'), null);
  });

  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {appVersion: '0.3.0', updateDir: dir});
  t.after(() => app.close());

  await t.test('the GM server reports its version and serves its installer', async () => {
    assert.equal((await app.inject('/health')).json().appVersion, '0.3.0');
    const info = (await app.inject('/update/info')).json();
    assert.equal(info.version, '0.3.0');
    assert.equal(info.installer.size, fakeInstaller.length);
    const download = await app.inject('/update/installer');
    assert.equal(download.statusCode, 200);
    assert.deepEqual(download.rawPayload, fakeInstaller);

    const bare = await buildApp(db, {appVersion: '0.2.0', updateDir: dir});
    try {
      assert.equal((await bare.inject('/update/info')).json().installer, null, 'only an installer of the server own version is offered');
      assert.equal((await bare.inject('/update/installer')).statusCode, 404);
    } finally { await bare.close(); }
  });

  await t.test('a player downloads from the GM server and the checksum is verified', async () => {
    const address = await app.listen({host: '127.0.0.1', port: 0});
    const info = (await (await fetch(`${address}/update/info`)).json()) as any;
    const target = path.join(dir, 'player', 'Ochag-Setup-0.3.0.exe');
    let progressCalls = 0;
    await core.downloadFile(fetch, `${address}/update/installer`, target, {expectedSha256: info.installer.sha256, expectedSize: info.installer.size, onProgress: () => { progressCalls++; }});
    assert.deepEqual(await readFile(target), fakeInstaller);
    assert.ok(progressCalls > 0);

    await assert.rejects(
      core.downloadFile(fetch, `${address}/update/installer`, path.join(dir, 'player', 'bad.exe'), {expectedSha256: 'f'.repeat(64)}),
      /повреждён/,
    );
  });

  await t.test('the latest GitHub release is read from tag and assets', async () => {
    const fakeFetch = async (url: string) => {
      assert.equal(url, 'https://api.github.com/repos/owner/ochag/releases/latest');
      return new Response(JSON.stringify({
        tag_name: 'v0.4.1', body: 'Что нового',
        assets: [{name: 'TTRPG Setup 0.4.1.exe.blockmap', browser_download_url: 'x', size: 1}, {name: 'TTRPG Setup 0.4.1.exe', browser_download_url: 'https://example/setup.exe', size: 1234}],
      }), {status: 200});
    };
    const release = await core.latestGitHubRelease(fakeFetch, 'owner/ochag');
    assert.equal(release.version, '0.4.1');
    assert.equal(release.asset.url, 'https://example/setup.exe');
    assert.equal(release.asset.sha256, null, 'an asset without a digest is still downloadable, checked by size');
    await assert.rejects(core.latestGitHubRelease(fakeFetch, 'не репозиторий'), /владелец\/репозиторий/);
  });

  await t.test('an installer from the GM is checked against the official release on GitHub', async () => {
    const digest = 'a'.repeat(64);
    const github = (status: number, assets: unknown[] = []) => async (url: string) => {
      assert.equal(url, 'https://api.github.com/repos/owner/ochag/releases/tags/v0.4.1');
      return new Response(JSON.stringify({tag_name: 'v0.4.1', assets}), {status});
    };
    const official = await core.officialInstaller(github(200, [{name: 'Ochag-Setup-0.4.1.exe', digest: `sha256:${digest.toUpperCase()}`}]), 'owner/ochag', '0.4.1');
    assert.deepEqual(official, {state: 'known', sha256: digest});
    assert.equal((await core.officialInstaller(github(404), 'owner/ochag', '0.4.1')).state, 'missing', 'a version GitHub never released is refused, not offered for a confirm');
    assert.equal((await core.officialInstaller(github(200, [{name: 'Ochag-Setup-0.4.1.exe'}]), 'owner/ochag', '0.4.1')).state, 'unknown');
    const offline = await core.officialInstaller(async () => { throw new TypeError('fetch failed'); }, 'owner/ochag', '0.4.1');
    assert.equal(offline.state, 'unknown');
    assert.match(offline.reason, /GitHub недоступен/);
  });
});
