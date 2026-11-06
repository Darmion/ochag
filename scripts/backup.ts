import {cp, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {poolFromEnvironment} from '../apps/server/src/db.ts';
import {BACKUP_TABLES} from './backup-tables.ts';
import {replacer} from './backup-rows.ts';

// Must match the default in asset-routes.ts: the assets table stores only keys into this folder.
const assetsDir = process.env.ASSETS_DIR
  ? process.env.ASSETS_DIR
  : fileURLToPath(new URL('../data/assets/', import.meta.url));

const pool = poolFromEnvironment(false);
const client = await pool.connect();

try {
  const tables: Record<string, unknown[]> = {};

  for (const table of BACKUP_TABLES) {
    tables[table] = (await client.query(`SELECT * FROM ${table}`)).rows;
  }

  const schemaVersion = Number(
    (await client.query('SELECT max(version) AS version FROM schema_migrations')).rows[0]?.version,
  );

  const destDir = process.env.BACKUP_DIR ?? './backups';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const label = /^[a-z-]{1,20}$/.test(process.env.BACKUP_LABEL ?? '') ? `-${process.env.BACKUP_LABEL}` : '';
  const backupDir = `${destDir}/ttrpg-${stamp}${label}`;

  await mkdir(backupDir, {recursive: true});
  await writeFile(`${backupDir}/data.json`, JSON.stringify({schemaVersion, tables}, replacer, 2), 'utf8');
  await cp(assetsDir, `${backupDir}/assets`, {recursive: true, force: true}).catch(() => {
    // No assets directory yet (nothing uploaded) — nothing to copy.
  });

  console.log(`Backup written to ${backupDir}`);
} finally {
  client.release();
  await pool.end();
}
