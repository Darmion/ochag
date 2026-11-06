import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const {createTunnelProcs, isAlive} = createRequire(import.meta.url)('../../../desktop/host/tunnel-procs.cjs');

const NODE_IMAGE = process.platform === 'win32' ? path.basename(process.execPath) : 'node';
const sleeper = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {windowsHide: true});
const exited = (proc: ChildProcess) => new Promise<void>(resolve => {
  if (proc.exitCode !== null || proc.signalCode !== null) resolve();
  else proc.once('exit', () => resolve());
});

test('tunnel processes: every started one is stopped, stale ones are cleaned up by image', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ttrpg-tunnel-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const pidFile = path.join(dir, 'tunnel.pid');

  await t.test('two started at once — both are tracked and both stop; the pid file goes away', async () => {
    const procs = createTunnelProcs({pidFile, imageName: NODE_IMAGE});
    const first = sleeper();
    const second = sleeper();
    procs.track(first);
    procs.track(second);
    assert.deepEqual(JSON.parse(readFileSync(pidFile, 'utf8')).sort(), [first.pid, second.pid].sort());
    await procs.killAll(3000);
    await Promise.all([exited(first), exited(second)]);
    assert.equal(procs.count(), 0);
    assert.equal(existsSync(pidFile), false);
  });

  await t.test('a process left from a crashed session is killed at start — but only if it is the same program', async () => {
    const orphan = sleeper();
    t.after(() => { try { orphan.kill(); } catch {  } });
    await new Promise(resolve => setTimeout(resolve, 300));
    writeFileSync(pidFile, JSON.stringify([orphan.pid]));
    assert.equal(createTunnelProcs({pidFile, imageName: 'cloudflared.exe'}).cleanupStale(), 0);
    assert.equal(isAlive(orphan.pid), true);
    writeFileSync(pidFile, JSON.stringify([orphan.pid]));
    assert.equal(createTunnelProcs({pidFile, imageName: NODE_IMAGE}).cleanupStale(), 1);
    await exited(orphan);
    assert.equal(existsSync(pidFile), false);
  });
});
