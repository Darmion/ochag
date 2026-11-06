import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('area templates and saves for everyone caught in them', async t => {
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

  const gm = await register('gm_area'), alice = await register('alice_area'), bob = await register('bob_area');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Area'})).json().id;
  for (const member of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Поле', widthCells: 10, heightCells: 10})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const characters = `/campaigns/${campaignId}/characters`;
  const place = async (name: string, kind: string, x: number, z: number) => {
    const body: any = {kind, name, ...(kind === 'npc' ? {disposition: 'hostile', dexterity: 14} : {})};
    const created = (await request('POST', characters, gm.token, body)).json();
    await request('POST', `${scenePath}/objects`, gm.token, {characterId: created.id, x, z});
    return created;
  };
  await place('Гоблин А', 'npc', 0.5, 0.5);
  await place('Гоблин Б', 'npc', 1.5, 0.5);
  await place('Гоблин далеко', 'npc', 4.5, 4.5);
  await place('Бочка', 'object', 0.5, -0.5);

  let fireballId = '';

  await t.test('anyone places a template; whoever sees the area sees it', async () => {
    assert.equal((await request('POST', `${scenePath}/templates`, alice.token, {shape: 'star', x: 0, z: 0, sizeFeet: 10})).statusCode, 400);
    const placed = await request('POST', `${scenePath}/templates`, alice.token, {shape: 'circle', x: 0, z: 0, sizeFeet: 10, label: 'Огненный шар'});
    assert.equal(placed.statusCode, 201, placed.body);
    fireballId = placed.json().id;
    assert.deepEqual((await request('GET', scenePath, bob.token)).json().templates, [], 'with no eyes on the scene the area stays in the fog');
    const bobHero = (await pg.query<{id: string}>(`INSERT INTO characters(campaign_id, owner_user_id, name) VALUES ($1,$2,'Боб') RETURNING id`, [campaignId, bob.user.id])).rows[0]!.id;
    assert.equal((await request('POST', `${scenePath}/objects`, gm.token, {characterId: bobHero, x: -4.5, z: -4.5})).statusCode, 201);
    const seen = (await request('GET', scenePath, bob.token)).json().templates;
    assert.deepEqual(seen.map((t: any) => [t.shape, t.size_feet, t.label, t.author_name]), [['circle', 10, 'Огненный шар', 'alice_area']]);
  });

  await t.test('the GM rolls saves for the creatures caught — not for objects or those outside', async () => {
    const path = `${scenePath}/templates/${fireballId}/saves`;
    assert.equal((await request('POST', path, alice.token, {ability: 'dexterity', dc: 15})).statusCode, 403);

    const easy = await request('POST', path, gm.token, {ability: 'dexterity', dc: 1});
    assert.equal(easy.statusCode, 200, easy.body);
    assert.deepEqual(easy.json().results.map((r: any) => [r.name, r.success]).sort(), [['Гоблин А', true], ['Гоблин Б', true]]);

    const hard = (await request('POST', path, gm.token, {ability: 'dexterity', dc: 40})).json().results;
    assert.ok(hard.every((r: any) => !r.success));
    const rolls = (await request('GET', `/campaigns/${campaignId}/rolls`, bob.token)).json().rolls;
    assert.ok(rolls.some((r: any) => r.label === 'Спасбросок ЛОВ (СЛ 40), Огненный шар — Гоблин А' && r.modifier === 2));
  });

  await t.test('the author or the GM edits a template: place, size, shape, colour, label', async () => {
    const path = `${scenePath}/templates/${fireballId}`;
    assert.equal((await request('PATCH', path, bob.token, {sizeFeet: 20})).statusCode, 403);
    assert.equal((await request('PATCH', path, alice.token, {})).statusCode, 400);
    const moved = await request('PATCH', path, alice.token, {x: 4.5, z: 4.5, sizeFeet: 5, color: '#00FF00'});
    assert.equal(moved.statusCode, 200, moved.body);
    assert.deepEqual([moved.json().x, moved.json().z, moved.json().size_feet, moved.json().color, moved.json().label], [4.5, 4.5, 5, '#00ff00', 'Огненный шар']);
    const saves = (await request('POST', `${path}/saves`, gm.token, {ability: 'dexterity', dc: 1})).json().results;
    assert.deepEqual(saves.map((r: any) => r.name), ['Гоблин далеко']);
    const line = (await request('PATCH', path, gm.token, {shape: 'line', direction: 90, label: null})).json();
    assert.deepEqual([line.shape, line.direction, line.width_feet, line.label], ['line', 90, 5, null]);
    const circle = (await request('PATCH', path, gm.token, {shape: 'circle'})).json();
    assert.deepEqual([circle.direction, circle.width_feet], [0, null]);
  });

  await t.test('only the author or the GM removes a template', async () => {
    assert.equal((await request('DELETE', `${scenePath}/templates/${fireballId}`, bob.token)).statusCode, 403);
    assert.equal((await request('DELETE', `${scenePath}/templates/${fireballId}`, alice.token)).statusCode, 204);
    assert.deepEqual((await request('GET', scenePath, bob.token)).json().templates, []);
  });
});
