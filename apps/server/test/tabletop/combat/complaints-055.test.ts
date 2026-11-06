import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('complaints of 22 October 2026', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000});
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
  const gm = await register('gm_c055'), alice = await register('alice_c055');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Жалобы 22.10'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  assert.equal((await request('POST', '/campaigns/join', alice.token, {code})).statusCode, 201);
  const base = `/campaigns/${campaignId}`;

  await t.test('п. 8: a player sees every wall along an explored cell — the bottom and right walls of the room too', async () => {
    await pg.query(
      `INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'party_vision','flag','Обзор отряда','false'::jsonb,$2)`,
      [campaignId, gm.user.id],
    );
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Комната', widthCells: 8, heightCells: 8})).json().id;
    const scenePath = `${base}/scenes/${sceneId}`;
    const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Разведчица'})).json();
    assert.equal((await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: 0.5, z: 0.5})).statusCode, 201);
    const wall = async (x1: number, z1: number, x2: number, z2: number) => {
      const made = await request('POST', `${scenePath}/walls`, gm.token, {x1, z1, x2, z2});
      assert.equal(made.statusCode, 201, made.body);
      return made.json().id as string;
    };
    const bottom = await wall(-4, 2, 4, 2);
    const right = await wall(3, -4, 3, 4);
    const behind = await wall(3, -1, 4, -1);
    const seen = (await request('GET', scenePath, alice.token)).json();
    const ids = new Set(seen.walls.map((entry: any) => entry.id));
    assert.ok(ids.has(bottom), 'the bottom wall of the room');
    assert.ok(ids.has(right), 'the right wall of the room');
    assert.ok(!ids.has(behind), 'a wall behind a wall stays in the fog');
  });

  await t.test('п. 1: a formation moves through itself — two own creatures swap cells; a creature the player cannot move still blocks', async () => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Строй', widthCells: 8, heightCells: 8})).json().id;
    const scenePath = `${base}/scenes/${sceneId}`;
    const first = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Первый'})).json();
    const second = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Второй'})).json();
    const orc = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Орк', disposition: 'hostile'})).json();
    const place = async (token: string, characterId: string, x: number, z: number) => (await request('POST', `${scenePath}/objects`, token, {characterId, x, z})).json().id as string;
    const a = await place(alice.token, first.id, 0.5, 0.5);
    const b = await place(alice.token, second.id, 1.5, 0.5);
    const o = await place(gm.token, orc.id, 2.5, 0.5);
    const objectOf = async (id: string) => (await request('GET', scenePath, alice.token)).json().objects.find((entry: any) => entry.id === id);
    const move = async (id: string, x: number, z: number, formation?: string[]) => {
      const object = await objectOf(id);
      return request('PUT', `${scenePath}/objects/${id}`, alice.token, {
        x, y: 0, z, rotationY: 0, scale: object.scale, snapToGrid: true, parentObjectId: null, animationName: null, revision: object.revision,
        ...(formation ? {formation} : {}),
      });
    };
    assert.match((await move(a, 1.5, 0.5)).json().message, /Клетка занята/, 'alone — the second one is in the way');
    assert.equal((await move(a, 1.5, 0.5, [a, b])).statusCode, 200, 'as a formation the cell is free');
    assert.equal((await move(b, 0.5, 0.5, [a, b])).statusCode, 200);
    assert.deepEqual([(await objectOf(a)).x, (await objectOf(b)).x], [1.5, 0.5], 'swapped');
    assert.match((await move(b, 2.5, 0.5, [b, o])).json().message, /Клетка занята/, 'the orc is not hers to move — it still blocks');
  });
});
