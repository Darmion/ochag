import {replacer, restoreRows, reviver} from './backup-rows.ts';

export const UPGRADE_SCHEMA = 'restore_upgrade';

export type Migration = {version: number; sql: string};
type Tables = Record<string, Array<Record<string, unknown>>>;
type Client = {
  query: (sql: string, values?: unknown[]) => Promise<{rows: any[]}>;
  exec?: (sql: string) => Promise<unknown>;
};

export function withoutTransaction(sql: string) {
  return sql.replace(/^[ \t]*(BEGIN|COMMIT);[ \t]*$/gim, '');
}

export async function upgradeBackupTables(
  client: Client,
  stored: Tables,
  fromVersion: number,
  migrations: readonly Migration[],
  tables: readonly string[],
  late: Readonly<Record<string, readonly string[]>>,
): Promise<Tables> {
  const run = (sql: string) => (client.exec ? client.exec(sql) : client.query(sql));
  const known = new Set(migrations.map(migration => migration.version));
  if (!known.has(fromVersion)) throw new Error(`Backup schema version ${fromVersion} is unknown to this application.`);

  const previousPath = String((await client.query('SHOW search_path')).rows[0]?.search_path ?? 'public');
  await client.query(`DROP SCHEMA IF EXISTS ${UPGRADE_SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${UPGRADE_SCHEMA}`);
  await client.query("SELECT set_config('search_path', $1, true)", [UPGRADE_SCHEMA]);

  for (const migration of migrations.filter(entry => entry.version <= fromVersion)) await run(withoutTransaction(migration.sql));

  const existing = new Set(
    (await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`)).rows.map(row => row.table_name as string),
  );
  await restoreRows(client, stored, tables.filter(table => existing.has(table)), late);
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');

  for (const migration of migrations.filter(entry => entry.version > fromVersion)) await run(withoutTransaction(migration.sql));

  const upgraded: Tables = {};
  for (const table of tables) upgraded[table] = (await client.query(`SELECT * FROM ${table}`)).rows;

  await client.query("SELECT set_config('search_path', $1, true)", [previousPath]);
  await client.query(`DROP SCHEMA ${UPGRADE_SCHEMA} CASCADE`);
  await client.query('SET CONSTRAINTS ALL DEFERRED');
  return JSON.parse(JSON.stringify(upgraded, replacer), reviver) as Tables;
}
