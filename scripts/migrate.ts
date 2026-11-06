import {readFile} from 'node:fs/promises';
import {poolFromEnvironment} from '../apps/server/src/db.ts';
import {MIGRATIONS} from './migrations.ts';
const pool=poolFromEnvironment(false);
const client=await pool.connect();
try {
  await client.query('SELECT pg_advisory_lock(20260912)');
  const exists=await client.query("SELECT to_regclass('public.schema_migrations') AS name");
  const versions=exists.rows[0]?.name ? (await client.query('SELECT version FROM schema_migrations')).rows.map(r=>Number(r.version)) : [];
  const migrations=MIGRATIONS;
  // Derived from the list (scripts/migrations.ts) so a new migration can't be forgotten here.
  const known=new Set<number>(migrations.map(([version])=>version));
  if (versions.some(v => !known.has(v))) throw new Error('Database is newer than this application');
  // Create the role bare so the per-migration GRANTs work before db:provision sets its password and grants.
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ttrpg_app') THEN
      CREATE ROLE ttrpg_app LOGIN;
    END IF;
  END $$;`);
  for (const [version, file] of migrations) {
    if(versions.includes(version)) {console.log(`Migration ${version}: already applied`);continue;}
    const sql=await readFile(new URL(`../db/migrations/${file}`,import.meta.url),'utf8');
    await client.query(sql); console.log(`Migration ${version}: applied`);
  }
} finally {
  await client.query('ROLLBACK');
  await client.query('SELECT pg_advisory_unlock(20260912)');
  client.release(); await pool.end();
}
