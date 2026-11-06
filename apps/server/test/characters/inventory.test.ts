import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('objects inside objects', async t => {
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

  const gm = await register('gm_bag'), alice = await register('alice_bag'), bob = await register('bob_bag');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Bags'})).json().id;
  for (const member of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Двор', widthCells: 10, heightCells: 10})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const characters = `/campaigns/${campaignId}/characters`;
  const create = async (token: string, body: any) => (await request('POST', characters, token, body)).json();

  const liena = await create(alice.token, {kind: 'character', name: 'Лиэна'});
  const bran = await create(bob.token, {kind: 'character', name: 'Бран'});
  const sword = await create(alice.token, {kind: 'object', name: 'Меч'});
  const chest = await create(gm.token, {kind: 'object', name: 'Сундук'});
  const wagon = await create(gm.token, {kind: 'object', name: 'Повозка', size: 'large'});
  const gem = await create(gm.token, {kind: 'object', name: 'Самоцвет'});
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: sword.id, x: -3.5, z: -3.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: chest.id, x: 0.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: wagon.id, x: 2, z: 2});

  const put = (token: string, itemId: string, body: any) => request('PUT', `${characters}/${itemId}/container`, token, body);
  const contents = (token: string, id: string) => request('GET', `${characters}/${id}/contents`, token);
  const roster = async (token: string) => (await request('GET', characters, token)).json().characters as any[];
  const onScene = async () => (await request('GET', scenePath, gm.token)).json().objects as any[];

  await t.test('a player keeps her sword on her character; it leaves the map', async () => {
    assert.equal((await put(alice.token, sword.id, {containerId: chest.id})).statusCode, 403, 'not into the GM’s chest');
    const kept = await put(alice.token, sword.id, {containerId: liena.id});
    assert.equal(kept.statusCode, 200, kept.body);
    assert.ok(!(await onScene()).some(o => o.character_id === sword.id));
    assert.deepEqual((await contents(alice.token, liena.id)).json().contents.map((c: any) => c.name), ['Меч']);
    const placeAgain = await request('POST', `${scenePath}/objects`, alice.token, {characterId: sword.id});
    assert.equal(placeAgain.statusCode, 400);
    assert.match(placeAgain.json().message, /Лиэна/);
  });

  await t.test('giving the sword to another character makes it his', async () => {
    const given = await put(alice.token, sword.id, {containerId: bran.id});
    assert.equal(given.statusCode, 200, given.body);
    assert.equal(given.json().ownerUserId, bob.user.id);
    assert.equal((await put(alice.token, sword.id, {containerId: null})).statusCode, 403, 'not hers any more');
    assert.equal((await contents(alice.token, bran.id)).statusCode, 403, 'she cannot look into his pack');

    const dropped = await put(bob.token, sword.id, {containerId: null, sceneId});
    assert.equal(dropped.statusCode, 200, dropped.body);
    assert.ok((await onScene()).some(o => o.character_id === sword.id), 'he put it on the table');
  });

  await t.test('only items go inside, never into themselves', async () => {
    assert.equal((await put(gm.token, liena.id, {containerId: chest.id})).statusCode, 400, 'not a creature');
    assert.equal((await put(gm.token, gem.id, {containerId: chest.id})).statusCode, 200);
    assert.equal((await put(gm.token, chest.id, {containerId: wagon.id})).statusCode, 200);
    assert.equal((await put(gm.token, wagon.id, {containerId: gem.id})).statusCode, 400, 'a cycle');
    assert.equal((await put(gm.token, chest.id, {containerId: chest.id})).statusCode, 400, 'into itself');
    assert.ok(!(await onScene()).some(o => o.character_id === chest.id), 'the chest went into the wagon');
  });

  await t.test('what is inside a GM’s wagon stays secret from players', async () => {
    const names = (await roster(alice.token)).map(c => c.name);
    assert.ok(!names.includes('Самоцвет') && !names.includes('Сундук'), names.join(', '));
    assert.ok(names.includes('Повозка'));
    const gmView = (await roster(gm.token)).find(c => c.name === 'Самоцвет');
    assert.deepEqual([gmView.container_id, gmView.container_name], [chest.id, 'Сундук']);
    assert.equal((await contents(alice.token, wagon.id)).statusCode, 403);
  });

  await t.test('a shared wagon opens for everyone; loot taken out becomes the player’s', async () => {
    assert.equal((await request('PATCH', `${characters}/${wagon.id}/shared`, gm.token, {shared: true})).statusCode, 200);
    assert.deepEqual((await contents(alice.token, wagon.id)).json().contents.map((c: any) => c.name), ['Сундук']);
    assert.deepEqual((await contents(alice.token, chest.id)).json().contents.map((c: any) => c.name), ['Самоцвет'], 'the chest inside the shared wagon');
    assert.ok((await roster(alice.token)).some(c => c.name === 'Самоцвет' && c.can_control));

    const taken = await put(alice.token, gem.id, {containerId: null, sceneId});
    assert.equal(taken.statusCode, 200, taken.body);
    assert.equal(taken.json().ownerUserId, alice.user.id);
    const {x, z} = taken.json().placement;
    assert.ok(Math.max(Math.abs(x - 2), Math.abs(z - 2)) <= 1.5, `next to the wagon, got ${x},${z}`);
  });

  await t.test('deleting a container drops what was inside', async () => {
    assert.equal((await put(alice.token, gem.id, {containerId: liena.id})).statusCode, 200);
    assert.equal((await request('DELETE', `${characters}/${liena.id}`, alice.token)).statusCode, 204);
    const gemNow = (await roster(alice.token)).find(c => c.name === 'Самоцвет');
    assert.equal(gemNow.container_id, null);
  });
});
