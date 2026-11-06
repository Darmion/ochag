import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('handouts', async t => {
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

  const gm = await register('gm_handout'), alice = await register('alice_handout'), bob = await register('bob_handout');
  const stranger = await register('stranger_handout');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Handouts'})).json().id;
  for (const player of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', player.token, {code});
  }
  const base = `/campaigns/${campaignId}/handouts`;
  const picture = (await pg.query<any>(
    `INSERT INTO assets (campaign_id, kind, content_type, byte_size, storage_key, uploaded_by) VALUES ($1,'object_image','image/png',10,'handout-test.png',$2) RETURNING id`,
    [campaignId, gm.user.id],
  )).rows[0].id;
  const music = (await pg.query<any>(
    `INSERT INTO assets (campaign_id, kind, content_type, byte_size, storage_key, uploaded_by) VALUES ($1,'audio','audio/wav',10,'handout-test.wav',$2) RETURNING id`,
    [campaignId, gm.user.id],
  )).rows[0].id;

  const wsAddress = (await app.listen({host: '127.0.0.1', port: 0})).replace('http', 'ws');
  const listen = async (token: string) => {
    const socket = new WebSocket(`${wsAddress}/live`);
    t.after(() => socket.terminate());
    const messages: any[] = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await new Promise(resolve => socket.once('open', resolve));
    socket.send(JSON.stringify({token, campaignId, sceneId: null}));
    while (!messages.some(m => m.type === 'ready')) await new Promise(resolve => setTimeout(resolve, 20));
    return messages;
  };

  let letterId = '';

  await t.test('only the GM shows handouts; text or picture, an image of this campaign', async () => {
    assert.equal((await request('POST', base, alice.token, {title: 'Письмо', body: 'Текст'})).statusCode, 403);
    assert.equal((await request('POST', base, gm.token, {title: 'Пусто'})).statusCode, 400, 'text or a picture');
    assert.equal((await request('POST', base, gm.token, {title: 'Звук', assetId: music})).statusCode, 400, 'a picture, not a sound');
    assert.equal((await request('POST', base, gm.token, {title: 'Чужим', body: 'x', userIds: [stranger.user.id]})).statusCode, 400);
  });

  await t.test('a letter for Alice only: it opens for her, Bob does not even get it', async () => {
    const aliceMessages = await listen(alice.token);
    const bobMessages = await listen(bob.token);
    const shown = await request('POST', base, gm.token, {title: 'Письмо барона', body: 'Встретимся у мельницы.\nБ.', userIds: [alice.user.id]});
    assert.equal(shown.statusCode, 201, shown.body);
    letterId = shown.json().handout.id;
    await new Promise(resolve => setTimeout(resolve, 300));
    const opened = aliceMessages.find(m => m.type === 'handout');
    assert.deepEqual(opened?.handout, {id: letterId, title: 'Письмо барона', body: 'Встретимся у мельницы.\nБ.', assetId: null});
    assert.ok(!bobMessages.some(m => m.type === 'handout'));
    assert.deepEqual((await request('GET', base, alice.token)).json().handouts.map((h: any) => h.title), ['Письмо барона']);
    assert.deepEqual((await request('GET', base, bob.token)).json().handouts, []);
  });

  await t.test('a map for everyone; showing the letter again adds Bob; the GM sees who got what', async () => {
    assert.equal((await request('POST', base, gm.token, {title: 'Карта сокровищ', assetId: picture})).statusCode, 201);
    assert.deepEqual((await request('GET', base, bob.token)).json().handouts.map((h: any) => h.title), ['Карта сокровищ']);
    assert.equal((await request('POST', `${base}/${letterId}/show`, gm.token, {userIds: [bob.user.id]})).statusCode, 200);
    const forGm = (await request('GET', base, gm.token)).json();
    assert.equal(forGm.canManage, true);
    const letter = forGm.handouts.find((h: any) => h.id === letterId);
    assert.deepEqual(letter.recipients.map((r: any) => r.userId).sort(), [alice.user.id, bob.user.id].sort());
  });

  await t.test('deleting takes it out of every journal', async () => {
    assert.equal((await request('DELETE', `${base}/${letterId}`, alice.token)).statusCode, 403);
    assert.equal((await request('DELETE', `${base}/${letterId}`, gm.token)).statusCode, 204);
    assert.deepEqual((await request('GET', base, alice.token)).json().handouts.map((h: any) => h.title), ['Карта сокровищ']);
  });
});
