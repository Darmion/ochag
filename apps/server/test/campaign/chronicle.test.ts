import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('campaign chronicle', async t => {
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

  const gm = await register('gm_chronicle'), alice = await register('alice_chronicle');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Chronicle'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Тракт у мельницы', widthCells: 10, heightCells: 1})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  await t.test('only the GM starts and ends a session', async () => {
    assert.equal((await request('POST', `${base}/session/start`, alice.token)).statusCode, 403);
    assert.equal((await request('POST', `${base}/session/start`, gm.token)).json().previous, null);
    assert.ok((await request('GET', `${base}/chronicle`, gm.token)).json().sessionStartedAt);
  });

  let entryId = '';

  await t.test('ending the session drafts a recap of what happened: a fight, a quest, a handout, the time', async () => {
    const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Лиэна'})).json();
    await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: -4.5, z: 0});
    await request('POST', `${scenePath}/initiative/join`, alice.token, {characterId: hero.id});
    await pg.query('UPDATE scenes SET combat_round=3 WHERE id=$1', [sceneId]);
    assert.equal((await request('DELETE', `${scenePath}/initiative`, gm.token)).statusCode, 204);
    const quest = (await request('POST', `${base}/quests`, gm.token, {title: 'Найти барона'})).json();
    await request('PATCH', `${base}/quests/${quest.quest?.id ?? quest.id}`, gm.token, {status: 'completed'});
    await request('POST', `${base}/handouts`, gm.token, {title: 'Письмо барона', body: 'У мельницы.'});
    await request('PUT', `${base}/time`, gm.token, {advanceMinutes: 120});

    const ended = await request('POST', `${base}/session/end`, gm.token);
    assert.equal(ended.statusCode, 201, ended.body);
    const entry = ended.json().entry;
    entryId = entry.id;
    assert.equal(entry.published, false);
    assert.match(entry.title, /^Сессия /);
    assert.match(entry.body, /Время в мире: День 1, 08:00 → День 1, 10:0\d\./);
    assert.match(entry.body, /Бой: Тракт у мельницы — 3 раунда\./);
    assert.match(entry.body, /Выполнено: «Найти барона»\./);
    assert.match(entry.body, /«Письмо барона»/);
    assert.equal((await request('GET', `${base}/chronicle`, gm.token)).json().sessionStartedAt, null);
  });

  await t.test('players see only what the GM publishes', async () => {
    assert.deepEqual((await request('GET', `${base}/chronicle`, alice.token)).json().entries, []);
    const edited = await request('PATCH', `${base}/chronicle/${entryId}`, gm.token, {body: 'Отряд нашёл след барона.', published: true, revision: 1});
    assert.equal(edited.statusCode, 200, edited.body);
    assert.equal((await request('PATCH', `${base}/chronicle/${entryId}`, gm.token, {body: 'x', revision: 1})).statusCode, 409);
    assert.deepEqual((await request('GET', `${base}/chronicle`, alice.token)).json().entries.map((e: any) => e.body), ['Отряд нашёл след барона.']);
  });

  await t.test('the next session opens with «last time» for everyone', async () => {
    const wsAddress = (await app.listen({host: '127.0.0.1', port: 0})).replace('http', 'ws');
    const socket = new WebSocket(`${wsAddress}/live`);
    t.after(() => socket.terminate());
    const messages: any[] = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await new Promise(resolve => socket.once('open', resolve));
    socket.send(JSON.stringify({token: alice.token, campaignId, sceneId: null}));
    while (!messages.some(m => m.type === 'ready')) await new Promise(resolve => setTimeout(resolve, 20));
    const started = await request('POST', `${base}/session/start`, gm.token);
    assert.equal(started.json().previous.body, 'Отряд нашёл след барона.');
    await new Promise(resolve => setTimeout(resolve, 300));
    const recap = messages.find(m => m.type === 'handout');
    assert.match(recap?.handout.title ?? '', /^В прошлый раз: Сессия/);
    assert.equal(recap.handout.body, 'Отряд нашёл след барона.');
  });
});
