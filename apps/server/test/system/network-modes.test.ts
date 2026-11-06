import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {AddressInfo} from 'node:net';
import WebSocket from 'ws';
import {buildApp} from '../../src/app.ts';
import {closeTunnelListener, createTunnelListener, isPublicAddress} from '../../src/system/network.ts';
import {MAX_LIVE_PER_USER} from '../../src/tabletop/live/socket.ts';
import {createTestDatabase} from '../helpers.ts';

test('tunnel listener, real client address, invite-only registration from the internet', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db);
  t.after(() => app.close());
  const main = await app.listen({host: '127.0.0.1', port: 0});
  const tunnel = await createTunnelListener(app, 0);
  t.after(() => closeTunnelListener(tunnel));
  const tunnelUrl = `http://127.0.0.1:${(tunnel.address() as AddressInfo).port}`;

  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const call = (via: 'main' | 'tunnel', method: string, path: string, body?: unknown, token?: string, ip = '203.0.113.7') => asApp(async () => {
    const response = await fetch(`${via === 'main' ? main : tunnelUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? {'content-type': 'application/json'} : {}),
        ...(token ? {authorization: `Bearer ${token}`} : {}),
        ...(via === 'tunnel' ? {'cf-connecting-ip': ip, 'cf-ray': 'test'} : {}),
      },
      ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
    });
    const text = await response.text();
    return {status: response.status, body: text ? JSON.parse(text) : null};
  });

  const gm = (await call('main', 'POST', '/auth/register', {username: 'gm_net', password: 'x'})).body;
  const campaignId = (await call('main', 'POST', '/campaigns', {name: 'Сеть'}, gm.token)).body.id;
  const invite = async () => (await call('main', 'POST', `/campaigns/${campaignId}/invites`, undefined, gm.token)).body.code as string;

  await t.test('the tunnel never gets host rights', async () => {
    assert.equal((await call('main', 'GET', '/host/accounts')).status, 200, 'the GM window on loopback');
    const viaTunnel = await call('tunnel', 'GET', '/host/accounts');
    assert.equal(viaTunnel.status, 403);
    assert.equal((await call('tunnel', 'GET', '/host/connections')).status, 403);
    assert.equal((await call('tunnel', 'PUT', '/host/settings', {openRegistration: true})).status, 403);
    const me = (await call('tunnel', 'GET', '/me', undefined, gm.token)).body;
    assert.equal(me.isServerHost, false);
    assert.equal(me.canCreateCampaigns, false, 'creating campaigns is the host right too');
    assert.deepEqual([me.connection.clientAddress, me.connection.network, me.connection.internet], ['203.0.113.7', 'Туннель Cloudflare', true]);
    const local = (await call('main', 'GET', '/me', undefined, gm.token)).body;
    assert.deepEqual([local.isServerHost, local.connection.internet], [true, false]);
  });

  await t.test('registration from the internet needs an invite until the host opens it', async () => {
    assert.equal((await call('tunnel', 'GET', '/health')).body.registration, 'invite');
    assert.equal((await call('main', 'GET', '/health')).body.registration, 'open');
    const refused = await call('tunnel', 'POST', '/auth/register', {username: 'stranger', password: 'x'});
    assert.equal(refused.status, 403);
    assert.match(refused.body.message, /только по приглашению/);
    const code = await invite();
    const player = await call('tunnel', 'POST', '/auth/register', {username: 'player_net', password: 'x', inviteCode: code});
    assert.equal(player.status, 201, JSON.stringify(player.body));
    assert.equal(player.body.joinedCampaignId, campaignId, 'registering by invite already puts the player in the campaign');
    assert.equal((await call('tunnel', 'POST', '/campaigns/join', {code}, player.body.token)).status, 200);
    const reused = await call('tunnel', 'POST', '/auth/register', {username: 'player_two', password: 'x', inviteCode: code});
    assert.equal(reused.status, 403, 'the invite is spent');
    assert.match(reused.body.message, /уже использовано или истекло/);

    assert.deepEqual((await call('main', 'PUT', '/host/settings', {openRegistration: true})).body, {openRegistration: true});
    assert.equal((await call('tunnel', 'GET', '/health')).body.registration, 'open');
    assert.equal((await call('tunnel', 'POST', '/auth/register', {username: 'free_net', password: 'x'})).status, 201);
    await call('main', 'PUT', '/host/settings', {openRegistration: false});
    assert.equal((await call('main', 'GET', '/host/settings')).body.openRegistration, false);
  });

  await t.test('the login limit counts the real address behind the tunnel', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await call('tunnel', 'POST', '/auth/login', {username: 'gm_net', password: 'wrong'}, undefined, '198.51.100.1')).status, 401);
    assert.equal((await call('tunnel', 'POST', '/auth/login', {username: 'gm_net', password: 'wrong'}, undefined, '198.51.100.1')).status, 429);
    assert.equal((await call('tunnel', 'POST', '/auth/login', {username: 'gm_net', password: 'x'}, undefined, '198.51.100.2')).status, 200, 'another player is not blocked');
    const connections = (await call('main', 'GET', '/host/connections')).body;
    const failed = connections.events.find((event: any) => event.kind === 'login_failed');
    assert.deepEqual([failed.remoteAddress, failed.network, failed.fromThisComputer], ['198.51.100.1', 'Туннель Cloudflare', false]);
  });

  await t.test('the live channel works through the tunnel', async () => {
    const socket = new WebSocket(`${tunnelUrl.replace('http', 'ws')}/live`, {headers: {'cf-connecting-ip': '203.0.113.9'}});
    t.after(() => socket.terminate());
    const messages: any[] = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send(JSON.stringify({token: gm.token, campaignId, sceneId: null}));
    for (let i = 0; i < 100 && !messages.some(m => m.type === 'ready'); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(messages.some(m => m.type === 'ready'));
  });

  await t.test('one account keeps a bounded number of live connections, the oldest goes first', async () => {
    const open = async () => {
      const socket = new WebSocket(`${main.replace('http', 'ws')}/live`);
      const state = {ready: false, closedWith: 0};
      socket.on('message', raw => { if (JSON.parse(raw.toString()).type === 'ready') state.ready = true; });
      socket.on('close', code => { state.closedWith = code; });
      await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      socket.send(JSON.stringify({token: gm.token, campaignId, sceneId: null}));
      for (let i = 0; i < 100 && !state.ready; i++) await new Promise(resolve => setTimeout(resolve, 10));
      return {socket, state};
    };
    const sockets: Array<Awaited<ReturnType<typeof open>>> = [];
    for (let i = 0; i <= MAX_LIVE_PER_USER; i++) sockets.push(await open());
    t.after(() => sockets.forEach(entry => entry.socket.terminate()));
    for (let i = 0; i < 100 && !sockets[0]!.state.closedWith; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(sockets[0]!.state.closedWith, 4001, 'the oldest connection is closed with a code the client reconnects after');
    assert.ok(sockets.slice(1).every(entry => entry.state.ready && !entry.state.closedWith));
  });

  await t.test('which addresses count as the internet', () => {
    for (const local of ['127.0.0.1', '::1', '10.1.2.3', '172.20.0.5', '192.168.1.10', '169.254.3.4', '100.70.1.2', '26.34.12.5', '25.1.2.3', 'fe80::1', 'fd12::5', '::ffff:192.168.0.2']) {
      assert.equal(isPublicAddress(local), false, local);
    }
    for (const outside of ['8.8.8.8', '203.0.113.7', '172.32.0.1', '2a00:1450:4001::1', 'туннель']) assert.equal(isPublicAddress(outside), true, outside);
  });
});
