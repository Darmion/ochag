import {cp, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {poolFromEnvironment} from '../apps/server/src/db.ts';
import {BACKUP_TABLES, LATE_COLUMNS} from './backup-tables.ts';
import {restoreRows, reviver} from './backup-rows.ts';
import {upgradeBackupTables} from './backup-upgrade.ts';
import {MIGRATIONS} from './migrations.ts';

const backupDir = process.argv[2];
if (!backupDir) throw new Error('Usage: node scripts/restore.ts <backup-folder>');

const assetsDir = process.env.ASSETS_DIR
  ? process.env.ASSETS_DIR
  : fileURLToPath(new URL('../data/assets/', import.meta.url));

const backup = JSON.parse(await readFile(`${backupDir}/data.json`, 'utf8'), reviver) as {
  schemaVersion: number;
  tables: Record<string, Array<Record<string, unknown>>>;
};

const pool = poolFromEnvironment(false);
const client = await pool.connect();

try {
  await client.query('BEGIN');

  const currentVersion = Number(
    (await client.query('SELECT max(version) AS version FROM schema_migrations')).rows[0]?.version,
  );

  if (backup.schemaVersion > currentVersion) {
    throw new Error(
      `Backup is for schema version ${backup.schemaVersion}, but this database is at version ${currentVersion}. ` +
      'Update the application first.',
    );
  }

  const tables = backup.schemaVersion < currentVersion
    ? await upgradeBackupTables(
      client,
      backup.tables,
      backup.schemaVersion,
      await Promise.all(MIGRATIONS.map(async ([version, file]) => ({version, sql: await readFile(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8')}))),
      BACKUP_TABLES,
      LATE_COLUMNS,
    )
    : backup.tables;

  await restoreRows(client, tables, BACKUP_TABLES, LATE_COLUMNS);

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}

// Files are copied only after the DB commit succeeds.
await cp(`${backupDir}/assets`, assetsDir, {recursive: true, force: true}).catch(() => {
  // The backup predates any uploads, or the assets folder was empty.
});

console.log(`Restored ${BACKUP_TABLES.length} tables and asset files from ${backupDir} (backup schema ${backup.schemaVersion})`);
