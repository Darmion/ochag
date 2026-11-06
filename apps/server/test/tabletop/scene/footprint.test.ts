import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('big creatures take several cells', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db);
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

  const gm = await register('gm_size'), player = await register('player_size');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Size'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', player.token, {code});
  const characters = `/campaigns/${campaignId}/characters`;
  const ogre = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Огр', disposition: 'hostile', size: 'large', hpMax: 59})).json();

  await t.test('a large creature stands on a grid corner, wholly on the board', async () => {
    const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Поляна', widthCells: 10, heightCells: 10})).json().id;
    const objects = `/campaigns/${campaignId}/scenes/${sceneId}/objects`;

    const centre = await request('POST', objects, gm.token, {characterId: ogre.id, x: 0.5, z: 0.5});
    assert.equal(centre.statusCode, 400);
    assert.match(centre.json().message, /2×2/);

    const placed = await request('POST', objects, gm.token, {characterId: ogre.id});
    assert.equal(placed.statusCode, 201, placed.body);
    const scene = (await request('GET', `/campaigns/${campaignId}/scenes/${sceneId}`, gm.token)).json();
    const object = scene.objects.find((o: any) => o.name === 'Огр');
    assert.deepEqual([object.x, object.z, object.size], [0, 0, 'large'], 'the default spot is the middle corner');

    const put = (x: number, z: number, revision: number) => request('PUT', `${objects}/${object.id}`, gm.token, {
      x, y: 0, z, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision,
    });
    assert.equal((await put(4, -4, object.revision)).statusCode, 200, 'the far corner still fits');
    assert.equal((await put(2.5, 2, object.revision + 1)).statusCode, 400);
  });

  await t.test('the fog shows a big creature when any of its cells is in sight', async () => {
    const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Пещера'})).json().id;
    const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
    await request('PATCH', scenePath, gm.token, {defaultVisionRadiusFeet: 16});
    const hero = (await request('POST', characters, player.token, {kind: 'character', name: 'Герой'})).json();
    const far = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Дальний огр', disposition: 'hostile', size: 'large'})).json();
    await request('POST', `${scenePath}/objects`, player.token, {characterId: hero.id, x: -5.5, z: 0.5});
    await request('POST', `${scenePath}/objects`, gm.token, {characterId: ogre.id, x: -2, z: 0});
    await request('POST', `${scenePath}/objects`, gm.token, {characterId: far.id, x: 6, z: 6});

    const seen = (await request('GET', scenePath, player.token)).json();
    assert.ok(seen.fog, 'the fog is on');
    assert.deepEqual(seen.objects.map((o: any) => o.name).sort(), ['Герой', 'Огр'], 'the near ogre shows with one corner in sight; the far one does not');
  });

  await t.test('copies of a large creature do not overlap', async () => {
    const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Мост', widthCells: 10, heightCells: 10})).json().id;
    const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
    await request('POST', `${scenePath}/objects`, gm.token, {characterId: ogre.id, x: 0, z: 0});

    const copies = await request('POST', `${characters}/${ogre.id}/duplicate`, gm.token, {count: 3, sceneId});
    assert.equal(copies.statusCode, 201, copies.body);

    const placed = (await request('GET', scenePath, gm.token)).json().objects;
    assert.equal(placed.length, 4);
    const cells = new Set<string>();
    for (const object of placed) {
      assert.ok(Number.isInteger(object.world_x) && Number.isInteger(object.world_z), `${object.name} stands on a corner`);
      for (const dx of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) {
        const key = `${object.world_x + dx}:${object.world_z + dz}`;
        assert.ok(!cells.has(key), `${object.name} overlaps another ogre at ${key}`);
        cells.add(key);
      }
    }
  });
});
