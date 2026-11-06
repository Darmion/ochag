import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';
import {IMPORTERS} from '../../src/characters/import/importers.ts';
import {loadMods} from '../../src/system/mods.ts';

const bundled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../mods');

test('sheet import: the game has no importer of its own; the bundled «lss-import» mod adds one only when turned on', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 100_000});
  t.after(() => app.close());
  const request = async (method: any, url: string, token?: string, payload?: any) => {
    await pg.exec('SET ROLE ttrpg_app');
    try {
      return await app.inject({method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {})});
    } finally {
      await pg.exec('RESET ROLE');
    }
  };
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_importers', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Импорт'})).json().id;

  assert.deepEqual((await request('GET', '/importers', gm.token)).json(), {importers: []});
  const refused = await request('POST', `/campaigns/${campaignId}/imports`, gm.token, {importer: 'lss', original: {}});
  assert.equal(refused.statusCode, 400);
  assert.match(refused.json().message, /нет импорта «lss».*«Моды»/);

  const off = await loadMods(null, () => {}, {bundledDir: bundled});
  assert.deepEqual(off.list.map(mod => [mod.id, mod.status, mod.bundled]), [['lss-import', 'disabled', true]]);
  assert.equal(IMPORTERS.size, 0);

  const on = await loadMods(null, () => {}, {bundledDir: bundled, enabled: ['lss-import']});
  assert.deepEqual(on.list.map(mod => [mod.id, mod.status]), [['lss-import', 'loaded']]);
  assert.ok(on.list[0]!.changes.some(change => /импорт листов «Long Story Short»/.test(change)));
  assert.equal(on.list[0]!.translations.en?.name, 'Long Story Short sheet import');
  const [lss] = (await request('GET', '/importers', gm.token)).json().importers;
  assert.deepEqual({id: lss.id, name: lss.name, extensions: lss.extensions}, {id: 'lss', name: 'Long Story Short', extensions: ['.json']});
  assert.equal((await request('GET', '/importers')).statusCode, 401);
});
