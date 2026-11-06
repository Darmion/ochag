// No Electron dependency: used by backups.cjs and apps/server/test/system/backup-core.test.ts.
const fs = require('node:fs/promises');
const path = require('node:path');

function backupTime(name) {
  const match = /^ttrpg-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name);
  if (!match) return null;
  const time = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function backupKind(name) {
  return name.endsWith('-auto') ? 'auto' : name.endsWith('-before-restore') ? 'before-restore' : 'manual';
}

async function dirSizeBytes(dir) {
  let total = 0;

  for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
    const entryPath = path.join(dir, entry.name);
    total += entry.isDirectory() ? await dirSizeBytes(entryPath) : (await fs.stat(entryPath)).size;
  }

  return total;
}

async function listBackupsIn(dir) {
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }

  const folders = await Promise.all(
    names
      .filter(name => name.startsWith('ttrpg-'))
      .map(async name => {
        const fullPath = path.join(dir, name);
        const stat = await fs.stat(fullPath).catch(() => null);
        if (!stat?.isDirectory()) return null;

        const data = await fs.stat(path.join(fullPath, 'data.json')).catch(() => null);
        return {
          name,
          kind: backupKind(name),
          createdAt: backupTime(name) ?? stat.mtime.toISOString(),
          sizeBytes: await dirSizeBytes(fullPath).catch(() => 0),
          complete: Boolean(data?.isFile() && data.size > 0),
        };
      }),
  );

  return folders.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function latestComplete(list) {
  return list.find(entry => entry.complete) ?? null;
}

function autoBackupsToPrune(list, keep) {
  const autos = list.filter(entry => entry.kind === 'auto');
  const kept = new Set(autos.filter(entry => entry.complete).slice(0, Math.max(1, keep)).map(entry => entry.name));
  return autos.filter(entry => !kept.has(entry.name)).map(entry => entry.name);
}

module.exports = {backupTime, backupKind, listBackupsIn, latestComplete, autoBackupsToPrune};
