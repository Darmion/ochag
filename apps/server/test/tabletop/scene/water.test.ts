import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('water: shallow is difficult, deep is swimming, armor in deep water is a hint to the GM', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 100_000});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({
    method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {}),
  }));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_water'), alice = await register('alice_water');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Water'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Брод', widthCells: 12, heightCells: 1})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const characters = `/campaigns/${campaignId}/characters`;
  const x = (col: number) => col - 6 + 0.5;

  const hero = (await request('POST', characters, alice.token, {kind: 'character', name: 'Рыцарь', speedFeet: 60})).json();
  const goblin = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile'})).json();
  const heroPlacement = (await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: x(0), z: 0})).json().id;
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: x(11), z: 0});
  const moveTo = async (col: number) => {
    const current = (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.id === heroPlacement);
    return request('PUT', `${scenePath}/objects/${heroPlacement}`, alice.token, {
      x: x(col), y: 0, z: 0, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
    });
  };
  const initiative = `${scenePath}/initiative`;
  const moved = async () => (await request('GET', initiative, gm.token)).json().entries.find((e: any) => e.character_id === hero.id).moved_feet;

  await t.test('the GM marks water; it replaces mud in the same cell and stays on the map', async () => {
    assert.equal((await request('PUT', `${scenePath}/terrain`, alice.token, {cells: [], water: [[2, 0, 2]]})).statusCode, 403);
    assert.equal((await request('PUT', `${scenePath}/terrain`, gm.token, {cells: [], water: [[2, 0, 3]]})).statusCode, 400);
    assert.equal((await request('PUT', `${scenePath}/terrain`, gm.token, {cells: [], water: [[12, 0, 1]]})).statusCode, 400);
    const saved = await request('PUT', `${scenePath}/terrain`, gm.token, {cells: [[2, 0], [9, 0]], water: [[2, 0, 2], [3, 0, 2], [5, 0, 1]]});
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json(), {cells: [[9, 0]], water: [[2, 0, 2], [3, 0, 2], [5, 0, 1]], heights: []});
    const scene = (await request('GET', scenePath, alice.token)).json().scene;
    assert.deepEqual([scene.difficult_cells, scene.water_cells], [[[9, 0]], [[2, 0, 2], [3, 0, 2], [5, 0, 1]]]);
    assert.equal((await request('PUT', `${scenePath}/terrain`, gm.token, {cells: [[9, 0]]})).json().water.length, 3, 'without `water` the water stays');
  });

  const wsAddress = (await app.listen({host: '127.0.0.1', port: 0})).replace('http', 'ws');
  const listen = async (token: string) => {
    const socket = new WebSocket(`${wsAddress}/live`);
    t.after(() => socket.terminate());
    const messages: any[] = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await new Promise(resolve => socket.once('open', resolve));
    socket.send(JSON.stringify({token, campaignId, sceneId}));
    while (!messages.some(m => m.type === 'ready')) await new Promise(resolve => setTimeout(resolve, 20));
    return messages;
  };
  const gmHears = await listen(gm.token);
  const aliceHears = await listen(alice.token);

  await t.test('in combat: a swum cell costs 10 feet, a shallow one too; armor tells only the GM', async () => {
    const armor = (await request('POST', characters, gm.token, {kind: 'object', name: 'Кольчуга'})).json();
    await pg.query(`UPDATE characters SET container_id=$2, item_category='armor', item_srd='gear:chain-mail', equipped_slot='body' WHERE id=$1`, [armor.id, hero.id]);
    const heroEntry = (await request('POST', `${initiative}/join`, alice.token, {characterId: hero.id})).json().id;
    const goblinEntry = (await request('POST', `${initiative}/join`, gm.token, {characterId: goblin.id})).json().id;
    await request('PATCH', `${initiative}/${heroEntry}`, gm.token, {score: 20});
    await request('PATCH', `${initiative}/${goblinEntry}`, gm.token, {score: 10});
    await request('POST', `${initiative}/advance`, gm.token);

    assert.equal((await moveTo(2)).statusCode, 200);
    assert.equal(await moved(), 15, 'one dry cell, then one swum: 5 + 10');
    for (let i = 0; i < 100 && !gmHears.some(m => m.type === 'notice' && /в глубокой воде/.test(m.title)); i += 1) await new Promise(resolve => setTimeout(resolve, 20));
    const hint = gmHears.find(m => m.type === 'notice' && /в глубокой воде/.test(m.title));
    assert.equal(hint?.title, 'Рыцарь в доспехе в глубокой воде');
    assert.match(hint?.detail, /^Кольчуга: мастер решает, нужна ли проверка Силы \(Атлетика\)/);
    assert.ok(!aliceHears.some(m => m.type === 'notice' && /в глубокой воде/.test(m.title)), 'players do not see the hint');

    assert.equal((await moveTo(4)).statusCode, 200);
    assert.equal(await moved(), 30, 'one more swum cell and one dry: +15');
    assert.equal((await moveTo(6)).statusCode, 200);
    assert.equal(await moved(), 45, 'shallow water is difficult terrain: +10 +5');
    assert.equal(gmHears.filter(m => m.type === 'notice' && /в глубокой воде/.test(m.title)).length, 1, 'once, when he goes in');
  });

  await t.test('a swimming speed swims for the price of walking', async () => {
    await pg.query(`UPDATE characters SET sheet_extra = sheet_extra || '{"swimSpeedFeet": 30}'::jsonb WHERE id=$1`, [hero.id]);
    await pg.query(`UPDATE initiative_entries SET moved_feet=0 WHERE character_id=$1`, [hero.id]);
    assert.equal((await moveTo(1)).statusCode, 200);
    assert.equal(await moved(), 30, 'back: shallow 10, then four cells at 5 — two of them swum');
  });
});
