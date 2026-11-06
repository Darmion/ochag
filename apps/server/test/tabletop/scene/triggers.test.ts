import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('triggers: stepping into a pit, opening a chest', async t => {
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

  const gm = await register('gm_trap'), alice = await register('alice_trap');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Traps'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Коридор', widthCells: 10, heightCells: 1})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const characters = `/campaigns/${campaignId}/characters`;

  const hero = (await request('POST', characters, alice.token, {kind: 'character', name: 'Герой', hpMax: 20})).json();
  const chest = (await request('POST', characters, gm.token, {kind: 'object', name: 'Сундук'})).json();
  const heroPlacement = (await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: -4.5, z: 0})).json().id;
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: chest.id, x: 3.5, z: 0});
  await request('PUT', `${characters}/${chest.id}/state`, gm.token, {openable: true});

  const moveTo = async (x: number) => {
    const current = (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.id === heroPlacement);
    return request('PUT', `${scenePath}/objects/${heroPlacement}`, alice.token, {
      x, y: 0, z: 0, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
    });
  };
  const hp = async () => (await request('GET', `${characters}/${hero.id}`, gm.token)).json().hp_current;
  const triggersPath = `${scenePath}/triggers`;

  const pit = {kind: 'enter', shape: 'square', x: -2, z: 0, direction: 0, sizeFeet: 5, name: 'Яма', message: 'Пол проваливается!',
    checkKind: 'save', checkKey: 'dexterity', dc: 40, damageFormula: '1d1+5', damageType: 'bludgeoning'};

  await t.test('only the GM sees and sets triggers, with valid rules', async () => {
    assert.equal((await request('POST', triggersPath, alice.token, pit)).statusCode, 403);
    assert.equal((await request('POST', triggersPath, gm.token, {...pit, damageFormula: '2d6+@str'})).statusCode, 400);
    assert.equal((await request('POST', triggersPath, gm.token, {...pit, checkKey: 'luck'})).statusCode, 400);
    assert.equal((await request('POST', triggersPath, gm.token, {kind: 'open', objectId: hero.id, name: 'Не тот'})).statusCode, 400, 'an open-trigger hangs on an item');
    const created = await request('POST', triggersPath, gm.token, pit);
    assert.equal(created.statusCode, 201, created.body);
    assert.equal((await request('GET', scenePath, alice.token)).json().triggers.length, 0, 'players do not see traps');
    assert.equal((await request('GET', scenePath, gm.token)).json().triggers.length, 1);
    assert.equal((await request('GET', triggersPath, alice.token)).statusCode, 403);
  });

  await t.test('walking up to the pit is safe; stepping into it springs it once', async () => {
    assert.equal((await moveTo(-2.5)).statusCode, 200);
    assert.equal(await hp(), 20);
    assert.equal((await moveTo(-1.5)).statusCode, 200);
    assert.equal(await hp(), 14, 'failed DC 40 save: 6 damage');
    const rolls = (await request('GET', `/campaigns/${campaignId}/rolls`, alice.token)).json().rolls.map((r: any) => r.label);
    assert.ok(rolls.includes('Спасбросок ЛОВ (СЛ 40), Яма — Герой'));
    assert.ok(rolls.includes('Урон: Яма — Герой'));
    const trap = (await request('GET', triggersPath, gm.token)).json().triggers[0];
    assert.deepEqual([trap.enabled, trap.fired_count], [false, 1]);

    assert.equal((await moveTo(-2.5)).statusCode, 200);
    assert.equal((await moveTo(-1.5)).statusCode, 200);
    assert.equal(await hp(), 14, 'a spent trap does nothing');
  });

  await t.test('a secret, repeating trap halves damage on a save and tells only the GM', async () => {
    const wsAddress = (await app.listen({host: '127.0.0.1', port: 0})).replace('http', 'ws');
    const listen = async (token: string) => {
      const socket = new WebSocket(`${wsAddress}/live`);
      t.after(() => socket.terminate());
      const messages: any[] = [];
      socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
      await new Promise(resolve => socket.once('open', resolve));
      socket.send(JSON.stringify({token, campaignId, sceneId}));
      while (!messages.some(m => m.type === 'ready')) await new Promise(resolve => setTimeout(resolve, 20));
      return messages;
    };
    const gmMessages = await listen(gm.token);
    const aliceMessages = await listen(alice.token);

    await request('POST', triggersPath, gm.token, {...pit, name: 'Иглы', dc: 1, x: 0, once: false, secret: true});
    const before = (await request('GET', `/campaigns/${campaignId}/rolls`, alice.token)).json().rolls.length;
    assert.equal((await moveTo(0.5)).statusCode, 200);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await hp(), 11, 'a passed save: half of 6');
    assert.ok(gmMessages.some(m => m.type === 'notice' && m.title === 'Сработало: Иглы'), 'the GM is told');
    assert.ok(!aliceMessages.some(m => m.type === 'notice' && m.title === 'Сработало: Иглы'), 'the player is not');
    assert.equal((await request('GET', `/campaigns/${campaignId}/rolls`, alice.token)).json().rolls.length, before, 'no rolls left behind');

    assert.equal((await moveTo(-0.5)).statusCode, 200);
    assert.equal((await moveTo(0.5)).statusCode, 200);
    assert.equal(await hp(), 8, 'it fires again');
  });

  await t.test('running through a trap springs it too, not only stopping in it (complaints, item 13)', async () => {
    assert.equal((await moveTo(-0.5)).statusCode, 200, 'stepping out of the needles is safe');
    assert.equal(await hp(), 8);
    assert.equal((await moveTo(2.5)).statusCode, 200);
    assert.equal(await hp(), 5, 'the path −0,5 → 2,5 crosses the needles at 0,5');
    assert.equal((await moveTo(1.5)).statusCode, 200);
    assert.equal(await hp(), 5, 'a path that does not cross it does nothing');
  });

  await t.test('opening the chest rolls the opener’s Perception', async () => {
    const created = await request('POST', triggersPath, gm.token, {kind: 'open', objectId: chest.id, name: 'Шорох', message: 'Внутри что-то шевелится.', checkKind: 'skill', checkKey: 'perception', dc: 1});
    assert.equal(created.statusCode, 201, created.body);
    const opened = await request('POST', `${characters}/${chest.id}/interact`, alice.token, {action: 'open', actorId: hero.id});
    assert.equal(opened.json().outcome, 'opened');
    const rolls = (await request('GET', `/campaigns/${campaignId}/rolls`, alice.token)).json().rolls.map((r: any) => r.label);
    assert.ok(rolls.includes('Проверка: Восприятие (СЛ 1), Шорох — Герой'), rolls.join(' | '));
    const toggled = await request('PATCH', `${triggersPath}/${created.json().id}`, gm.token, {enabled: true, message: 'Снова шорох.'});
    assert.deepEqual([toggled.json().enabled, toggled.json().message], [true, 'Снова шорох.']);
    assert.equal((await request('DELETE', `${triggersPath}/${created.json().id}`, gm.token)).statusCode, 204);
  });
});
