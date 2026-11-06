import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildApp} from '../../src/app.ts';
import {loadMods} from '../../src/system/mods.ts';
import {createTestDatabase} from '../helpers.ts';

const examples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../examples/mods');

test('examples/mods: «Второе дыхание с Телосложением» loads and works', async t => {
  const mods = await loadMods(examples);
  assert.deepEqual(mods.list.map(mod => [mod.id, mod.status]), [['stronger-second-wind', 'loaded']], 'the visual example is not loaded by the server');
  assert.equal(mods.list[0]!.translations.en?.name, 'Second Wind with Constitution');
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000, mods});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => { await pg.exec('SET ROLE ttrpg_app'); try { return await fn(); } finally { await pg.exec('RESET ROLE'); } };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {})}));
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_examples', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Примеры'})).json().id;
  const base = `/campaigns/${campaignId}`;
  const hero = (await request('POST', `${base}/characters`, gm.token, {kind: 'character', name: 'Бранд', hpMax: 60, hpCurrent: 10, level: 3, constitution: 16})).json();
  const current = (await request('GET', `${base}/characters/${hero.id}`, gm.token)).json();
  assert.equal((await request('PATCH', `${base}/characters/${hero.id}`, gm.token, {revision: current.revision, className: 'Воин', level: 3})).statusCode, 200);

  const wind = await request('POST', `${base}/characters/${hero.id}/features/second-wind`, gm.token, {});
  assert.equal(wind.statusCode, 200, wind.body);
  assert.match(wind.json().message, /И ещё \+3 от Телосложения\.$/);
  const hp = (await request('GET', `${base}/characters/${hero.id}`, gm.token)).json();
  assert.equal(hp.hpCurrent ?? hp.hp_current, 10 + wind.json().healed + 3);

  const list = (await request('GET', `${base}/characters/${hero.id}/features`, gm.token)).json().features;
  const cry = list.find((feature: any) => feature.id === 'battle-cry');
  assert.deepEqual([cry?.name, cry?.detail, cry?.available], ['Боевой клич', 'бонусным действием', true]);
  const used = await request('POST', `${base}/characters/${hero.id}/features/battle-cry`, gm.token, {});
  assert.equal(used.statusCode, 200, used.body);
  assert.equal(used.json().message, 'Бранд: «За мной!»');
});
