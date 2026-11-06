import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BACKUP_TABLES, LATE_COLUMNS, NOT_BACKED_UP} from '../../../../scripts/backup-tables.ts';
import {replacer, restoreRows, reviver} from '../../../../scripts/backup-rows.ts';
import {buildApp} from '../../src/app.ts';
import {NOT_TRANSFERRED, TRANSFER_TABLES} from '../../src/system/transfer-routes.ts';
import {createTestDatabase} from '../helpers.ts';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('backup avatar')]);

test('backup and transfer lists cover the schema in a foreign-key-safe order', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());

  const tables = (await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`,
  )).rows.map(row => row.table_name as string);
  const withCampaign = new Set((await db.query(
    `SELECT DISTINCT table_name FROM information_schema.columns
     WHERE table_schema='public' AND column_name='campaign_id'`,
  )).rows.map(row => row.table_name as string));
  const references = (await db.query(
    `SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent, conname, condeferred,
            ARRAY(SELECT attname::text FROM pg_attribute WHERE attrelid=conrelid AND attnum = ANY(conkey)) AS columns
     FROM pg_constraint WHERE contype='f'`,
  )).rows as Array<{child: string; parent: string; conname: string; condeferred: boolean; columns: string[]}>;

  const backup: readonly string[] = BACKUP_TABLES;
  const transfer: readonly string[] = TRANSFER_TABLES;

  assert.deepEqual(tables.filter(table => !backup.includes(table) && !(NOT_BACKED_UP as readonly string[]).includes(table)), []);
  assert.deepEqual(backup.filter(table => !tables.includes(table)), []);

  const campaignTables = [...withCampaign].filter(table => table !== 'campaigns' && table !== 'campaign_members' && table !== 'member_permissions');
  assert.deepEqual(campaignTables.filter(table => !transfer.includes(table) && !(NOT_TRANSFERRED as readonly string[]).includes(table)).sort(), []);
  assert.deepEqual(transfer.filter(table => !tables.includes(table)), []);

  for (const [list, name] of [[backup, 'backup'], [transfer, 'transfer']] as const) {
    const wrong = references
      .filter(({child, parent, condeferred, columns}) =>
        child !== parent && list.includes(child) && list.includes(parent) && list.indexOf(parent) > list.indexOf(child) &&
        !condeferred && !columns.every(column => LATE_COLUMNS[child]?.includes(column)))
      .map(({child, parent, conname}) => `${name}: ${parent} before ${child} (${conname})`);
    assert.deepEqual(wrong, []);
  }
});

test('a backup restores onto an empty database, campaign cover and factions included', async t => {
  const source = await createTestDatabase(), target = await createTestDatabase();
  t.after(() => source.pg.close());
  t.after(() => target.pg.close());
  const app = await buildApp(source.db);
  t.after(() => app.close());

  const request = async (method: any, url: string, token?: string, payload?: any) => app.inject({
    method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {}),
  });
  const gm = (await request('POST', '/auth/register', undefined, {username: 'keeper', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Копия'})).json().id;
  const boundary = '----ttrpgBackupBoundary';
  const avatar = await app.inject({
    method: 'POST', url: `/campaigns/${campaignId}/assets?kind=campaign_avatar`,
    headers: {authorization: `Bearer ${gm.token}`, 'content-type': `multipart/form-data; boundary=${boundary}`},
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="avatar.png"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      PNG, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
  assert.equal(avatar.statusCode, 201, avatar.body);
  assert.equal((await request('PUT', `/campaigns/${campaignId}/appearance`, gm.token, {avatarAssetId: avatar.json().id})).statusCode, 200);
  const guild = await request('POST', `/campaigns/${campaignId}/factions`, gm.token, {name: 'Гильдия воров'});
  assert.equal(guild.statusCode, 201, guild.body);
  assert.equal((await request('PATCH', `/campaigns/${campaignId}/factions/${guild.json().id}`, gm.token, {
    rights: ['see-hp'], bonuses: [{kind: 'attack', value: 1}],
  })).statusCode, 200);
  const npc = (await request('POST', `/campaigns/${campaignId}/characters`, gm.token, {name: 'Карманник', kind: 'npc'})).json();
  assert.equal((await request('PUT', `/campaigns/${campaignId}/characters/${npc.id}/factions`, gm.token, {factionIds: [guild.json().id]})).statusCode, 200);
  const party = (await request('GET', `/campaigns/${campaignId}/factions`, gm.token)).json().factions.find((faction: any) => faction.system === 'party');
  assert.equal((await request('PUT', `/campaigns/${campaignId}/factions/relations`, gm.token, {
    a: guild.json().id, b: party.id, relation: 'enemy', restrictions: ['no-trade'],
  })).statusCode, 200);

  const dump: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) dump[table] = (await source.db.query(`SELECT * FROM ${table}`)).rows;
  const stored = JSON.parse(JSON.stringify(dump, replacer), reviver);
  await target.db.transaction(q => restoreRows(q, stored, BACKUP_TABLES, LATE_COLUMNS));

  for (const table of BACKUP_TABLES) {
    const count = Number((await target.db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
    assert.equal(count, dump[table]!.length, table);
  }
  const restored = (await target.db.query('SELECT avatar_asset_id FROM campaigns WHERE id=$1', [campaignId])).rows[0];
  assert.equal(restored.avatar_asset_id, avatar.json().id);
  const faction = (await target.db.query('SELECT rights, bonuses FROM factions WHERE id=$1', [guild.json().id])).rows[0];
  assert.deepEqual(faction, {rights: ['see-hp'], bonuses: [{kind: 'attack', value: 1}]});
  const relation = (await target.db.query('SELECT relation, restrictions FROM faction_relations WHERE campaign_id=$1 AND relation=$2 AND $3 = ANY(restrictions)', [campaignId, 'enemy', 'no-trade'])).rows;
  assert.equal(relation.length, 1);
});
