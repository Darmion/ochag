import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {ASSET_COLUMNS} from '../../src/system/asset-usage.ts';
import {eventForRequest} from '../../src/system/campaign-events.ts';
import {createTestDatabase} from '../helpers.ts';

const png = (label: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label)]);
const mp3 = Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.alloc(40, 1)]);
const glb = Buffer.from('glTF fake model body');

function multipart(content: Buffer) {
  const boundary = '----ochagAssetDelete';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="file.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  return {boundary, body: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)])};
}

test('every column that holds a file id is known to the usage check', async t => {
  const {pg} = await createTestDatabase();
  t.after(() => pg.close());
  const {rows} = await pg.query<{table_name: string; column_name: string}>(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema='public' AND column_name LIKE '%asset_id' ORDER BY table_name, column_name`,
  );
  const found = rows.map(row => `${row.table_name}.${row.column_name}`);
  assert.deepEqual(found.filter(column => !ASSET_COLUMNS.includes(column)), [], 'a file column the usage check does not read');
  assert.deepEqual(ASSET_COLUMNS.filter(column => !found.includes(column)), [], 'a column that no longer exists');
});

test('deleting campaign files', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db);
  t.after(() => app.close());

  const request = (method: any, url: string, token: string, payload?: unknown) =>
    app.inject({method, url, headers: {authorization: `Bearer ${token}`}, ...(payload !== undefined ? {payload: payload as any} : {})});
  const upload = async (token: string, kind: string, content: Buffer) => {
    const {boundary, body} = multipart(content);
    const response = await app.inject({
      method: 'POST', url: `/campaigns/${campaignId}/assets?kind=${kind}`,
      headers: {authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}`}, payload: body,
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().id as string;
  };
  const register = async (username: string) => {
    const response = await app.inject({method: 'POST', url: '/auth/register', payload: {username, password: 'Local test password 123!', displayName: username}});
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };

  const owner = await register('gm_delete'), player = await register('player_delete');
  const campaignId = (await request('POST', '/campaigns', owner.token, {name: 'Files'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, owner.token)).json().code;
  assert.equal((await request('POST', '/campaigns/join', player.token, {code})).statusCode, 201);
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, owner.token, {name: 'Лес'})).json().id;
  const usage = async () => (await request('GET', `/campaigns/${campaignId}/assets/usage`, owner.token)).json().assets as any[];

  const background = await upload(owner.token, 'scene_background', png('forest'));
  assert.equal((await request('PATCH', `/campaigns/${campaignId}/scenes/${sceneId}`, owner.token, {backgroundAssetId: background})).statusCode, 200);

  await t.test('a file in use stays and says where it is used', async () => {
    const row = (await usage()).find(asset => asset.id === background);
    assert.deepEqual(row.uses, [{place: 'sceneBackground', name: 'Лес'}]);
    assert.equal(row.uploaded_by_name, 'gm_delete');
    const response = await request('DELETE', `/campaigns/${campaignId}/assets/${background}`, owner.token);
    assert.equal(response.statusCode, 409, response.body);
    assert.equal((await request('GET', `/campaigns/${campaignId}/assets/${background}`, owner.token)).statusCode, 200);
  });

  await t.test('once replaced, the old background can go', async () => {
    assert.equal((await request('PATCH', `/campaigns/${campaignId}/scenes/${sceneId}`, owner.token, {backgroundAssetId: null})).statusCode, 200);
    assert.equal((await request('DELETE', `/campaigns/${campaignId}/assets/${background}`, owner.token)).statusCode, 204);
    assert.equal((await request('GET', `/campaigns/${campaignId}/assets/${background}`, owner.token)).statusCode, 404);
  });

  await t.test('a track in a scene playlist counts as used, though only JSON points at it', async () => {
    const track = await upload(owner.token, 'audio', mp3);
    assert.equal((await request('PUT', `/campaigns/${campaignId}/scenes/${sceneId}/playlist`, owner.token, {tracks: [track]})).statusCode, 200);
    assert.deepEqual((await usage()).find(asset => asset.id === track).uses, [{place: 'sceneMusic', name: 'Лес'}]);
    assert.equal((await request('DELETE', `/campaigns/${campaignId}/assets/${track}`, owner.token)).statusCode, 409);
  });

  await t.test('cleanup removes unused pictures only, and keeps library models', async () => {
    const stray = await upload(owner.token, 'object_image', png('stray'));
    const model = await upload(owner.token, 'object_model', glb);
    const banner = await upload(owner.token, 'campaign_banner', png('banner'));
    const response = await request('POST', `/campaigns/${campaignId}/assets/cleanup`, owner.token);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().deleted, 2);
    const left = (await usage()).map(asset => asset.id);
    assert.ok(!left.includes(stray) && !left.includes(banner));
    assert.ok(left.includes(model), 'an unused model stays in the library');
    assert.equal((await request('DELETE', `/campaigns/${campaignId}/assets/${model}`, owner.token)).statusCode, 204);
  });

  await t.test('a file in use can go everywhere: each place is left empty', async () => {
    const picture = await upload(owner.token, 'scene_background', png('swamp'));
    const swamp = (await request('POST', `/campaigns/${campaignId}/scenes`, owner.token, {name: 'Болото'})).json().id;
    assert.equal((await request('PATCH', `/campaigns/${campaignId}/scenes/${swamp}`, owner.token, {backgroundAssetId: picture})).statusCode, 200);
    const wall = await request('POST', `/campaigns/${campaignId}/scenes/${swamp}/walls`, owner.token, {x1: 0, z1: -1, x2: 0, z2: 1, style: 'image', textureAssetId: picture});
    assert.equal(wall.statusCode, 201, wall.body);
    assert.equal((await request('POST', `/campaigns/${campaignId}/handouts`, owner.token, {title: 'Карта болота', assetId: picture})).statusCode, 201);
    const figure = await upload(owner.token, 'object_image', png('guard'));
    const guard = (await request('POST', `/campaigns/${campaignId}/characters`, owner.token, {kind: 'npc', name: 'Страж', imageAssetId: figure})).json().id;
    const track = await upload(owner.token, 'audio', mp3);
    assert.equal((await request('PUT', `/campaigns/${campaignId}/scenes/${swamp}/playlist`, owner.token, {tracks: [track]})).statusCode, 200);

    const places = (await usage()).find(asset => asset.id === picture).uses.map((use: {place: string}) => use.place).sort();
    assert.deepEqual(places, ['handout', 'sceneBackground', 'sceneWalls']);
    assert.equal((await request('DELETE', `/campaigns/${campaignId}/assets/${picture}?everywhere=1`, player.token)).statusCode, 403);

    for (const id of [picture, figure, track]) {
      const response = await request('DELETE', `/campaigns/${campaignId}/assets/${id}?everywhere=1`, owner.token);
      assert.equal(response.statusCode, 204, response.body);
    }
    const scene = (await pg.query<any>('SELECT background_asset_id, playlist FROM scenes WHERE id=$1', [swamp])).rows[0];
    assert.equal(scene.background_asset_id, null);
    assert.deepEqual(scene.playlist, []);
    assert.deepEqual((await pg.query<any>('SELECT style, texture_asset_id FROM scene_walls WHERE scene_id=$1', [swamp])).rows, [{style: 'stone', texture_asset_id: null}]);
    assert.deepEqual((await pg.query<any>(`SELECT asset_id, body FROM handouts WHERE title='Карта болота'`)).rows, [{asset_id: null, body: ''}]);
    assert.equal((await pg.query<any>('SELECT image_asset_id FROM characters WHERE id=$1', [guard])).rows[0].image_asset_id, null);
  });

  await t.test('a playing track deleted everywhere stops the player', async () => {
    const song = await upload(owner.token, 'audio', mp3);
    const play = await request('PUT', `/campaigns/${campaignId}/audio`, owner.token, {action: 'play', assetId: song, sceneId: null});
    assert.equal(play.statusCode, 200, play.body);
    assert.deepEqual((await usage()).find(asset => asset.id === song).uses, [{place: 'player', name: null}]);
    const gone = await request('DELETE', `/campaigns/${campaignId}/assets/${song}?everywhere=1`, owner.token);
    assert.equal(gone.statusCode, 204, gone.body);
    const state = (await request('GET', `/campaigns/${campaignId}/audio`, owner.token)).json().state;
    assert.equal(state.asset_id, null);
    assert.equal(state.playing, false);
  });

  await t.test('a deleted scene comes back without the files deleted since', async () => {
    const picture = await upload(owner.token, 'scene_background', png('ruins'));
    const ruins = (await request('POST', `/campaigns/${campaignId}/scenes`, owner.token, {name: 'Руины'})).json().id;
    assert.equal((await request('PATCH', `/campaigns/${campaignId}/scenes/${ruins}`, owner.token, {backgroundAssetId: picture})).statusCode, 200);
    const removed = await request('DELETE', `/campaigns/${campaignId}/scenes/${ruins}`, owner.token);
    assert.equal(removed.statusCode, 200, removed.body);

    assert.deepEqual((await usage()).find(asset => asset.id === picture).uses, [{place: 'deletedScene', name: 'Руины'}]);
    assert.equal((await request('DELETE', `/campaigns/${campaignId}/assets/${picture}?everywhere=1`, owner.token)).statusCode, 204);

    const restored = await request('POST', `/campaigns/${campaignId}/scene-backups/${removed.json().backupId}/restore`, owner.token);
    assert.equal(restored.statusCode, 201, restored.body);
    assert.equal((await pg.query<any>('SELECT background_asset_id FROM scenes WHERE id=$1', [restored.json().id])).rows[0].background_asset_id, null);
  });

  await t.test('deleting a file everywhere reloads every table', () => {
    const id = '0f8e3c1a-1111-4222-8333-444455556666';
    assert.deepEqual(eventForRequest('DELETE', `/campaigns/${campaignId}/assets/${id}?everywhere=1`), {campaignId, event: {type: 'changed'}});
    assert.equal(eventForRequest('DELETE', `/campaigns/${campaignId}/assets/${id}`), null);
  });

  await t.test('players delete only their own unused files and do not see the list', async () => {
    assert.equal((await request('GET', `/campaigns/${campaignId}/assets/usage`, player.token)).statusCode, 403);
    assert.equal((await request('POST', `/campaigns/${campaignId}/assets/cleanup`, player.token)).statusCode, 403);
    const gmPicture = await upload(owner.token, 'object_image', png('gm'));
    assert.equal((await request('DELETE', `/campaigns/${campaignId}/assets/${gmPicture}`, player.token)).statusCode, 403);
    const own = await upload(player.token, 'object_image', png('mine'));
    assert.equal((await request('DELETE', `/campaigns/${campaignId}/assets/${own}`, player.token)).statusCode, 204);
  });
});
