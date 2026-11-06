import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('drawings and labels on the map', async t => {
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

  const gm = await register('gm_draw'), player = await register('player_draw'), other = await register('other_draw');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Drawings'})).json().id;
  for (const member of [player, other]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Карта'})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const drawingsPath = `${scenePath}/drawings`;
  const drawingsOf = async (token: string) => (await request('GET', scenePath, token)).json().drawings;

  const line = {kind: 'path', color: '#E8835A', points: [[0, 0], [1.5, 0.5], [3, 2]]};

  let playerLine = '';

  await t.test('a player draws a line everyone sees, signed with their name', async () => {
    const response = await request('POST', drawingsPath, player.token, line);
    assert.equal(response.statusCode, 201, response.body);
    playerLine = response.json().id;
    assert.equal(response.json().color, '#e8835a');
    assert.equal(response.json().layer, 'all');

    const seen = await drawingsOf(other.token);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].points, [[0, 0], [1.5, 0.5], [3, 2]]);
    assert.equal(seen[0].author_name, 'player_draw');
    assert.equal(seen[0].width, 0.08);
  });

  await t.test('the GM layer is for the GM only — to draw and to see', async () => {
    assert.equal((await request('POST', drawingsPath, player.token, {...line, layer: 'gm'})).statusCode, 403);
    const gmNote = await request('POST', drawingsPath, gm.token, {kind: 'text', layer: 'gm', color: '#f5c469', points: [[2, 2]], text: '  Засада здесь  '});
    assert.equal(gmNote.statusCode, 201, gmNote.body);
    assert.equal(gmNote.json().text, 'Засада здесь');

    assert.equal((await drawingsOf(player.token)).some((d: any) => d.layer === 'gm'), false);
    assert.equal((await drawingsOf(gm.token)).some((d: any) => d.text === 'Засада здесь'), true);
    assert.equal((await request('DELETE', `${drawingsPath}/${gmNote.json().id}`, player.token)).statusCode, 404);
  });

  await t.test('shapes are checked: a line needs two points, a label exactly one and some text', async () => {
    assert.equal((await request('POST', drawingsPath, player.token, {...line, points: [[0, 0]]})).statusCode, 400);
    assert.equal((await request('POST', drawingsPath, player.token, {kind: 'text', color: '#ffffff', points: [[0, 0], [1, 1]], text: 'x'})).statusCode, 400);
    assert.equal((await request('POST', drawingsPath, player.token, {kind: 'text', color: '#ffffff', points: [[0, 0]]})).statusCode, 400);
    assert.equal((await request('POST', drawingsPath, player.token, {...line, color: 'red'})).statusCode, 400);
    assert.equal((await request('POST', drawingsPath, player.token, {...line, points: [[0, 0], [5000, 0]]})).statusCode, 400);
  });

  await t.test('only the author or the GM erases a drawing', async () => {
    assert.equal((await request('DELETE', `${drawingsPath}/${playerLine}`, other.token)).statusCode, 403);
    assert.equal((await request('DELETE', `${drawingsPath}/${playerLine}`, gm.token)).statusCode, 204);
    assert.equal((await drawingsOf(player.token)).length, 0);
  });

  await t.test('«erase mine» removes only one’s own; «erase all» is the GM’s', async () => {
    await request('POST', drawingsPath, player.token, line);
    await request('POST', drawingsPath, player.token, line);
    await request('POST', drawingsPath, other.token, line);

    assert.deepEqual((await request('DELETE', `${drawingsPath}/mine`, player.token)).json(), {removed: 2});
    assert.equal((await drawingsOf(other.token)).length, 1);

    assert.equal((await request('DELETE', `${drawingsPath}/all`, player.token)).statusCode, 403);
    assert.deepEqual((await request('DELETE', `${drawingsPath}/all`, gm.token)).json(), {removed: 2});
    assert.deepEqual(await drawingsOf(gm.token), []);
  });

  await t.test('drawing changes the scene revision so clients pick it up', async () => {
    const before = (await request('GET', scenePath, gm.token)).json().scene.revision;
    await request('POST', drawingsPath, gm.token, line);
    assert.equal((await request('GET', scenePath, gm.token)).json().scene.revision, before + 1);
  });
  await t.test('a text label can be edited by its author or the GM; lines cannot; the map picture rotates', async () => {
    const label = (await request('POST', drawingsPath, player.token, {kind: 'text', color: '#ffffff', points: [[1, 1]], text: 'Пещера'})).json();
    const edited = await request('PATCH', `${drawingsPath}/${label.id}`, player.token, {text: ' Вход в пещеру ', color: '#ff0000', point: [2.5, -1]});
    assert.equal(edited.statusCode, 200, edited.body);
    assert.deepEqual([edited.json().text, edited.json().color, edited.json().points], ['Вход в пещеру', '#ff0000', [[2.5, -1]]]);
    assert.equal((await request('PATCH', `${drawingsPath}/${label.id}`, other.token, {text: 'Чужое'})).statusCode, 403, 'not the author');
    assert.equal((await request('PATCH', `${drawingsPath}/${label.id}`, gm.token, {text: 'Логово'})).statusCode, 200, 'the GM edits any label');
    assert.equal((await request('PATCH', `${drawingsPath}/${label.id}`, player.token, {})).statusCode, 400, 'nothing to change');
    const line = (await request('POST', drawingsPath, player.token, {kind: 'path', color: '#ffffff', points: [[0, 0], [1, 1]]})).json();
    assert.match((await request('PATCH', `${drawingsPath}/${line.id}`, player.token, {color: '#00ff00'})).json().message, /Изменить можно подпись/);

    assert.equal((await request('PATCH', scenePath, gm.token, {backgroundRotation: 90})).statusCode, 200);
    assert.equal((await request('GET', scenePath, player.token)).json().scene.background_rotation, 90);
    assert.equal((await request('PATCH', scenePath, gm.token, {backgroundRotation: 45})).statusCode, 400, 'only 90° steps');
    assert.equal((await request('PATCH', scenePath, player.token, {backgroundRotation: 180})).statusCode, 403);
  });
});
