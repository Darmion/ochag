import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('campaign-wide live events', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db);
  t.after(() => app.close());

  const request = (method: any, url: string, token?: string, payload?: any) => app.inject({
    method, url,
    ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}),
    ...(payload !== undefined ? {payload} : {}),
  });
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_events'), player = await register('player_events'), outsider = await register('outsider_events');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Events'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', player.token, {code});
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Зал'})).json().id;
  const hero = (await request('POST', `/campaigns/${campaignId}/characters`, player.token, {kind: 'character', name: 'Герой'})).json();

  const address = (await app.listen({host: '127.0.0.1', port: 0})).replace('http', 'ws');
  const open = async (token: string, scene: string | null) => {
    const socket = new WebSocket(`${address}/live`);
    t.after(() => socket.terminate());
    const messages: any[] = [];
    let closed: number | null = null;
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    socket.on('close', code => { closed = code; });
    await new Promise(resolve => socket.once('open', resolve));
    socket.send(JSON.stringify({token, campaignId, ...(scene ? {sceneId: scene} : {})}));
    for (let i = 0; i < 100 && !messages.some(m => m.type === 'ready') && closed === null; i++) await new Promise(r => setTimeout(r, 20));
    return {socket, messages, closed: () => closed};
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 250));

  await t.test('a member subscribes to the whole campaign without a scene; a stranger cannot', async () => {
    const stranger = await open(outsider.token, null);
    await settle();
    assert.equal(stranger.closed(), 1008);
    const member = await open(player.token, null);
    assert.ok(member.messages.some(m => m.type === 'ready'));
  });

  await t.test('notes, sheets, rolls and turns reach the app outside the table', async () => {
    const {messages, socket} = await open(player.token, null);

    await request('POST', `/campaigns/${campaignId}/notes`, gm.token, {title: 'Слухи', body: 'В лесу видели волков.'});
    await request('PATCH', `/campaigns/${campaignId}/characters/${hero.id}`, player.token, {revision: hero.revision, hpMax: 12});
    await request('POST', `/campaigns/${campaignId}/rolls`, gm.token, {formula: '1d20'});
    await request('POST', `/campaigns/${campaignId}/scenes/${sceneId}/initiative/npc`, gm.token, {name: 'Волк', score: 12});
    await settle();

    const types = messages.map(m => m.type);
    assert.ok(types.includes('notes'), types.join(','));
    assert.ok(messages.some(m => m.type === 'character' && m.characterId === hero.id));
    assert.ok(types.includes('rolls'));
    assert.ok(messages.some(m => m.type === 'initiative' && m.sceneId === sceneId));

    const before = messages.length;
    await request('PATCH', `/campaigns/${campaignId}/scenes/${sceneId}`, gm.token, {feetPerUnit: 5});
    socket.send(JSON.stringify({type: 'ping', x: 0, z: 0}));
    await settle();
    assert.ok(!messages.slice(before).some(m => m.type === 'changed'), 'no scene-level change for a campaign-only subscription');
    assert.equal(socket.readyState, 1, 'still connected');
  });

  await t.test('sheet sections announce a sheet change', async () => {
    const {messages} = await open(player.token, null);
    await request('PUT', `/campaigns/${campaignId}/characters/${hero.id}/skills/stealth`, player.token, {proficient: true, expertise: false});
    await settle();
    assert.ok(messages.some(m => m.type === 'character' && m.characterId === hero.id), 'skill');
    messages.length = 0;
    await request('PUT', `/campaigns/${campaignId}/characters/${hero.id}/reactions`, player.token, {shield: true});
    await settle();
    assert.ok(messages.some(m => m.type === 'character' && m.characterId === hero.id), 'reactions');
  });

  await t.test('a failed change does not announce anything', async () => {
    const {messages} = await open(player.token, null);
    await request('PATCH', `/campaigns/${campaignId}/characters/${hero.id}`, player.token, {revision: 1, hpMax: 99});
    await settle();
    assert.ok(!messages.some(m => m.type === 'character'), 'a 409 is not a change');
  });
});
