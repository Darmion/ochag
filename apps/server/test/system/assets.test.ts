import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fakePng(label: string): Buffer {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from(`fake png body: ${label}`)]);
}

function multipartPayload(filename: string, contentType: string, content: Buffer) {
  const boundary = '----ttrpgTestBoundary123456';
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {boundary, body: Buffer.concat([head, content, tail])};
}

test('scene size and background image', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());

  const app = await buildApp(db);
  t.after(() => app.close());

  const request = async (method: any, url: string, token?: string, payload?: any) =>
    app.inject({
      method, url,
      ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}),
      ...(payload !== undefined ? {payload} : {}),
    });

  const uploadAsset = async (
    token: string,
    campaignId: string,
    kind: string,
    content: Buffer,
    contentType = 'image/png',
  ) => {
    const {boundary, body} = multipartPayload('map.png', contentType, content);
    return app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/assets?kind=${kind}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
  };

  const password = 'Local test password 123!';

  const register = async (username: string) => {
    const response = await request('POST', '/auth/register', undefined, {username, password, displayName: username});
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };

  const owner = await register('gm_assets'), player = await register('player_assets');

  const campaignId = (await request('POST', '/campaigns', owner.token, {name: 'Assets test'})).json().id;
  const inviteCode = (await request('POST', `/campaigns/${campaignId}/invites`, owner.token)).json().code;
  assert.equal((await request('POST', '/campaigns/join', player.token, {code: inviteCode})).statusCode, 201);

  await t.test('a scene can be created with a custom, non-square size', async () => {
    const response = await request('POST', `/campaigns/${campaignId}/scenes`, owner.token, {
      name: 'Custom map', widthCells: 15, heightCells: 8,
    });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().width_cells, 15);
    assert.equal(response.json().height_cells, 8);
    assert.equal(response.json().feet_per_unit, 5);
  });

  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, owner.token, {name: 'Default map'})).json().id;

  await t.test('a scene reports whether the viewer can manage it', async () => {
    const asOwner = (await request('GET', `/campaigns/${campaignId}/scenes/${sceneId}`, owner.token)).json().scene;
    assert.equal(asOwner.canManage, true);
    const asPlayer = (await request('GET', `/campaigns/${campaignId}/scenes/${sceneId}`, player.token)).json().scene;
    assert.equal(asPlayer.canManage, false);
  });

  await t.test('a non-manager cannot upload a scene background', async () => {
    const response = await uploadAsset(player.token, campaignId, 'scene_background', fakePng('a'));
    assert.equal(response.statusCode, 403, response.body);
  });

  await t.test('object_model uploads are rejected as not yet implemented', async () => {
    const response = await uploadAsset(owner.token, campaignId, 'object_model', fakePng('b'));
    assert.equal(response.statusCode, 400);
  });

  await t.test('a file whose bytes do not match an image signature is rejected', async () => {
    const response = await uploadAsset(owner.token, campaignId, 'scene_background', Buffer.from('not an image at all'));
    assert.equal(response.statusCode, 400);
  });

  let assetId = '';

  await t.test('a manager can upload a scene background and download it back byte-for-byte', async () => {
    const content = fakePng('roundtrip');
    const upload = await uploadAsset(owner.token, campaignId, 'scene_background', content);
    assert.equal(upload.statusCode, 201, upload.body);
    assetId = upload.json().id;

    const download = await request('GET', `/campaigns/${campaignId}/assets/${assetId}`, player.token);
    assert.equal(download.statusCode, 200);
    assert.equal(download.headers['content-type'], 'image/png');
    assert.deepEqual(download.rawPayload, content);
  });

  await t.test('a non-member cannot download the asset', async () => {
    const outsider = await register('outsider_assets');
    assert.equal((await request('GET', `/campaigns/${campaignId}/assets/${assetId}`, outsider.token)).statusCode, 404);
  });

  await t.test('setting a scene background requires an asset from the same campaign', async () => {
    const otherCampaignId = (await request('POST', '/campaigns', owner.token, {name: 'Other campaign'})).json().id;
    const otherSceneId = (await request('POST', `/campaigns/${otherCampaignId}/scenes`, owner.token, {name: 'Other scene'})).json().id;
    assert.equal(
      (await request('PATCH', `/campaigns/${otherCampaignId}/scenes/${otherSceneId}`, owner.token, {backgroundAssetId: assetId})).statusCode,
      400,
    );
  });

  await t.test('only a manager can change scene size or background', async () => {
    assert.equal(
      (await request('PATCH', `/campaigns/${campaignId}/scenes/${sceneId}`, player.token, {backgroundAssetId: assetId})).statusCode,
      403,
    );
  });

  await t.test('a manager can set, then clear, the scene background', async () => {
    const setResponse = await request('PATCH', `/campaigns/${campaignId}/scenes/${sceneId}`, owner.token, {backgroundAssetId: assetId});
    assert.equal(setResponse.statusCode, 200, setResponse.body);
    assert.equal(setResponse.json().background_asset_id, assetId);

    const scene = (await request('GET', `/campaigns/${campaignId}/scenes/${sceneId}`, owner.token)).json().scene;
    assert.equal(scene.background_asset_id, assetId);

    const cleared = await request('PATCH', `/campaigns/${campaignId}/scenes/${sceneId}`, owner.token, {backgroundAssetId: null});
    assert.equal(cleared.statusCode, 200);
    assert.equal(cleared.json().background_asset_id, null);
  });

  await t.test('a manager can resize an existing scene', async () => {
    const response = await request('PATCH', `/campaigns/${campaignId}/scenes/${sceneId}`, owner.token, {
      widthCells: 5, heightCells: 5, feetPerUnit: 10,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().width_cells, 5);
    assert.equal(response.json().feet_per_unit, 10);
  });

  await t.test('object movement bounds and cell-centre alignment follow the actual (odd) scene size', async () => {
    const character = (
      await pg.query<{id: string}>(
        `INSERT INTO characters(campaign_id, owner_user_id, name) VALUES ($1,$2,'Odd-scene bearer') RETURNING id`,
        [campaignId, player.user.id],
      )
    ).rows[0]!.id;

    const placed = await request('POST', `/campaigns/${campaignId}/scenes/${sceneId}/objects`, player.token, {characterId: character});
    assert.equal(placed.statusCode, 201, placed.body);

    const scene = (await request('GET', `/campaigns/${campaignId}/scenes/${sceneId}`, player.token)).json();
    const object = scene.objects.find((o: any) => o.id === placed.json().id);
    assert.equal(object.x, 0);
    assert.equal(object.z, 0);

    const basePath = `/campaigns/${campaignId}/scenes/${sceneId}/objects/${object.id}`;
    const move = (x: number, revision: number) => request('PUT', basePath, player.token, {
      x, y: 0, z: 0, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision,
    });

    assert.equal((await move(0.5, 1)).statusCode, 400);

    assert.equal((await move(2, 1)).statusCode, 200);
    assert.equal((await move(3, 2)).statusCode, 400);
  });

  await t.test('any member uploads an object image; only real images are accepted', async () => {
    const image = await uploadAsset(player.token, campaignId, 'object_image', fakePng('portrait'));
    assert.equal(image.statusCode, 201, image.body);
    const listed = (await request('GET', `/campaigns/${campaignId}/assets?kind=object_image`, player.token)).json().assets;
    assert.deepEqual(listed.map((a: any) => a.id), [image.json().id]);
    assert.equal(listed[0].content_type, 'image/png');

    const glbAsImage = await uploadAsset(player.token, campaignId, 'object_image', Buffer.from('glTF fake model'));
    assert.equal(glbAsImage.statusCode, 400);
    assert.match(glbAsImage.json().message, /PNG, JPEG и WebP/);

    const tooBig = await uploadAsset(player.token, campaignId, 'object_image', Buffer.concat([fakePng('big'), Buffer.alloc(5 * 1024 * 1024)]));
    assert.equal(tooBig.statusCode, 400);
    assert.match(tooBig.json().message, /5 МБ/);
  });

  await t.test('a player lists only own files and the model library, not what the GM keeps back', async () => {
    const handout = (await uploadAsset(owner.token, campaignId, 'object_image', fakePng('secret handout'))).json().id;
    const playerList = (await request('GET', `/campaigns/${campaignId}/assets`, player.token)).json().assets.map((a: any) => a.id);
    assert.ok(!playerList.includes(handout), 'the GM handout stays hidden');
    assert.ok(!playerList.includes(assetId), 'the GM map stays hidden');
    assert.equal((await request('GET', `/campaigns/${campaignId}/assets?kind=scene_background`, player.token)).json().assets.length, 0);
    const ownerList = (await request('GET', `/campaigns/${campaignId}/assets`, owner.token)).json().assets.map((a: any) => a.id);
    assert.ok(ownerList.includes(handout) && ownerList.includes(assetId) && ownerList.length > playerList.length);
  });

  await t.test('campaign owner can set avatar and banner while a player cannot', async () => {
    const denied = await uploadAsset(player.token, campaignId, 'campaign_avatar', fakePng('denied avatar'));
    assert.equal(denied.statusCode, 403, denied.body);

    const avatar = await uploadAsset(owner.token, campaignId, 'campaign_avatar', fakePng('campaign avatar'));
    const banner = await uploadAsset(owner.token, campaignId, 'campaign_banner', fakePng('campaign banner'));
    assert.equal(avatar.statusCode, 201, avatar.body);
    assert.equal(banner.statusCode, 201, banner.body);

    const changed = await request('PUT', `/campaigns/${campaignId}/appearance`, owner.token, {
      avatarAssetId: avatar.json().id,
      bannerAssetId: banner.json().id,
    });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal(changed.json().avatar_asset_id, avatar.json().id);
    assert.equal(changed.json().banner_asset_id, banner.json().id);

    const listed = (await request('GET', '/campaigns', player.token)).json().campaigns
      .find((campaign: any) => campaign.id === campaignId);
    assert.equal(listed.avatar_asset_id, avatar.json().id);
    assert.equal(listed.banner_asset_id, banner.json().id);

    assert.equal(
      (await request('PUT', `/campaigns/${campaignId}/appearance`, player.token, {avatarAssetId: null})).statusCode,
      403,
    );
  });

  await t.test('campaign overview returns useful aggregate data to members', async () => {
    const response = await request('GET', `/campaigns/${campaignId}/overview`, player.token);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().overview.members, 2);
    assert.ok(response.json().overview.scenes >= 2);
    assert.equal(typeof response.json().overview.worldMinutes, 'number');
  });
});
