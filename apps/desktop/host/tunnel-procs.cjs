// cloudflared processes must die with the app. No Electron here, so apps/server/test/system/tunnel-procs.test.ts can load it.
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function imageOf(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {windowsHide: true, timeout: 5000}).toString();
      const match = /^"([^"]+)","(\d+)"/m.exec(out);
      return match && Number(match[2]) === pid ? match[1] : null;
    }
    return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
  } catch {
    return null;
  }
}

function forceKill(pid) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {windowsHide: true, timeout: 5000, stdio: 'ignore'});
    else process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

function createTunnelProcs({pidFile, imageName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'}) {
  const procs = new Set();

  function save() {
    try {
      const pids = [...procs].map(proc => proc.pid).filter(pid => Number.isInteger(pid));
      if (pids.length) fs.writeFileSync(pidFile, JSON.stringify(pids));
      else fs.rmSync(pidFile, {force: true});
    } catch {
    }
  }

  function track(proc) {
    procs.add(proc);
    save();
    proc.once('exit', () => {
      procs.delete(proc);
      save();
    });
  }

  function killOne(proc, timeoutMs) {
    return new Promise(resolve => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
      const timer = setTimeout(() => {
        if (proc.pid) forceKill(proc.pid);
        resolve();
      }, timeoutMs);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        proc.kill();
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  async function killAll(timeoutMs = 3000) {
    await Promise.all([...procs].map(proc => killOne(proc, timeoutMs)));
  }

  function killAllSync() {
    for (const proc of procs) {
      try {
        proc.kill();
      } catch {
      }
    }
  }

  function cleanupStale() {
    let pids = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
      pids = Array.isArray(parsed) ? parsed.filter(pid => Number.isInteger(pid) && pid > 0) : [];
    } catch {
      return 0;
    }
    const mine = new Set([...procs].map(proc => proc.pid));
    let killed = 0;
    for (const pid of pids) {
      if (mine.has(pid) || !isAlive(pid)) continue;
      const image = imageOf(pid);
      if (!image || image.toLowerCase() !== imageName.toLowerCase()) continue;
      if (forceKill(pid)) killed += 1;
    }
    save();
    return killed;
  }

  return {track, killAll, killAllSync, cleanupStale, count: () => procs.size};
}

module.exports = {createTunnelProcs, imageOf, isAlive};
