import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, mkdtemp, rm, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const core = createRequire(import.meta.url)('../../../desktop/host/backup-core.cjs');

test('backup list: time from the folder name, incomplete copies flagged', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ttrpg-backups-'));
  t.after(() => rm(dir, {recursive: true, force: true}));

  async function folder(name: string, withData: boolean) {
    await mkdir(path.join(dir, name, 'assets'), {recursive: true});
    if (withData) await writeFile(path.join(dir, name, 'data.json'), '{"schemaVersion":93,"tables":{}}');
  }
  await folder('ttrpg-2026-10-10T04-11-52-841Z-auto', false);
  await folder('ttrpg-2026-10-15T19-17-30-317Z-auto', true);
  await folder('ttrpg-2026-10-16T19-23-55-187Z-auto', true);
  await folder('ttrpg-2026-10-14T19-12-44-289Z', true);
  await folder('ttrpg-2026-10-14T19-12-44-621Z-before-restore', true);
  await writeFile(path.join(dir, 'ttrpg-not-a-folder.txt'), 'x');
  await mkdir(path.join(dir, 'unrelated'));
  const now = new Date();
  await utimes(path.join(dir, 'ttrpg-2026-10-10T04-11-52-841Z-auto'), now, now);

  await t.test('time comes from the name, not the folder date', async () => {
    assert.equal(core.backupTime('ttrpg-2026-10-16T19-23-55-187Z-auto'), '2026-10-16T19:23:55.187Z');
    assert.equal(core.backupTime('ttrpg-2026-10-14T19-12-44-289Z'), '2026-10-14T19:12:44.289Z');
    assert.equal(core.backupTime('ttrpg-old-name'), null);
    assert.equal(core.backupKind('ttrpg-2026-10-14T19-12-44-621Z-before-restore'), 'before-restore');
    assert.equal(core.backupKind('ttrpg-2026-10-14T19-12-44-289Z'), 'manual');

    const list = await core.listBackupsIn(dir);
    assert.deepEqual(list.map((entry: {name: string}) => entry.name), [
      'ttrpg-2026-10-16T19-23-55-187Z-auto',
      'ttrpg-2026-10-15T19-17-30-317Z-auto',
      'ttrpg-2026-10-14T19-12-44-621Z-before-restore',
      'ttrpg-2026-10-14T19-12-44-289Z',
      'ttrpg-2026-10-10T04-11-52-841Z-auto',
    ]);
    assert.equal(list[4].complete, false);
    assert.ok(list.slice(0, 4).every((entry: {complete: boolean}) => entry.complete));
    assert.ok(list[0].sizeBytes > 0);
  });

  await t.test('the schedule counts from the newest complete copy', async () => {
    const list = await core.listBackupsIn(dir);
    assert.equal(core.latestComplete(list).name, 'ttrpg-2026-10-16T19-23-55-187Z-auto');
    assert.equal(core.latestComplete([{name: 'x', complete: false}]), null);
  });

  await t.test('pruning keeps the newest complete autos and drops broken ones', async () => {
    const list = await core.listBackupsIn(dir);
    assert.deepEqual(core.autoBackupsToPrune(list, 1), [
      'ttrpg-2026-10-15T19-17-30-317Z-auto',
      'ttrpg-2026-10-10T04-11-52-841Z-auto',
    ]);
    assert.deepEqual(core.autoBackupsToPrune(list, 7), ['ttrpg-2026-10-10T04-11-52-841Z-auto']);
    assert.deepEqual(core.autoBackupsToPrune(list, 0), core.autoBackupsToPrune(list, 1));
  });

  await t.test('a missing folder is an empty list', async () => {
    assert.deepEqual(await core.listBackupsIn(path.join(dir, 'nope')), []);
  });
});
