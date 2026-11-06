import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('doors, windows, a single wall tile, breaking walls', async t => {
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
  const gm = await register('gm_doors'), alice = await register('alice_doors');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Doors'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Замок', widthCells: 10, heightCells: 10})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const wall = (await request('POST', `${scenePath}/walls`, gm.token, {x1: 0, z1: -5, x2: 0, z2: 5})).json();
  assert.equal(wall.kind, 'wall');
  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Лира', speedFeet: 30, strength: 10})).json();
  const clubResponse = await request('POST', `${base}/characters/${hero.id}/weapons`, alice.token, {name: 'Дубина', ability: 'strength', proficient: false, attackBonus: 20, damageFormula: '1d1+9', damageType: 'bludgeoning'});
  assert.equal(clubResponse.statusCode, 201, clubResponse.body);
  const club = clubResponse.json();
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: -0.5, z: 0.5});
  const place = async () => (await request('GET', scenePath, gm.token)).json().objects.find((object: any) => object.character_id === hero.id);
  const move = async (x: number, z: number) => {
    const current = await place();
    return request('PUT', `${scenePath}/objects/${current.id}`, alice.token, {
      x, y: 0, z, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
    });
  };
  const walls = async (token = gm.token) => (await request('GET', scenePath, token)).json().walls;
  const edit = (id: string, body: any, token = gm.token) => request('PATCH', `${scenePath}/walls/${id}`, token, body);

  let door: any;
  await t.test('one tile of a wall becomes a door; the rest keeps its look', async () => {
    assert.ok((await move(0.5, 0.5)).statusCode >= 400, 'the wall holds');
    const made = await edit(wall.id, {tile: 5, kind: 'door'});
    assert.equal(made.statusCode, 200, made.body);
    assert.deepEqual(made.json().removed, [wall.id]);
    const pieces = made.json().walls;
    assert.deepEqual(pieces.map((piece: any) => [piece.kind, piece.z1, piece.z2]), [['wall', -5, 0], ['door', 0, 1], ['wall', 1, 5]]);
    door = pieces[1];
    assert.equal(door.open, false);
    assert.ok((await move(0.5, 0.5)).statusCode >= 400, 'a closed door holds');
  });

  await t.test('the player opens the door from next to it, and walks through', async () => {
    assert.equal((await edit(door.id, {style: 'brick'}, alice.token)).statusCode, 403, 'only the GM restyles');
    const opened = await edit(door.id, {open: true}, alice.token);
    assert.equal(opened.statusCode, 200, opened.body);
    assert.equal(opened.json().walls[0].open, true);
    assert.equal((await move(0.5, 0.5)).statusCode, 200, 'through the open door');
    assert.equal((await move(-0.5, 0.5)).statusCode, 200);
    assert.equal((await edit(door.id, {open: false}, alice.token)).statusCode, 200);
    assert.equal((await move(-3.5, 0.5)).statusCode, 200);
    const far = await edit(door.id, {open: true}, alice.token);
    assert.equal(far.statusCode, 400);
    assert.match(far.json().message, /рядом с ней/);
    assert.equal((await move(-0.5, 0.5)).statusCode, 200);
  });

  await t.test('a locked door is closed and the player cannot open it', async () => {
    assert.equal((await edit(door.id, {open: true})).statusCode, 200);
    const locked = await edit(door.id, {locked: true});
    assert.deepEqual([locked.json().walls[0].locked, locked.json().walls[0].open], [true, false], 'locking closes it');
    const tried = await edit(door.id, {open: true}, alice.token);
    assert.equal(tried.statusCode, 400);
    assert.match(tried.json().message, /заперта/);
    const seen = (await walls(alice.token)).find((entry: any) => entry.id === door.id);
    assert.deepEqual([seen.locked, seen.hp, seen.condition], [undefined, undefined, 'целая']);
  });

  await t.test('a window holds the way but is struck down; then the way is free', async () => {
    const lower = (await walls()).find((entry: any) => entry.kind === 'wall' && entry.z2 === 0);
    const glass = (await edit(lower.id, {tile: 4, kind: 'window'})).json().walls.find((entry: any) => entry.kind === 'window');
    assert.deepEqual([glass.z1, glass.z2], [-1, 0]);
    assert.equal((await move(-0.5, -0.5)).statusCode, 200);
    assert.ok((await move(0.5, -0.5)).statusCode >= 400, 'glass holds the way');
    let result: any = null;
    for (let i = 0; i < 10 && !result?.broken; i++) {
      const struck = await request('POST', `${scenePath}/walls/${glass.id}/strike`, alice.token, {characterId: hero.id, weaponId: club.id});
      assert.equal(struck.statusCode, 200, struck.body);
      result = struck.json();
      assert.equal(result.ac, 13);
      assert.equal(result.hp, undefined, 'the player sees no numbers');
    }
    assert.equal(result.broken, true, 'ten damage against four hit points');
    assert.equal(result.condition, 'разбито');
    const again = await request('POST', `${scenePath}/walls/${glass.id}/strike`, alice.token, {characterId: hero.id, weaponId: club.id});
    assert.equal(again.statusCode, 400);
    assert.equal((await move(0.5, -0.5)).statusCode, 200, 'through the broken window');
    const fixed = await edit(glass.id, {broken: false});
    assert.deepEqual([fixed.json().walls[0].broken, fixed.json().walls[0].hp], [false, null]);
    const rolls = (await pg.query<any>(`SELECT label FROM roll_log WHERE character_id=$1 ORDER BY created_at`, [hero.id])).rows.map(row => row.label);
    assert.ok(rolls.some((label: string) => /^Удар по окну: Дубина/.test(label)), rolls.join('; '));
  });

  await t.test('far from the wall the weapon does not reach; a stranger cannot strike for the hero', async () => {
    assert.equal((await move(3.5, -0.5)).statusCode, 200);
    const upper = (await walls()).find((entry: any) => entry.kind === 'wall' && entry.z1 === 1);
    const far = await request('POST', `${scenePath}/walls/${upper.id}/strike`, alice.token, {characterId: hero.id, weaponId: club.id});
    assert.equal(far.statusCode, 400);
    assert.match(far.json().message, /достаёт на 5/);
    const bob = await register('bob_doors');
    const invite = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', bob.token, {code: invite});
    assert.equal((await request('POST', `${scenePath}/walls/${upper.id}/strike`, bob.token, {characterId: hero.id, weaponId: club.id})).statusCode, 403);
  });

  await t.test('the GM removes a single tile of a wall', async () => {
    const upper = (await walls()).find((entry: any) => entry.kind === 'wall' && entry.z1 === 1);
    const removed = await edit(upper.id, {tile: 0, remove: true});
    assert.equal(removed.statusCode, 200, removed.body);
    assert.ok(removed.json().removed.includes(upper.id));
    assert.deepEqual(removed.json().walls.map((piece: any) => [piece.z1, piece.z2]), [[2, 5]], 'the tile z 1..2 is gone');
    assert.equal((await edit(door.id, {remove: true}, alice.token)).statusCode, 403);
  });

  await t.test('a wall behind another wall is out of reach', async () => {
    const hero_ = await place();
    await pg.query('UPDATE scene_objects SET x=-1.5, z=2.5 WHERE id=$1', [hero_.id]);
    const upper = (await walls()).find((entry: any) => entry.kind === 'wall' && entry.z1 === 2);
    const inner = (await request('POST', `${scenePath}/walls`, gm.token, {x1: -1, z1: 2, x2: -1, z2: 3})).json();
    const blocked = await request('POST', `${scenePath}/walls/${upper.id}/strike`, alice.token, {characterId: hero.id, weaponId: club.id, tile: 0});
    assert.equal(blocked.statusCode, 400, blocked.body);
    assert.match(blocked.json().message, /через стены не бьют/);
    assert.equal((await request('POST', `${scenePath}/walls/${inner.id}/strike`, alice.token, {characterId: hero.id, weaponId: club.id})).statusCode, 200);
    await request('DELETE', `${scenePath}/walls/${inner.id}`, gm.token);
    const struck = await request('POST', `${scenePath}/walls/${upper.id}/strike`, alice.token, {characterId: hero.id, weaponId: club.id, tile: 0});
    assert.equal(struck.statusCode, 200, struck.body);
  });
});
