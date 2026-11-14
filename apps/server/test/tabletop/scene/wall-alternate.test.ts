import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('walls: alternating looks by sections of a chain', async t => {
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

  const gm = await register('gm_alternate'), alice = await register('alice_alternate');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Alternate'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Ущелье', widthCells: 12, heightCells: 12})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const walls = async () => (await request('GET', scenePath, gm.token)).json().walls as any[];
  const along = (list: any[]) => [...list].sort((a, b) => Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2) || Math.min(a.z1, a.z2) - Math.min(b.z1, b.z2));

  const made = await request('POST', `${scenePath}/walls/batch`, gm.token, {walls: [{x1: 0, z1: 0, x2: 4, z2: 0}, {x1: 4, z1: 0, x2: 4, z2: 2}], style: 'rock'});
  assert.equal(made.statusCode, 201, made.body);
  const ids = made.json().walls.map((wall: any) => wall.id);

  await t.test('only the GM; at least two plain looks', async () => {
    assert.equal((await request('POST', `${scenePath}/walls/alternate`, alice.token, {ids, styles: ['rock', 'stone'], mode: 'cycle'})).statusCode, 403);
    assert.equal((await request('POST', `${scenePath}/walls/alternate`, gm.token, {ids, styles: ['rock'], mode: 'cycle'})).statusCode, 400);
    assert.equal((await request('POST', `${scenePath}/walls/alternate`, gm.token, {ids, styles: ['rock', 'image'], mode: 'cycle'})).statusCode, 400);
  });

  await t.test('in turn by one cell: long walls are cut into sections, the turn goes on after the corner', async () => {
    const response = await request('POST', `${scenePath}/walls/alternate`, gm.token, {ids, styles: ['rock', 'stone'], mode: 'cycle'});
    assert.equal(response.statusCode, 200, response.body);
    const now = await walls();
    assert.equal(now.length, 6, 'four cells plus two cells');
    assert.deepEqual(new Set(response.json().ids), new Set(now.map(wall => wall.id)), 'the new pieces come back for the selection');
    const straight = along(now.filter(wall => wall.z1 === 0 && wall.z2 === 0));
    assert.deepEqual(straight.map(wall => [Math.min(wall.x1, wall.x2), wall.style]), [[0, 'rock'], [1, 'stone'], [2, 'rock'], [3, 'stone']]);
    const turn = along(now.filter(wall => wall.x1 === 4 && wall.x2 === 4));
    assert.deepEqual(turn.map(wall => wall.style), ['rock', 'stone']);
  });

  await t.test('two cells per section joins cells back; doors keep one piece', async () => {
    const all = (await walls()).map(wall => wall.id);
    const response = await request('POST', `${scenePath}/walls/alternate`, gm.token, {ids: all, styles: ['brick', 'wood'], mode: 'cycle', length: 2});
    assert.equal(response.statusCode, 200, response.body);
    const now = await walls();
    assert.equal(now.length, 6, 'cells already cut stay cut; each gets its section look');
    assert.deepEqual(along(now.filter(wall => wall.z1 === 0 && wall.z2 === 0)).map(wall => wall.style), ['brick', 'brick', 'wood', 'wood']);

    const door = (await request('POST', `${scenePath}/walls`, gm.token, {x1: -6, z1: 4, x2: -4, z2: 4, kind: 'door'})).json();
    const doorResult = await request('POST', `${scenePath}/walls/alternate`, gm.token, {ids: [door.id], styles: ['rock', 'stone'], mode: 'cycle'});
    assert.equal(doorResult.statusCode, 200, doorResult.body);
    const kept = (await walls()).filter(wall => wall.kind === 'door');
    assert.deepEqual(kept.map(wall => [wall.id, wall.x1, wall.x2, wall.style]), [[door.id, -6, -4, 'rock']]);
  });

  await t.test('mixed: neighbouring sections never match', async () => {
    const long = (await request('POST', `${scenePath}/walls`, gm.token, {x1: -6, z1: 5, x2: 4, z2: 5})).json();
    const response = await request('POST', `${scenePath}/walls/alternate`, gm.token, {ids: [long.id], styles: ['rock', 'stone', 'hedge'], mode: 'mix'});
    assert.equal(response.statusCode, 200, response.body);
    const row = along((await walls()).filter(wall => wall.z1 === 5 && wall.z2 === 5));
    const cells = row.flatMap(wall => Array.from({length: Math.abs(wall.x2 - wall.x1)}, () => wall.style));
    assert.equal(cells.length, 10);
    for (let index = 1; index < cells.length; index += 1) assert.notEqual(cells[index], cells[index - 1], cells.join(' '));
  });
});
