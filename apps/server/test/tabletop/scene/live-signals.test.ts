import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

type Live = {
  send(message: unknown): void;
  waitFor(predicate: (message: any) => boolean, timeout?: number): Promise<any>;
  messages: any[];
  close(): Promise<void>;
};

test('table signals: pointer pings and shared rulers', async t => {
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

  const gm = await register('gm_signal'), player = await register('player_signal'), other = await register('other_signal');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Signals'})).json().id;
  for (const member of [player, other]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Перекрёсток'})).json().id;
  const otherSceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Подвал'})).json().id;

  const wsAddress = (await app.listen({host: '127.0.0.1', port: 0})).replace('http', 'ws');
  const sockets: WebSocket[] = [];
  const connect = async (token: string, scene = sceneId): Promise<Live> => {
    const socket = new WebSocket(`${wsAddress}/live`);
    sockets.push(socket);
    const messages: any[] = [];
    const waiters: Array<{predicate: (m: any) => boolean; resolve: (m: any) => void}> = [];
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      messages.push(message);
      for (const waiter of [...waiters]) {
        if (waiter.predicate(message)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
    await new Promise(resolve => socket.once('open', resolve));
    const live: Live = {
      messages,
      send: message => socket.send(JSON.stringify(message)),
      waitFor: (predicate, timeout = 3000) => new Promise((resolve, reject) => {
        const found = messages.find(predicate);
        if (found) return resolve(found);
        const timer = setTimeout(() => reject(new Error('Timed out waiting for live message')), timeout);
        waiters.push({predicate, resolve: message => { clearTimeout(timer); resolve(message); }});
      }),
      close: () => new Promise(resolve => { socket.once('close', () => resolve()); socket.close(); }),
    };
    live.send({token, campaignId, sceneId: scene});
    await live.waitFor(m => m.type === 'ready');
    return live;
  };

  const gmLive = await connect(gm.token);
  const playerLive = await connect(player.token);
  const elsewhere = await connect(other.token, otherSceneId);
  t.after(() => sockets.forEach(socket => socket.terminate()));
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  await t.test('a ping reaches the rest of the scene, signed by the server, not echoed back', async () => {
    playerLive.send({type: 'ping', x: 2.5, z: -1.5, userId: gm.user.id, displayName: 'Мастер'});
    const ping = await gmLive.waitFor(m => m.type === 'ping');
    assert.deepEqual(ping, {type: 'ping', userId: player.user.id, displayName: 'player_signal', x: 2.5, z: -1.5});

    await sleep(150);
    assert.ok(!playerLive.messages.some(m => m.type === 'ping'), 'the sender draws its own ping locally');
    assert.ok(!elsewhere.messages.some(m => m.type === 'ping'), 'a participant on another scene does not get it');
  });

  await t.test('malformed or out-of-range signals are dropped silently', async () => {
    gmLive.messages.length = 0;
    playerLive.send({type: 'ping', x: '1', z: 0});
    playerLive.send({type: 'ping', x: 5000, z: 0});
    playerLive.send({type: 'measure', from: {x: 0, z: 0}});
    playerLive.send({type: 'measure', from: {x: 0, z: 0}, to: {x: 0, z: -2000}});
    await sleep(200);
    assert.deepEqual(gmLive.messages.filter(m => m.type === 'ping' || m.type === 'measure'), []);
  });

  await t.test('pings are rate limited, so nobody can flood the table', async () => {
    await sleep(1100);
    gmLive.messages.length = 0;
    for (let i = 0; i < 10; i++) playerLive.send({type: 'ping', x: i, z: 0});
    await sleep(300);
    const pings = gmLive.messages.filter(m => m.type === 'ping');
    assert.equal(pings.length, 3);
    assert.deepEqual(pings.map(p => p.x), [0, 1, 2]);
  });

  await t.test('a ruler is shared while measuring and cleared on request', async () => {
    gmLive.messages.length = 0;
    playerLive.send({type: 'measure', from: {x: 0.5, z: 0.5}, to: {x: 3.5, z: 0.5}});
    playerLive.send({type: 'measure', from: {x: 0.5, z: 0.5}, to: {x: 4.5, z: 2.5}});
    const last = await gmLive.waitFor(m => m.type === 'measure' && m.to.x === 4.5);
    assert.deepEqual(last, {type: 'measure', userId: player.user.id, displayName: 'player_signal', from: {x: 0.5, z: 0.5}, to: {x: 4.5, z: 2.5}});

    playerLive.send({type: 'measure-clear'});
    const cleared = await gmLive.waitFor(m => m.type === 'measure-clear');
    assert.deepEqual(cleared, {type: 'measure-clear', userId: player.user.id});
    assert.equal(gmLive.messages.findIndex(m => m.type === 'measure-clear') > gmLive.messages.findIndex(m => m.type === 'measure' && m.to.x === 4.5), true,
      'the clear never overtakes the last ruler step');

    gmLive.messages.length = 0;
    playerLive.send({type: 'measure-clear'});
    await sleep(150);
    assert.deepEqual(gmLive.messages.filter(m => m.type === 'measure-clear'), []);
  });

  await t.test('a ruler left behind by a disconnected participant disappears for everyone', async () => {
    const leaving = await connect(other.token);
    gmLive.messages.length = 0;
    leaving.send({type: 'measure', from: {x: 0.5, z: 0.5}, to: {x: -2.5, z: 0.5}});
    await gmLive.waitFor(m => m.type === 'measure' && m.userId === other.user.id);
    await leaving.close();
    const cleared = await gmLive.waitFor(m => m.type === 'measure-clear' && m.userId === other.user.id);
    assert.equal(cleared.userId, other.user.id);
  });

  await t.test('signals do not disturb live dragging on the same socket', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    playerLive.send({type: 'grab', kind: 'object', id: missing});
    const denied = await playerLive.waitFor(m => m.type === 'grab-denied' && m.id === missing);
    assert.match(denied.message, /не найден/);
  });
});
