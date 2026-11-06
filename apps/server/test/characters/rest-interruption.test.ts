import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('a rest that lasts, and what breaks it', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000});
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
  const gm = await register('gm_rest'), alice = await register('alice_rest');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Rest'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Лагерь', widthCells: 8, heightCells: 8})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const lira = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Лира', level: 1, hpMax: 30, hpCurrent: 10})).json();
  const goblin = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 7, hpCurrent: 7})).json();
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: lira.id, x: -1.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 2.5, z: 0.5});

  const rest = async () => (await request('GET', scenePath, alice.token)).json().scene.rest;
  const clock = async () => Number((await pg.query<any>('SELECT world_minutes FROM campaigns WHERE id=$1', [campaignId])).rows[0].world_minutes);
  const hp = async () => (await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [lira.id])).rows[0].hp_current as number;
  const begin = (kind: string, token = gm.token) => request('POST', `${scenePath}/rest/begin`, token, {kind});
  const finish = () => request('POST', `${scenePath}/rest/finish`, gm.token, {});
  const fight = async (rounds = 1) => {
    assert.equal((await request('POST', `${scenePath}/initiative/start`, gm.token, {})).statusCode, 201);
    if (rounds > 1) await pg.query('UPDATE scenes SET combat_round=$2 WHERE id=$1', [sceneId, rounds]);
    assert.equal((await request('DELETE', `${scenePath}/initiative`, gm.token)).statusCode < 300, true);
  };

  await t.test('a long rest: begun, survives a short fight (PHB p. 186), finished — the benefit and the clock', async () => {
    assert.equal((await begin('long', alice.token)).statusCode, 403, 'the GM calls the rest');
    const started = await clock();
    assert.equal((await begin('long')).statusCode, 200);
    assert.equal((await rest()).kind, 'long');
    assert.equal((await begin('short')).statusCode, 400, 'already resting');
    await fight();
    assert.equal((await rest()).interrupted, null, 'a short fight does not break a long rest');
    const finished = await finish();
    assert.equal(finished.statusCode, 200, finished.body);
    assert.equal(finished.json().interrupted, null);
    assert.equal(await hp(), 30, 'all hit points back');
    assert.equal(await clock(), started + 480, 'eight hours in all, the fight included');
    assert.equal(await rest(), null);
  });

  await t.test('a short rest is broken by a fight — no benefit', async () => {
    await pg.query('UPDATE characters SET hp_current=10 WHERE id=$1', [lira.id]);
    await begin('short');
    await fight();
    assert.equal((await rest()).interrupted, 'бой');
    const finished = (await finish()).json();
    assert.equal(finished.interrupted, 'бой');
    assert.equal(await hp(), 10, 'nothing healed');
  });

  await t.test('a fight of an hour or more breaks a long rest; with rest_interruption = any any fight does', async () => {
    await begin('long');
    await fight(600);
    assert.equal((await rest()).interrupted, 'больше часа боя');
    assert.equal((await finish()).json().interrupted, 'больше часа боя');

    await request('POST', `${base}/rules`, gm.token, {key: 'rest_interruption', kind: 'text', label: 'Что срывает привал', value: 'any'});
    await begin('long');
    await fight();
    assert.equal((await rest()).interrupted, 'бой', 'the stricter table rule');
    await finish();
  });

  await t.test('«interrupt» drops the rest; no rest in the middle of a fight', async () => {
    await begin('short');
    assert.equal((await request('POST', `${scenePath}/rest/cancel`, gm.token, {})).statusCode, 204);
    assert.equal(await rest(), null);
    assert.equal((await finish()).statusCode, 400, 'nothing to finish');
    await request('POST', `${scenePath}/initiative/start`, gm.token, {});
    const refused = await begin('long');
    assert.equal(refused.statusCode, 400);
    assert.match(refused.json().message, /Идёт бой/);
  });
});
