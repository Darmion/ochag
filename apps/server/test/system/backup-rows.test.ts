import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase} from '../helpers.ts';
import {columnKinds, replacer, reviver, toParam} from '../../../../scripts/backup-rows.ts';

test('backup rows survive the JSON round trip and go back in by column kind', async t => {
  const {pg} = await createTestDatabase();
  t.after(() => pg.close());

  await t.test('column kinds come from the schema', async () => {
    const characters = await columnKinds(pg, 'characters');
    assert.equal(characters.get('auto_reactions'), 'array');
    assert.equal(characters.get('sheet_extra'), 'json');
    assert.equal(characters.get('name'), 'plain');
    assert.equal((await columnKinds(pg, 'campaign_rules')).get('value'), 'json');
  });

  await t.test('every kind of value goes back in unchanged', async () => {
    await pg.exec(`CREATE TABLE backup_probe (
      id int PRIMARY KEY, label text, at timestamptz, raw bytea,
      as_string jsonb, as_number jsonb, as_bool jsonb, as_list jsonb, as_object jsonb, tags text[]
    )`);
    const row = {
      id: 1, label: 'Щит', at: new Date('2026-10-14T19:12:44.289Z'), raw: Buffer.from([0, 1, 254, 255]),
      as_string: 'separate', as_number: 7, as_bool: false, as_list: [[1, 2], [3, 4]], as_object: {a: [1], b: 'x'}, tags: ['shield'],
    };
    await pg.query(
      `INSERT INTO backup_probe VALUES ($1, $2, $3, $4, $5::text::jsonb, $6::text::jsonb, $7::text::jsonb, $8::text::jsonb, $9::text::jsonb, $10)`,
      [row.id, row.label, row.at, row.raw, JSON.stringify(row.as_string), JSON.stringify(row.as_number), JSON.stringify(row.as_bool), JSON.stringify(row.as_list), JSON.stringify(row.as_object), row.tags],
    );

    const dumped = (await pg.query<Record<string, unknown>>('SELECT * FROM backup_probe')).rows
      .map(entry => ({...entry, raw: Buffer.from(entry.raw as Uint8Array)}));
    const stored = JSON.parse(JSON.stringify(dumped, replacer), reviver) as Array<Record<string, unknown>>;
    await pg.exec('TRUNCATE backup_probe');

    const kinds = await columnKinds(pg, 'backup_probe');
    const columns = Object.keys(stored[0]!);
    await pg.query(
      `INSERT INTO backup_probe (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
      columns.map(column => toParam(stored[0]![column], kinds.get(column) ?? 'plain')),
    );

    const back = (await pg.query<any>('SELECT * FROM backup_probe')).rows[0];
    assert.equal(back.label, 'Щит');
    assert.equal(new Date(back.at).toISOString(), row.at.toISOString());
    assert.deepEqual([...back.raw], [0, 1, 254, 255]);
    assert.deepEqual(
      [back.as_string, back.as_number, back.as_bool, back.as_list, back.as_object, back.tags],
      [row.as_string, row.as_number, row.as_bool, row.as_list, row.as_object, row.tags],
    );
  });

  await t.test('the old shape-only rule broke on a bare jsonb string', async () => {
    await assert.rejects(
      pg.query('INSERT INTO backup_probe (id, as_string) VALUES (2, $1)', [toParam('separate', 'plain')]),
      /json/i,
      'a jsonb column needs its kind — the value shape alone is not enough',
    );
  });
});
