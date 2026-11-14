import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.ts';
import { createTestDatabase } from '../helpers.ts';

test('mini-games reach the map and the sheets: a rune lock, a potion, a secret', async t => {
  const { pg, db } = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, { rateMax: 1_000_000 });
  t.after(() => app.close());

  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({
    method, url,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    ...(payload !== undefined ? { payload } : {}),
  }));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, { username, password: 'x' })).json();
  const gm = await register('gm_links'), alice = await register('alice_links');
  const campaignId = (await request('POST', '/campaigns', gm.token, { name: 'Links' })).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, { code });
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, { name: 'Склеп', widthCells: 10, heightCells: 10 })).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const create = async (token: string, body: any) => (await request('POST', `${base}/characters`, token, body)).json();
  const place = (token: string, characterId: string, x: number, z: number) => request('POST', `${scenePath}/objects`, token, { characterId, x, z });
  const hero = await create(alice.token, { kind: 'character', name: 'Лира' });
  await place(alice.token, hero.id, -3.5, -3.5);

  const runes = `${base}/minigames/rune-lock`;
  const rune = async (token: string, body: any) => {
    const revision = (await request('GET', runes, gm.token)).json().game?.revision ?? 0;
    return request('POST', runes, token, { revision, ...body });
  };
  const newLock = (holds: any) => rune(gm.token, { action: 'create', solution: [1, 2, 3], hint: '', limit: 4, ...holds });
  const solve = async () => {
    for (const ring of [0, 1, 2]) assert.equal((await rune(gm.token, { action: 'reveal', ring })).statusCode, 200);
    return rune(alice.token, { action: 'check' });
  };

  await t.test('a rune lock shuts a chest until the party solves it, and no lockpick opens it', async () => {
    const chest = await create(gm.token, { kind: 'object', name: 'Сундук' });
    await place(gm.token, chest.id, 1.5, 1.5);
    await request('PUT', `${base}/characters/${chest.id}/state`, gm.token, { openable: true, lockDc: 10 });
    assert.deepEqual((await request('GET', runes, gm.token)).json().lockables, [{ id: chest.id, name: 'Сундук', scene: 'Склеп' }]);

    const hung = await newLock({ targetId: chest.id });
    assert.equal(hung.statusCode, 200, hung.body);
    assert.deepEqual(hung.json().game.target, { kind: 'object', id: chest.id, name: 'Сундук' });
    assert.equal((await request('GET', runes, alice.token)).json().game.target, undefined, 'players do not learn what the lock holds');

    const interact = (action: string) => request('POST', `${base}/characters/${chest.id}/interact`, alice.token, { action, actorId: hero.id });
    const shut = (await interact('open')).json();
    assert.equal(shut.outcome, 'locked');
    assert.match(shut.message, /рунным замком/);
    const picked = (await interact('pick')).json();
    assert.equal(picked.outcome, 'impossible');
    assert.match(picked.message, /Рунный замок не взломать/);

    const opened = await solve();
    assert.equal(opened.statusCode, 200, opened.body);
    assert.equal(opened.json().game.phase, 'opened');
    assert.equal(opened.json().game.effect, '«Сундук» отперт.');
    assert.equal((await interact('open')).json().outcome, 'opened');
  });

  await t.test('a rune lock on a door holds every piece the door is later cut into', async () => {
    const door = (await request('POST', `${scenePath}/walls`, gm.token, { x1: 4, z1: 0, x2: 4, z2: 2, kind: 'door' })).json();
    const hung = await newLock({ door: { sceneId, x1: 4, z1: 0, x2: 4, z2: 2 } });
    assert.equal(hung.statusCode, 200, hung.body);
    assert.equal(hung.json().game.target.sceneName, 'Склеп');
    const cut = await request('PATCH', `${scenePath}/walls/${door.id}`, gm.token, { tile: 0, style: 'wood' });
    assert.equal(cut.statusCode, 200, cut.body);
    const pieces = async () => (await pg.query<{ locked: boolean }>(`SELECT locked FROM scene_walls WHERE scene_id=$1 AND kind='door'`, [sceneId])).rows.map(row => row.locked);
    assert.deepEqual(await pieces(), [true, true]);

    const piece = cut.json().walls[0];
    const push = await request('PATCH', `${scenePath}/walls/${piece.id}`, alice.token, { open: true });
    assert.equal(push.statusCode, 400);
    assert.match(push.json().message, /рунным замком/);

    const opened = await solve();
    assert.equal(opened.json().game.effect, 'Дверь на сцене «Склеп» отперта.');
    assert.deepEqual(await pieces(), [false, false]);
  });

  await t.test('a lock is hung on one thing, and only on a thing of this campaign', async () => {
    const both = await newLock({ targetId: hero.id, door: { sceneId, x1: 4, z1: 0, x2: 4, z2: 2 } });
    assert.equal(both.statusCode, 400);
    assert.equal((await newLock({ targetId: hero.id })).statusCode, 400, 'a creature is not a chest');
    assert.equal((await newLock({ door: { sceneId, x1: 7, z1: 0, x2: 7, z2: 1 } })).statusCode, 400, 'no door there');
  });

  await t.test('a flawless potion goes into the chosen hero\'s bag', async () => {
    const path = `${base}/minigames/alchemy`;
    assert.deepEqual((await request('GET', path, gm.token)).json().heroes, [{ id: hero.id, name: 'Лира' }]);
    let revision = (await request('POST', path, gm.token, { action: 'create', revision: 0, recipe: 0, limit: 8, heroId: hero.id })).json().game.revision;
    for (const ingredient of [2, 2, 0]) revision = (await request('POST', path, alice.token, { action: 'add', ingredient, revision })).json().game.revision;
    const bottled = await request('POST', path, alice.token, { action: 'bottle', revision });
    assert.equal(bottled.statusCode, 200, bottled.body);
    assert.equal(bottled.json().game.phase, 'perfect');
    assert.equal(bottled.json().game.effect, '«Лира» получает зелье «Согревающий эликсир».');
    const items = (await pg.query(`SELECT name, item_category, owner_user_id FROM characters WHERE container_id=$1`, [hero.id])).rows;
    assert.deepEqual(items, [{ name: 'Согревающий эликсир', item_category: 'consumable', owner_user_id: alice.user.id }]);
  });

  await t.test('the found route reveals the secret the GM tied the map to', async () => {
    const hatch = await create(gm.token, { kind: 'object', name: 'Люк' });
    await place(gm.token, hatch.id, 3.5, 3.5);
    await request('PUT', `${base}/characters/${hatch.id}/state`, gm.token, { secretDc: 30 });
    const seen = async () => (await request('GET', scenePath, alice.token)).json().objects.some((object: any) => object.character_id === hatch.id);
    assert.equal(await seen(), false);

    const path = `${base}/minigames/map-fragments`;
    assert.deepEqual((await request('GET', path, gm.token)).json().secrets, [{ id: hatch.id, name: 'Люк', scene: 'Склеп' }]);
    const made = await request('POST', path, gm.token, { action: 'create', revision: 0, story: 0, targetId: hatch.id });
    assert.equal(made.statusCode, 200, made.body);
    assert.equal((await request('GET', path, alice.token)).json().game.target, undefined, 'the secret stays the GM\'s');
    const solved = await request('POST', path, gm.token, { action: 'solve', revision: made.json().game.revision });
    assert.equal(solved.json().game.effect, 'Найдено тайное: «Люк». Теперь его видят все.');
    assert.equal(await seen(), true);
  });
});
