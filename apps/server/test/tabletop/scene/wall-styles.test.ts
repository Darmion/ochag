import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('walls: batches, styles, own picture, bulk removal', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 100_000});
  t.after(() => app.close());

  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({
    method, url,
    ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}),
    ...(payload !== undefined ? {payload} : {}),
  }));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_walls'), alice = await register('alice_walls');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Walls'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Замок', widthCells: 10, heightCells: 10})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const walls = async () => (await request('GET', scenePath, gm.token)).json().walls as any[];
  const room = [
    {x1: 0, z1: 0, x2: 3, z2: 0}, {x1: 3, z1: 0, x2: 3, z2: 2},
    {x1: 3, z1: 2, x2: 0, z2: 2}, {x1: 0, z1: 2, x2: 0, z2: 0},
  ];

  await t.test('a single wall is stone by default; a room goes in one request', async () => {
    const one = await request('POST', `${scenePath}/walls`, gm.token, {x1: -3, z1: -3, x2: -1, z2: -3});
    assert.equal(one.statusCode, 201, one.body);
    assert.deepEqual([one.json().style, one.json().texture_asset_id], ['stone', null]);

    assert.equal((await request('POST', `${scenePath}/walls/batch`, alice.token, {walls: room})).statusCode, 403);
    assert.equal((await request('POST', `${scenePath}/walls/batch`, gm.token, {walls: [{x1: 0, z1: 0, x2: 0.5, z2: 0}]})).statusCode, 400, 'off the lattice');
    const batch = await request('POST', `${scenePath}/walls/batch`, gm.token, {walls: room, style: 'brick'});
    assert.equal(batch.statusCode, 201, batch.body);
    assert.equal(batch.json().walls.length, 4);
    assert.deepEqual((await walls()).map(w => w.style), ['stone', 'brick', 'brick', 'brick', 'brick']);
  });

  await t.test('a picture on walls needs an image asset of the campaign', async () => {
    assert.equal((await request('PATCH', `${scenePath}/walls`, gm.token, {style: 'image'})).statusCode, 400, 'no picture');
    assert.equal((await request('PATCH', `${scenePath}/walls`, gm.token, {style: 'image', textureAssetId: '00000000-0000-4000-8000-000000000000'})).statusCode, 400);

    const assetId = '11111111-2222-4333-8444-555555555555';
    await pg.query(
      `INSERT INTO assets (id, campaign_id, kind, content_type, byte_size, storage_key, original_filename, uploaded_by)
       VALUES ($1,$2,'object_image','image/png',10,'wall.png','wall.png',$3)`,
      [assetId, campaignId, gm.user.id],
    );
    const brick = (await walls()).filter(w => w.style === 'brick').map(w => w.id);
    const changed = await request('PATCH', `${scenePath}/walls`, gm.token, {ids: brick.slice(0, 2), style: 'image', textureAssetId: assetId});
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal(changed.json().changed, 2);
    assert.deepEqual((await walls()).map(w => w.texture_asset_id), [null, assetId, assetId, null, null]);

    assert.equal((await request('PATCH', `${scenePath}/walls`, alice.token, {style: 'wood'})).statusCode, 403);
    const all = await request('PATCH', `${scenePath}/walls`, gm.token, {style: 'wood', textureAssetId: assetId});
    assert.equal(all.json().changed, 5);
    assert.deepEqual((await walls()).map(w => [w.style, w.texture_asset_id]), Array(5).fill(['wood', null]), 'a non-picture style drops the picture');
  });

  await t.test('several walls — or all of them — are removed at once', async () => {
    const [first, second] = (await walls()).map(w => w.id);
    assert.equal((await request('POST', `${scenePath}/walls/remove`, gm.token, {})).statusCode, 400);
    assert.equal((await request('POST', `${scenePath}/walls/remove`, alice.token, {all: true})).statusCode, 403);
    const removed = await request('POST', `${scenePath}/walls/remove`, gm.token, {ids: [first, second]});
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(removed.json().walls.length, 2);
    assert.equal((await walls()).length, 3);
    await request('POST', `${scenePath}/walls/remove`, gm.token, {all: true});
    assert.deepEqual(await walls(), []);
  });
});
