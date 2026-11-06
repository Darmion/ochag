import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {buildApp} from '../../src/app.ts';
import type {Database} from '../../src/db.ts';
import {createTestDatabase} from '../helpers.ts';
import {BACKUP_TABLES, LATE_COLUMNS} from '../../../../scripts/backup-tables.ts';
import {replacer, restoreRows, reviver} from '../../../../scripts/backup-rows.ts';
import {UPGRADE_SCHEMA, upgradeBackupTables, withoutTransaction} from '../../../../scripts/backup-upgrade.ts';
import {MIGRATIONS} from '../../../../scripts/migrations.ts';

test('a backup of an older schema is upgraded by the missing migrations and restored', async t => {
  const migrations = await Promise.all(MIGRATIONS.map(async ([version, file]) => ({
    version, sql: await readFile(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'),
  })));
  const previous = migrations[migrations.length - 2]!.version;

  const old = new PGlite();
  t.after(() => old.close());
  await old.exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ttrpg_app') THEN CREATE ROLE ttrpg_app LOGIN; END IF;
  END $$;`);
  for (const migration of migrations.filter(entry => entry.version <= previous)) await old.exec(migration.sql);
  await old.query("SELECT set_config('ttrpg.app_password', $1, false)", ['test-runtime-password-123456789']);
  await old.exec(await readFile(new URL('../../../../db/provision_runtime.sql', import.meta.url), 'utf8'));
  const oldDb: Database = {
    query: async (sql, values) => old.query(sql, values),
    transaction: fn => old.transaction(q => fn({query: async (sql, values) => q.query(sql, values)})),
  };
  const oldApp = await buildApp(oldDb, {rateMax: 1_000_000});
  t.after(() => oldApp.close());
  const call = (app: typeof oldApp, method: any, url: string, token?: string, payload?: any) => app.inject({
    method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {}),
  });
  const keeper = (await call(oldApp, 'POST', '/auth/register', undefined, {username: 'keeper_old', password: 'x'})).json();
  const campaignId = (await call(oldApp, 'POST', '/campaigns', keeper.token, {name: 'Старая кампания'})).json().id as string;
  const hero = (await call(oldApp, 'POST', `/campaigns/${campaignId}/characters`, keeper.token, {kind: 'character', name: 'Летописец', hpMax: 12, hpCurrent: 12})).json();
  const sceneId = (await call(oldApp, 'POST', `/campaigns/${campaignId}/scenes`, keeper.token, {name: 'Старый зал', widthCells: 10, heightCells: 10})).json().id as string;
  assert.equal((await call(oldApp, 'POST', `/campaigns/${campaignId}/scenes/${sceneId}/objects`, keeper.token, {characterId: hero.id, x: 1.5, z: 1.5})).statusCode, 201);

  const oldTables = new Set((await old.query<any>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map(row => row.table_name as string));
  const dumped: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES.filter(table => oldTables.has(table))) dumped[table] = (await old.query(`SELECT * FROM ${table}`)).rows;
  const stored = JSON.parse(JSON.stringify(dumped, replacer), reviver);

  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000});
  t.after(() => app.close());
  assert.equal((await call(app, 'POST', '/auth/register', undefined, {username: 'newcomer', password: 'x'})).statusCode, 201);
  const restore = (list: typeof migrations, backup = stored, version = previous) => pg.transaction(async tx => {
    const client = {query: (sql: string, values?: unknown[]) => tx.query(sql, values), exec: (sql: string) => tx.exec(sql)};
    const tables = await upgradeBackupTables(client, backup, version, list, BACKUP_TABLES, LATE_COLUMNS);
    await restoreRows(client, tables, BACKUP_TABLES, LATE_COLUMNS);
  });
  const users = async () => (await pg.query<any>('SELECT username FROM accounts ORDER BY username')).rows.map(row => row.username as string);
  const upgradeSchemaLeft = async () => (await pg.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, [UPGRADE_SCHEMA])).rows.length > 0;

  await t.test('rows of the old backup land in the current schema; the temporary schema is gone', async () => {
    await restore(migrations);
    assert.deepEqual(await users(), ['keeper_old']);
    assert.equal(await upgradeSchemaLeft(), false);
    assert.equal((await pg.query<any>('SELECT current_schema() AS name')).rows[0].name, 'public');
    assert.equal(Number((await pg.query<any>('SELECT max(version) AS version FROM schema_migrations')).rows[0].version), migrations[migrations.length - 1]!.version);

    const login = await call(app, 'POST', '/auth/login', undefined, {username: 'keeper_old', password: 'x'});
    assert.equal(login.statusCode, 200, login.body);
    const token = login.json().token;
    const campaigns = (await call(app, 'GET', '/campaigns', token)).json().campaigns;
    assert.deepEqual(campaigns.map((entry: any) => entry.name), ['Старая кампания']);
    const scene = (await call(app, 'GET', `/campaigns/${campaignId}/scenes/${sceneId}`, token)).json();
    assert.ok(scene.objects.some((entry: any) => entry.character_id === hero.id && entry.name === 'Летописец'));
  });

  await t.test('a backup from before the factions migration gets the party and the enemies from the migration itself', async () => {
    const older = JSON.parse(JSON.stringify(stored, replacer), reviver);
    for (const table of ['factions', 'faction_members', 'faction_relations']) delete older[table];
    for (const row of older.characters) delete row.factions_explicit;
    for (const row of older.scene_triggers ?? []) delete row.fall_feet;
    await restore(migrations, older, 93);
    const factions = (await pg.query<any>('SELECT id, system FROM factions WHERE campaign_id=$1 ORDER BY sort', [campaignId])).rows;
    assert.deepEqual(factions.map(row => row.system), ['party', 'enemies']);
    const relation = (await pg.query<any>('SELECT relation FROM faction_relations WHERE campaign_id=$1', [campaignId])).rows;
    assert.deepEqual(relation.map(row => row.relation), ['enemy']);
    const chronicler = (await pg.query<any>('SELECT name, factions_explicit FROM characters WHERE id=$1', [hero.id])).rows[0];
    assert.deepEqual(chronicler, {name: 'Летописец', factions_explicit: false});
    assert.equal(await upgradeSchemaLeft(), false);
  });

  await t.test('a failing migration rolls everything back: data as it was, no temporary schema', async () => {
    const broken = migrations.map(entry => entry.version > previous ? {...entry, sql: 'ALTER TABLE no_such_table ADD COLUMN probe int;'} : entry);
    await assert.rejects(restore(broken));
    assert.deepEqual(await users(), ['keeper_old']);
    assert.equal(await upgradeSchemaLeft(), false);
  });

  await t.test('an unknown backup version is refused; transaction lines are cut, plpgsql blocks kept', async () => {
    await assert.rejects(pg.transaction(async tx => {
      await upgradeBackupTables({query: (sql, values) => tx.query(sql, values), exec: sql => tx.exec(sql)}, stored, 9999, migrations, BACKUP_TABLES, LATE_COLUMNS);
    }), /unknown/);
    assert.equal(withoutTransaction('BEGIN;\nCREATE TABLE x (id int);\nDO $$ BEGIN\n  PERFORM 1;\nEND $$;\nCOMMIT;\n'), '\nCREATE TABLE x (id int);\nDO $$ BEGIN\n  PERFORM 1;\nEND $$;\n\n');
  });
});
