import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('scene list carries size and map picture; the GM renames a scene', async t => {
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
  const gm = await register('gm_cards'), alice = await register('alice_cards');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Cards'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Пещера', widthCells: 12, heightCells: 8})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  await request('PATCH', scenePath, gm.token, {feetPerUnit: 10, backgroundRotation: 90});

  const card = (await request('GET', `${base}/scenes`, alice.token)).json().scenes.find((scene: any) => scene.id === sceneId);
  assert.equal(card.name, 'Пещера');
  assert.equal(card.width_cells, 12);
  assert.equal(card.height_cells, 8);
  assert.equal(card.feet_per_unit, 10);
  assert.equal(card.background_asset_id, null);
  assert.equal(card.background_rotation, 90);

  const renamed = await request('PATCH', scenePath, gm.token, {name: '  Пещера гоблинов '});
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.json().name, 'Пещера гоблинов');
  assert.equal((await request('PATCH', scenePath, gm.token, {name: '   '})).statusCode, 400);
  assert.equal((await request('PATCH', scenePath, gm.token, {name: ''})).statusCode, 400);
  assert.equal((await request('PATCH', scenePath, alice.token, {name: 'Моя пещера'})).statusCode, 403);
  const list = (await request('GET', `${base}/scenes`, alice.token)).json().scenes;
  assert.deepEqual(list.map((scene: any) => scene.name), ['Пещера гоблинов']);
  assert.equal(list[0].width_cells, 12);
});
