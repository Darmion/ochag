import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {buildApp} from '../../../src/app.ts';
import {ASSETS_DIR} from '../../../src/system/asset-routes.ts';
import {createTestDatabase} from '../../helpers.ts';

test('scattering trees: copies at the given spots with their own turn and size; random pictures for many objects at once', async t => {
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

  const gm = await register('gm_scatter'), alice = await register('alice_scatter');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Scatter'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Лес', widthCells: 10, heightCells: 10})).json().id;
  const fir = (await request('POST', `${base}/characters`, gm.token, {kind: 'object', name: 'Ель'})).json();
  const wolf = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Волк', disposition: 'hostile', hpMax: 11, hpCurrent: 11})).json();
  for (const [id, x] of [[fir.id, 0.5], [wolf.id, 2.5]] as const) {
    assert.equal((await request('POST', `${base}/scenes/${sceneId}/objects`, gm.token, {characterId: id, x, z: 0.5})).statusCode, 201);
  }
  const duplicate = (body: any, token = gm.token) => request('POST', `${base}/characters/${fir.id}/duplicate`, token, body);

  await t.test('copies land exactly where asked, each with its own turn and size', async () => {
    const spots = [{x: -3.5, z: -3.5, rotationY: 90, scale: 1.2}, {x: 3.5, z: 2.5, rotationY: 200, scale: 0.8}, {x: -1.5, z: 4.5}];
    const made = await duplicate({count: 3, sceneId, spots});
    assert.equal(made.statusCode, 201, made.body);
    const placements = made.json().placements;
    assert.deepEqual(placements.map((entry: any) => [entry.x, entry.z]), spots.map(spot => [spot.x, spot.z]));
    const objects = (await request('GET', `${base}/scenes/${sceneId}`, gm.token)).json().objects;
    const placed = placements.map((entry: any) => objects.find((object: any) => object.id === entry.id));
    assert.deepEqual(placed.map((object: any) => [Number(object.rotation_y), Number(object.scale)]), [[90, 1.2], [200, 0.8], [0, 1]], 'the third keeps the original turn and size');
  });

  await t.test('spots are checked: on the board, one per copy, on a scene; without spots the old limit stays', async () => {
    assert.equal((await duplicate({count: 1, sceneId, spots: [{x: 9, z: 0}]})).statusCode, 400);
    assert.equal((await duplicate({count: 2, sceneId, spots: [{x: 0.5, z: 1.5}]})).statusCode, 400);
    assert.equal((await duplicate({count: 1, spots: [{x: 0.5, z: 1.5}]})).statusCode, 400);
    const many = await duplicate({count: 21, sceneId});
    assert.equal(many.statusCode, 400);
    assert.match(many.json().message, /не больше 20/);
    assert.equal((await duplicate({count: 1, sceneId, spots: [{x: 0.5, z: 1.5}]}, alice.token)).statusCode, 403);
  });

  await t.test('pictures for many objects: one request, objects only, the GM only, campaign pictures only', async () => {
    const boundary = '----scatterPictureBoundary';
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fir picture')]);
    const uploaded = await asApp(() => app.inject({
      method: 'POST', url: `${base}/assets?kind=object_image`,
      headers: {authorization: `Bearer ${gm.token}`, 'content-type': `multipart/form-data; boundary=${boundary}`},
      payload: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fir.png"\r\nContent-Type: image/png\r\n\r\n`),
        png, Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    }));
    assert.equal(uploaded.statusCode, 201, uploaded.body);
    const assetId = uploaded.json().id as string;
    t.after(() => unlink(join(ASSETS_DIR, `${assetId}.png`)).catch(() => {}));

    const copies = (await request('GET', `${base}/scenes/${sceneId}`, gm.token)).json().objects
      .filter((object: any) => object.name.startsWith('Ель')).map((object: any) => object.character_id);
    const items = [...copies, wolf.id].map(characterId => ({characterId, imageAssetId: assetId}));
    assert.equal((await request('POST', `${base}/characters/pictures`, alice.token, {items})).statusCode, 403);
    const done = await request('POST', `${base}/characters/pictures`, gm.token, {items});
    assert.equal(done.statusCode, 200, done.body);
    assert.equal(done.json().updated, copies.length, 'the wolf is not an object and keeps its look');
    const rows = (await pg.query<any>('SELECT id, image_asset_id FROM characters WHERE id = ANY($1::uuid[])', [[...copies, wolf.id]])).rows;
    assert.ok(rows.filter(row => copies.includes(row.id)).every(row => row.image_asset_id === assetId));
    assert.equal(rows.find(row => row.id === wolf.id).image_asset_id, null);
    const foreign = await request('POST', `${base}/characters/pictures`, gm.token, {items: [{characterId: fir.id, imageAssetId: campaignId}]});
    assert.equal(foreign.statusCode, 400);
  });
});
