import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('tabletop scenes and object placement', async t => {
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

  const password = 'Local test password 123!';

  const register = async (username: string) => {
    const response = await request('POST', '/auth/register', undefined, {username, password, displayName: username});
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };

  const join = async (userToken: string) => {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, owner.token)).json().code;
    assert.equal((await request('POST', '/campaigns/join', userToken, {code})).statusCode, 201);
  };

  const owner = await register('gm_tabletop'), player = await register('player_tabletop'), bystander = await register('bystander_tabletop');

  const campaignId = (await request('POST', '/campaigns', owner.token, {name: 'Tabletop test'})).json().id;
  await join(player.token);
  await join(bystander.token);

  const characterId = (await pg.query<{id: string}>(
    `INSERT INTO characters(campaign_id, owner_user_id, name) VALUES ($1,$2,'Token bearer') RETURNING id`,
    [campaignId, player.user.id],
  )).rows[0]!.id;

  const countRows = async (table: string) => Number((await pg.query<{n: string}>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n);

  const scenesPath = () => `/campaigns/${campaignId}/scenes`;

  await t.test('a fresh campaign has no scenes', async () => {
    assert.deepEqual((await request('GET', scenesPath(), owner.token)).json(), {scenes: [], canManage: true});
  });

  await t.test('only a scene manager can create a scene', async () => {
    assert.equal((await request('POST', scenesPath(), player.token, {name: 'Forest clearing'})).statusCode, 403);
    assert.equal((await request('POST', scenesPath(), bystander.token, {name: 'Forest clearing'})).statusCode, 403);
  });

  let sceneId = '';

  await t.test('the campaign owner can create a scene', async () => {
    const response = await request('POST', scenesPath(), owner.token, {name: 'Forest clearing'});
    assert.equal(response.statusCode, 201, response.body);
    sceneId = response.json().id;
    assert.equal(response.json().revision, 1);
    assert.deepEqual((await request('GET', scenesPath(), player.token)).json().scenes.map((s: any) => s.id), [sceneId]);
    assert.equal((await request('GET', scenesPath(), player.token)).json().canManage, false);
  });

  await t.test('an unknown or cross-campaign scene id is not found', async () => {
    assert.equal((await request('GET', `${scenesPath()}/00000000-0000-4000-8000-000000000000`, owner.token)).statusCode, 404);

    const otherCampaignId = (await request('POST', '/campaigns', owner.token, {name: 'Other campaign'})).json().id;
    assert.equal((await request('GET', `/campaigns/${otherCampaignId}/scenes/${sceneId}`, owner.token)).statusCode, 404);
  });

  const basePath = () => `${scenesPath()}/${sceneId}`;
  const objectsPath = () => `${basePath()}/objects`;

  await t.test('putting an object on the scene requires controlling it', async () => {
    const response = await request('POST', objectsPath(), bystander.token, {characterId});
    assert.equal(response.statusCode, 403);
    assert.match(response.json().message, /Редактирование/);
  });

  let objectId = '';

  await t.test('the owner puts their character on the board centre', async () => {
    const response = await request('POST', objectsPath(), player.token, {characterId});
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().alreadyPlaced, false);
    objectId = response.json().id;

    const object = (await request('GET', basePath(), player.token)).json().objects.find((o: any) => o.id === objectId);
    assert.equal(object.x, 0.5);
    assert.equal(object.z, 0.5);
    assert.equal(object.revision, 1);
    assert.equal(object.kind, 'character');
    assert.equal(object.name, 'Token bearer');
    assert.equal(object.character_id, characterId);
    assert.equal(object.snap_to_grid, true);
    assert.equal(object.hidden, false);
  });

  await t.test('putting the same object on the scene again does not create a second placement', async () => {
    const before = await countRows('scene_objects');
    const response = await request('POST', objectsPath(), player.token, {characterId});
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), {id: objectId, alreadyPlaced: true});
    assert.equal(await countRows('scene_objects'), before);
  });

  // Fog is on by default, so the bystander gets a creature of its own (inserted directly to keep scene.revision unchanged).
  const scoutId = (await pg.query<{id: string}>(
    `INSERT INTO characters(campaign_id, owner_user_id, name) VALUES ($1,$2,'Bystander scout') RETURNING id`,
    [campaignId, bystander.user.id],
  )).rows[0]!.id;
  await pg.query(
    `INSERT INTO scene_objects(campaign_id, scene_id, character_id, x, y, z, created_by) VALUES ($1,$2,$3,1.5,0,0.5,$4)`,
    [campaignId, sceneId, scoutId, bystander.user.id],
  );

  await t.test('rights on a placed object depend on the viewer', async () => {
    const find = (objects: any[]) => objects.find((o: any) => o.id === objectId);
    const asOwner = find((await request('GET', basePath(), owner.token)).json().objects);
    assert.deepEqual([asOwner.canEdit, asOwner.canMove], [true, true]);
    const asPlayer = find((await request('GET', basePath(), player.token)).json().objects);
    assert.deepEqual([asPlayer.canEdit, asPlayer.canMove, asPlayer.canShare], [true, true, true]);
    const asBystander = find((await request('GET', basePath(), bystander.token)).json().objects);
    assert.deepEqual([asBystander.canEdit, asBystander.canMove, asBystander.canShare], [false, false, false]);
  });

  const movePath = () => `${objectsPath()}/${objectId}`;
  const move = (token: string, x: number, z: number, revision: number, extra: Record<string, unknown> = {}) =>
    request('PUT', movePath(), token, {
      x, y: 0, z, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision, ...extra,
    });

  await t.test('a snapped object must stay on a cell centre', async () => {
    assert.equal((await move(player.token, 1, 0.5, 1)).statusCode, 400);
  });

  await t.test('coordinates outside the board are rejected', async () => {
    assert.equal((await move(player.token, 20.5, 0.5, 1)).statusCode, 400);
  });

  await t.test('only someone who controls the object may move it', async () => {
    assert.equal((await move(bystander.token, 1.5, 0.5, 1)).statusCode, 403);
  });

  await t.test('a stale revision is rejected', async () => {
    assert.equal((await move(player.token, 1.5, 0.5, 99)).statusCode, 409);
  });

  await t.test('the owner moves their object and the revision advances', async () => {
    assert.equal((await move(player.token, 1.5, 0.5, 1)).statusCode, 400);
    const response = await move(player.token, 2.5, 0.5, 1);
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual({x: response.json().x, z: response.json().z, revision: response.json().revision}, {x: 2.5, z: 0.5, revision: 2});
    assert.equal((await request('GET', basePath(), owner.token)).json().scene.revision, 3);
  });

  await t.test('a manager can move someone else\'s object', async () => {
    const response = await move(owner.token, -1.5, -0.5, 2);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().revision, 3);
  });

  const wsAddress = (await app.listen({host: '127.0.0.1', port: 0})).replace('http', 'ws');

  await t.test('websocket clients are notified when an object moves', async () => {
    const socket = new WebSocket(`${wsAddress}/live`);
    t.after(() => socket.close());

    const nextMessage = () => new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for a websocket message')), 3000);
      socket.once('message', raw => {
        clearTimeout(timer);
        resolve(JSON.parse(raw.toString()));
      });
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    socket.send(JSON.stringify({token: player.token, campaignId, sceneId}));
    assert.equal((await nextMessage()).type, 'ready');

    const moved = move(player.token, 0.5, 0.5, 3);
    assert.equal((await nextMessage()).type, 'changed');
    assert.equal((await moved).statusCode, 200);
  });

  await t.test('removing an object from the scene keeps the object itself', async () => {
    assert.equal((await request('DELETE', movePath(), bystander.token)).statusCode, 403);
    assert.equal((await request('DELETE', movePath(), player.token)).statusCode, 204);
    assert.equal((await request('GET', basePath(), player.token)).json().objects.some((o: any) => o.id === objectId), false);
    assert.equal((await pg.query('SELECT 1 FROM characters WHERE id=$1', [characterId])).rows.length, 1);
  });

  await t.test('a websocket subscription with an invalid session is refused', async () => {
    const socket = new WebSocket(`${wsAddress}/live`);
    t.after(() => socket.close());

    const closed = new Promise<number>(resolve => socket.once('close', code => resolve(code)));
    await new Promise<void>(resolve => socket.once('open', resolve));
    socket.send(JSON.stringify({token: 'A'.repeat(43), campaignId, sceneId}));
    assert.equal(await closed, 1008);
  });
});
