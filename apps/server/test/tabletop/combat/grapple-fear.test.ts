import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('fear keeps you away from its source; a grappler drags at double cost', async t => {
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
  const gm = await register('gm_fear'), alice = await register('alice_fear');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Fear'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Поле', widthCells: 12, heightCells: 12})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Лира', speedFeet: 30})).json();
  const ghost = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Призрак', disposition: 'hostile', hpMax: 20, hpCurrent: 20})).json();
  const goblin = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 7, hpCurrent: 7})).json();
  for (const [id, x, token] of [[hero.id, -2.5, alice.token], [ghost.id, 2.5, gm.token], [goblin.id, -4.5, gm.token]] as const) {
    assert.equal((await request('POST', `${scenePath}/objects`, token, {characterId: id, x, z: 0.5})).statusCode, 201);
  }
  const place = async (characterId: string) => (await request('GET', scenePath, gm.token)).json().objects.find((object: any) => object.character_id === characterId);
  const move = async (characterId: string, x: number, z: number, token = alice.token) => {
    const current = await place(characterId);
    return request('PUT', `${scenePath}/objects/${current.id}`, token, {
      x, y: current.y, z, rotationY: current.rotation_y, scale: current.scale, snapToGrid: current.snap_to_grid,
      parentObjectId: null, animationName: current.animation_name, revision: current.revision,
    });
  };
  const apply = (target: string, code: string, source: string) =>
    request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [target], code, sourceCharacterId: source});

  await t.test('frightened: not one step closer while the source is in sight', async () => {
    assert.equal((await apply(hero.id, 'frightened', ghost.id)).statusCode, 200);
    const closer = await move(hero.id, -1.5, 0.5);
    assert.equal(closer.statusCode, 400);
    assert.match(closer.json().message, /в страхе перед «Призрак»/);
    assert.equal((await move(hero.id, -3.5, 0.5)).statusCode, 200, 'backing off is fine');
    assert.equal((await move(hero.id, -3.5, 1.5)).statusCode, 200, 'sideways at the same distance is fine');

    await request('POST', `${scenePath}/walls`, gm.token, {x1: 0, z1: -6, x2: 0, z2: 6});
    assert.equal((await move(hero.id, -2.5, 1.5)).statusCode, 200, 'out of sight — closer is allowed');
    await pg.query('DELETE FROM scene_walls WHERE scene_id=$1', [sceneId]);
    assert.equal((await apply(hero.id, 'blinded', ghost.id)).statusCode, 200);
    assert.equal((await move(hero.id, -1.5, 1.5)).statusCode, 200, 'blinded — cannot see the source');
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [hero.id]);
  });

  await t.test('grappler drags the grappled along; in combat every foot costs two', async () => {
    await pg.query('UPDATE scene_objects SET x=-2.5, z=0.5 WHERE character_id=$1', [hero.id]);
    await pg.query('UPDATE scene_objects SET x=-3.5, z=0.5 WHERE character_id=$1', [goblin.id]);
    assert.equal((await apply(goblin.id, 'grappled', hero.id)).statusCode, 200);

    assert.equal((await move(hero.id, -1.5, 0.5)).statusCode, 200);
    assert.deepEqual([(await place(goblin.id)).x, (await place(goblin.id)).z], [-2.5, 0.5], 'the goblin follows one cell');

    const initiative = `${scenePath}/initiative`;
    const entry = (await request('POST', `${initiative}/join`, alice.token, {characterId: hero.id})).json().id;
    await request('POST', `${initiative}/advance`, gm.token, {});
    assert.equal((await move(hero.id, 0.5, 0.5)).statusCode, 200);
    const row = (await request('GET', initiative, gm.token)).json().entries.find((e: any) => e.id === entry);
    assert.equal(row.moved_feet, 20, 'two cells dragging — 20 feet');
    assert.equal((await place(goblin.id)).x, -0.5);
    const tooFar = await move(hero.id, 0.5, 2.5);
    assert.equal(tooFar.statusCode, 400, 'two more cells would cost 20, only 10 left');
    assert.match(tooFar.json().message, /путь стоит 20 фут\., осталось 10 из 30/);

    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [goblin.id]);
    assert.equal((await move(hero.id, 0.5, 1.5)).statusCode, 200);
    assert.equal((await request('GET', initiative, gm.token)).json().entries.find((e: any) => e.id === entry).moved_feet, 25);
    assert.equal((await place(goblin.id)).x, -0.5, 'no longer held — stays put');
  });
});
