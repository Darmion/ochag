import {test} from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {buildApp} from '../../src/app.ts';
import {assertUploadRoom} from '../../src/system/asset-routes.ts';
import {addressKey} from '../../src/system/rate-keys.ts';
import {newToken} from '../../src/system/security.ts';
import {createTestDatabase} from '../helpers.ts';

const OUTSIDE = '203.0.113.20';

test('playing over the internet: limits and answers strangers cannot game', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 100_000});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const login = (username: string, password: string, remoteAddress: string, token?: string) => asApp(() => app.inject({
    method: 'POST', url: '/auth/login', remoteAddress, payload: {username, password},
    ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}),
  }));
  const registered = await asApp(() => app.inject({method: 'POST', url: '/auth/register', payload: {username: 'victim_net', password: 'secret'}}));
  assert.equal(registered.statusCode, 201);

  await t.test('a made-up token gets no allowance of its own', async () => {
    const limited = await buildApp(db, {rateMax: 2});
    try {
      const health = () => asApp(() => limited.inject({method: 'GET', url: '/health', remoteAddress: OUTSIDE, headers: {authorization: `Bearer ${newToken()}`}}));
      assert.equal((await health()).statusCode, 200);
      assert.equal((await health()).statusCode, 200);
      assert.equal((await health()).statusCode, 429, 'a fresh fake token every time still counts against the address');
    } finally { await limited.close(); }
  });

  await t.test('the login limit counts the address even with a token in the request', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await login('victim_net', 'wrong', '198.51.100.7', newToken())).statusCode, 401);
    assert.equal((await login('victim_net', 'wrong', '198.51.100.7', newToken())).statusCode, 429);
  });

  await t.test('failed logins per login name stop guessing from many addresses', async () => {
    for (let i = 1; i <= 10; i++) assert.equal((await login('victim_net', 'wrong', `198.51.100.${100 + i}`)).statusCode, 401, '10 failures above plus these make 20');
    const blocked = await login('victim_net', 'secret', '198.51.100.200');
    assert.equal(blocked.statusCode, 429, 'even the right password waits once 20 attempts failed');
    assert.match(blocked.json().message, /Слишком много неудачных попыток войти в «victim_net»\. Подождите \d+ мин\./);
    assert.equal((await login('victim_net', 'secret', '192.168.1.50')).statusCode, 200, 'guessing from the internet never locks out the home network');
    assert.equal((await login('victim_net', 'secret', '198.51.100.202')).statusCode, 429, 'a home login does not reopen the internet');
    assert.equal((await login('victim_net', 'secret', '127.0.0.1')).statusCode, 200, 'the GM’s own computer is never locked out');
    assert.equal((await login('victim_net', 'secret', '198.51.100.201')).statusCode, 200, 'a successful login clears the count');
  });

  await t.test('from the internet a missing login and a wrong password read the same', async () => {
    const missing = await login('nobody_net', 'x', '192.0.2.10');
    const wrong = await login('victim_net', 'x', '192.0.2.11');
    assert.equal(missing.statusCode, 401);
    assert.equal(wrong.statusCode, 401);
    assert.equal(missing.json().message, wrong.json().message);
    assert.match(missing.json().message, /Неверный логин или пароль/);
    assert.match((await login('nobody_net', 'x', '127.0.0.1')).json().message, /нет аккаунта «nobody_net»/, 'the home network keeps the precise hint');
  });

  await t.test('the GM’s computer name stays off the internet', async () => {
    const remote = (await asApp(() => app.inject({method: 'GET', url: '/health', remoteAddress: OUTSIDE}))).json();
    const local = (await asApp(() => app.inject({method: 'GET', url: '/health'}))).json();
    assert.equal(remote.hostName, null);
    assert.equal(typeof local.hostName, 'string');
    assert.equal(remote.serverId, local.serverId, 'the server id still lets a player recognise the server');
  });

  await t.test('answers never let the browser guess the content type or frame the page', async () => {
    const response = await asApp(() => app.inject({method: 'GET', url: '/health'}));
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
  });

  await t.test('a web page that renamed 127.0.0.1 to its own domain does not pass as the GM’s computer', async () => {
    const host = (value: string, remoteAddress = '127.0.0.1') => asApp(() => app.inject({method: 'GET', url: '/host/settings', remoteAddress, headers: {host: value}}));
    const rebound = await host('evil.example:3000');
    assert.equal(rebound.statusCode, 421);
    assert.equal(rebound.json().error, 'FOREIGN_HOST');
    for (const allowed of ['127.0.0.1:3000', 'localhost:3000', '[::1]:3000', `${os.hostname()}:3000`]) {
      assert.equal((await host(allowed)).statusCode, 200, allowed);
    }
    assert.equal((await host('evil.example:3000', '192.168.1.50')).statusCode, 403, 'another computer is no host anyway, whatever its Host header');
  });

  await t.test('an invite from the internet registers one player and puts them in the campaign', async () => {
    const gm = (await asApp(() => app.inject({method: 'POST', url: '/auth/register', payload: {username: 'gm_invite_net', password: 'secret'}}))).json();
    const campaignId = (await asApp(() => app.inject({method: 'POST', url: '/campaigns', headers: {authorization: `Bearer ${gm.token}`}, payload: {name: 'Invite net'}}))).json().id;
    const code = (await asApp(() => app.inject({method: 'POST', url: `/campaigns/${campaignId}/invites`, headers: {authorization: `Bearer ${gm.token}`}}))).json().code;
    const register = (username: string) => asApp(() => app.inject({method: 'POST', url: '/auth/register', remoteAddress: OUTSIDE, payload: {username, password: 'secret', inviteCode: code}}));
    const first = await register('invited_net');
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(first.json().joinedCampaignId, campaignId);
    const joined = await asApp(() => app.inject({method: 'POST', url: '/campaigns/join', headers: {authorization: `Bearer ${first.json().token}`}, payload: {code}}));
    assert.equal(joined.json().alreadyMember, true, 'the old client flow still joins without an error');
    const second = await register('invited_net_2');
    assert.equal(second.statusCode, 403, 'the same invite makes no second account');
  });
});

test('one IPv6 /64 shares an allowance; IPv4 stays as it is', () => {
  assert.equal(addressKey('2001:db8:1:2::5'), addressKey('2001:0db8:0001:0002:ffff::9'));
  assert.equal(addressKey('2001:db8:1:2::5'), '2001:db8:1:2::/64');
  assert.notEqual(addressKey('2001:db8:1:2::5'), addressKey('2001:db8:1:3::5'));
  assert.equal(addressKey('::1'), '0:0:0:0::/64');
  assert.equal(addressKey('203.0.113.20'), '203.0.113.20');
  assert.equal(addressKey('туннель'), 'туннель');
});

test('a player’s uploads in one campaign stop at 200 MB; a GM has no cap', async () => {
  const used = (bytes: number) => ({query: async () => ({rows: [{used: String(bytes)}]})}) as any;
  const player = {owner_user_id: 'gm', is_full_gm: false};
  const MiB = 1024 * 1024;
  await assertUploadRoom(used(150 * MiB), player, 'campaign', 'player', 50 * MiB);
  await assert.rejects(assertUploadRoom(used(150 * MiB), player, 'campaign', 'player', 50 * MiB + 1), (error: any) => {
    assert.equal(error.statusCode, 413);
    assert.match(error.message, /предел для игрока/);
    return true;
  });
  await assertUploadRoom(used(10_000 * MiB), player, 'campaign', 'gm', 25 * MiB);
  await assertUploadRoom(used(10_000 * MiB), {owner_user_id: 'gm', is_full_gm: true}, 'campaign', 'co-gm', 25 * MiB);
});
