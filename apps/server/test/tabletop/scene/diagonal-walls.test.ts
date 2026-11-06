import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('a wall cutting a cell diagonally keeps objects off it', async t => {
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

  const gm = await register('gm_diag');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Diag'})).json().id;
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Угол', widthCells: 6, heightCells: 6})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  await request('POST', `${scenePath}/walls`, gm.token, {x1: 0, z1: 0, x2: 1, z2: 1});
  await request('POST', `${scenePath}/walls`, gm.token, {x1: 0, z1: -1, x2: 0, z2: 0});

  const chest = (await request('POST', `${base}/characters`, gm.token, {kind: 'object', name: 'Сундук'})).json();
  const goblin = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile'})).json();

  await t.test('a plain object cannot be dropped on the cut cell, but can right next to it', async () => {
    const cut = await request('POST', `${scenePath}/objects`, gm.token, {characterId: chest.id, x: 0.5, z: 0.5});
    assert.equal(cut.statusCode, 400, cut.body);
    assert.match(cut.json().message, /срезает стена/);

    const clear = await request('POST', `${scenePath}/objects`, gm.token, {characterId: chest.id, x: 1.5, z: 0.5});
    assert.equal(clear.statusCode, 201, clear.body);
  });

  await t.test('a creature slides to the nearest free cell instead of landing on the cut one', async () => {
    const placed = await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 0.5, z: 0.5});
    assert.equal(placed.statusCode, 201, placed.body);
    const placement = (await request('GET', `${scenePath}`, gm.token)).json().objects.find((o: any) => o.character_id === goblin.id);
    assert.ok(placement.x !== 0.5 || placement.z !== 0.5, 'moved off the cut cell');
    assert.equal(placement.x === 0.5 && placement.z === 0.5, false);
  });

  await t.test('a plain edge wall does not block its own cell', async () => {
    await request('POST', `${scenePath}/walls`, gm.token, {x1: -1, z1: 0, x2: 0, z2: 0});
    const edge = (await request('POST', `${base}/characters`, gm.token, {kind: 'object', name: 'Факел'})).json();
    const placed = await request('POST', `${scenePath}/objects`, gm.token, {characterId: edge.id, x: -0.5, z: 0.5});
    assert.equal(placed.statusCode, 201, placed.body);
  });

  await t.test('dragging an existing object onto the cut cell is refused the same way', async () => {
    const tray = (await request('POST', `${base}/characters`, gm.token, {kind: 'object', name: 'Поднос'})).json();
    const placed = await request('POST', `${scenePath}/objects`, gm.token, {characterId: tray.id, x: 2.5, z: 2.5});
    const sceneObjectId = placed.json().id as string;
    const current = (await request('GET', `${scenePath}`, gm.token)).json().objects.find((o: any) => o.id === sceneObjectId);
    const move = await request('PUT', `${scenePath}/objects/${sceneObjectId}`, gm.token, {
      x: 0.5, y: 0, z: 0.5, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
    });
    assert.equal(move.statusCode, 400, move.body);
    assert.match(move.json().message, /срезает стена/);
  });
});
