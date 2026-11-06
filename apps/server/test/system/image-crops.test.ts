import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const fakePng = (label: string) => Buffer.concat([PNG, Buffer.from(`fake png body: ${label}`)]);

test('crop frames for the campaign avatar, banner and object portraits', async t => {
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
  const upload = async (token: string, campaignId: string, kind: string, label: string) => {
    const boundary = '----cropBoundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${label}.png"\r\nContent-Type: image/png\r\n\r\n`),
      fakePng(label), Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await asApp(() => app.inject({
      method: 'POST', url: `/campaigns/${campaignId}/assets?kind=${kind}`,
      headers: {authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}`}, payload: body,
    }));
    assert.equal(response.statusCode, 201, response.body);
    return response.json().id as string;
  };
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();
  const gm = await register('gm_crop');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Crops'})).json().id;
  const base = `/campaigns/${campaignId}`;

  const avatar = await upload(gm.token, campaignId, 'campaign_avatar', 'avatar');
  const banner = await upload(gm.token, campaignId, 'campaign_banner', 'banner');
  let put = await request('PUT', `${base}/appearance`, gm.token, {avatarAssetId: avatar, bannerAssetId: banner, avatarCrop: {x: 30, y: 20, zoom: 1.5}, bannerCrop: {x: 50, y: 70, zoom: 1}});
  assert.equal(put.statusCode, 200, put.body);
  assert.deepEqual(put.json().avatar_crop, {x: 30, y: 20, zoom: 1.5});
  const listed = (await request('GET', '/campaigns', gm.token)).json().campaigns.find((c: any) => c.id === campaignId);
  assert.deepEqual([listed.avatar_crop, listed.banner_crop], [{x: 30, y: 20, zoom: 1.5}, {x: 50, y: 70, zoom: 1}]);
  put = await request('PUT', `${base}/appearance`, gm.token, {bannerCrop: {x: 40, y: 10, zoom: 2}});
  assert.deepEqual([put.json().avatar_crop, put.json().banner_crop], [{x: 30, y: 20, zoom: 1.5}, {x: 40, y: 10, zoom: 2}]);
  const avatar2 = await upload(gm.token, campaignId, 'campaign_avatar', 'avatar2');
  put = await request('PUT', `${base}/appearance`, gm.token, {avatarAssetId: avatar2});
  assert.equal(put.json().avatar_crop, null, 'a new avatar starts centred');
  assert.deepEqual(put.json().banner_crop, {x: 40, y: 10, zoom: 2});
  assert.equal((await request('PUT', `${base}/appearance`, gm.token, {avatarCrop: {x: 120, y: 0, zoom: 1}})).statusCode, 400);
  assert.equal((await request('PUT', `${base}/appearance`, gm.token, {avatarCrop: {x: 10, y: 0, zoom: 0.5}})).statusCode, 400);

  const image = await upload(gm.token, campaignId, 'object_image', 'goblin');
  const goblin = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Гоблин', hpMax: 7, hpCurrent: 7})).json();
  let sheet = (await request('PATCH', `${base}/characters/${goblin.id}`, gm.token, {revision: goblin.revision, imageAssetId: image, imageCrop: {x: 50, y: 15, zoom: 2.5}})).json();
  assert.deepEqual(sheet.image_crop, {x: 50, y: 15, zoom: 2.5});
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Поляна'})).json().id;
  await request('POST', `${base}/scenes/${sceneId}/objects`, gm.token, {characterId: goblin.id});
  const placed = (await request('GET', `${base}/scenes/${sceneId}`, gm.token)).json().objects.find((o: any) => o.character_id === goblin.id);
  assert.deepEqual(placed.image_crop, {x: 50, y: 15, zoom: 2.5});
  const roster = (await request('GET', `${base}/characters`, gm.token)).json().characters.find((c: any) => c.id === goblin.id);
  assert.deepEqual(roster.image_crop, {x: 50, y: 15, zoom: 2.5});
  sheet = (await request('PATCH', `${base}/characters/${goblin.id}`, gm.token, {revision: sheet.revision, imageCrop: {x: 60, y: 25, zoom: 1}})).json();
  assert.equal(sheet.image_asset_id, image);
  assert.deepEqual(sheet.image_crop, {x: 60, y: 25, zoom: 1});
  const image2 = await upload(gm.token, campaignId, 'object_image', 'goblin2');
  sheet = (await request('PATCH', `${base}/characters/${goblin.id}`, gm.token, {revision: sheet.revision, imageAssetId: image2})).json();
  assert.equal(sheet.image_crop, null);
  assert.equal((await request('PATCH', `${base}/characters/${goblin.id}`, gm.token, {revision: sheet.revision, imageCrop: {x: 1, y: 2}})).statusCode, 400);
});
