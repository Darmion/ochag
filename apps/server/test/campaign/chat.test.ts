import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('campaign chat: in and out of character, whispers', async t => {
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

  const gm = await register('gm_chat'), alice = await register('alice_chat'), bob = await register('bob_chat');
  const stranger = await register('stranger_chat');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Chat'})).json().id;
  for (const player of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', player.token, {code});
  }
  const base = `/campaigns/${campaignId}/chat`;
  const hero = (await request('POST', `/campaigns/${campaignId}/characters`, alice.token, {kind: 'character', name: 'Лиэна'})).json();

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
  const bodies = async (token: string) => (await request('GET', base, token)).json().messages.map((m: any) => m.body);

  await t.test('a message out of character reaches everyone', async () => {
    const bobHears = await listen(bob.token);
    const said = await request('POST', base, alice.token, {body: 'Идём к мельнице?'});
    assert.equal(said.statusCode, 201, said.body);
    assert.deepEqual([said.json().message.user_name, said.json().message.in_character], ['alice_chat', false]);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(bobHears.find(m => m.type === 'chat')?.message.body, 'Идём к мельнице?');
    assert.equal((await request('GET', base, stranger.token)).statusCode, 404, 'outsiders do not even see the campaign');
  });

  await t.test('in character — only as one’s own character', async () => {
    assert.equal((await request('POST', base, alice.token, {body: 'Стой!', inCharacter: true})).statusCode, 400);
    assert.equal((await request('POST', base, bob.token, {body: 'Стой!', inCharacter: true, characterId: hero.id})).statusCode, 403);
    const line = await request('POST', base, alice.token, {body: 'Стой, кто идёт?', inCharacter: true, characterId: hero.id});
    assert.deepEqual([line.json().message.character_name, line.json().message.in_character], ['Лиэна', true]);
  });

  await t.test('a whisper is seen by the two of them only', async () => {
    assert.equal((await request('POST', base, alice.token, {body: 'Тсс', toUserId: stranger.user.id})).statusCode, 400);
    assert.equal((await request('POST', base, alice.token, {body: 'Тсс', toUserId: alice.user.id})).statusCode, 400);
    assert.equal((await request('POST', base, alice.token, {body: 'У меня есть ключ.', toUserId: gm.user.id})).statusCode, 201);
    assert.ok((await bodies(gm.token)).includes('У меня есть ключ.'));
    assert.ok((await bodies(alice.token)).includes('У меня есть ключ.'));
    assert.ok(!(await bodies(bob.token)).includes('У меня есть ключ.'));
    assert.deepEqual(await bodies(bob.token), ['Идём к мельнице?', 'Стой, кто идёт?'], 'oldest first');
  });

  await t.test('the author or the GM takes a message back', async () => {
    const said = (await request('POST', base, bob.token, {body: 'опечатка'})).json().message;
    assert.equal((await request('DELETE', `${base}/${said.id}`, alice.token)).statusCode, 403);
    assert.equal((await request('DELETE', `${base}/${said.id}`, bob.token)).statusCode, 204);
    const other = (await request('POST', base, bob.token, {body: 'лишнее'})).json().message;
    assert.equal((await request('DELETE', `${base}/${other.id}`, gm.token)).statusCode, 204);
    assert.ok(!(await bodies(bob.token)).some((body: string) => body === 'опечатка' || body === 'лишнее'));
  });
});
