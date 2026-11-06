import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('scene grid look: the GM sets it for everyone, {} brings back the default', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 100_000});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({
    method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {}),
  }));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();
  const gm = await register('gm_grid'), alice = await register('alice_grid');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Grid'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const scenePath = `/campaigns/${campaignId}/scenes/${(await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Подземелье'})).json().id}`;
  const sceneOf = async (token: string) => (await request('GET', scenePath, token)).json().scene;

  assert.deepEqual((await sceneOf(alice.token)).grid, {}, 'a new scene — the default look');

  const look = {visible: true, style: 'dots', color: '#ffcc00', opacity: 0.5, width: 2};
  const saved = await request('PATCH', scenePath, gm.token, {grid: look});
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual((await sceneOf(alice.token)).grid, look, 'players see the GM’s look');
  const before = await sceneOf(gm.token);
  assert.deepEqual([before.width_cells, before.height_cells, before.feet_per_unit], [20, 20, 5], 'cells are untouched');

  assert.equal((await request('PATCH', scenePath, alice.token, {grid: {visible: false}})).statusCode, 403);
  for (const bad of [{style: 'hexes'}, {color: 'red'}, {opacity: 0}, {width: 9}, {extra: true}]) {
    assert.equal((await request('PATCH', scenePath, gm.token, {grid: bad})).statusCode, 400, JSON.stringify(bad));
  }

  await request('PATCH', scenePath, gm.token, {grid: {visible: false}});
  assert.deepEqual((await sceneOf(alice.token)).grid, {visible: false}, 'the look is replaced as a whole');
  await request('PATCH', scenePath, gm.token, {grid: {}});
  assert.deepEqual((await sceneOf(alice.token)).grid, {});
});
