import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('doors, locks and traps', async t => {
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

  const gm = await register('gm_door'), alice = await register('alice_door'), bob = await register('bob_door');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Doors'})).json().id;
  for (const member of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Склеп'})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const characters = `/campaigns/${campaignId}/characters`;
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);

  const thief = (await request('POST', characters, alice.token, {kind: 'character', name: 'Воровка', level: 5, dexterity: 18, wisdom: 14, strength: 10})).json();
  const brute = (await request('POST', characters, bob.token, {kind: 'character', name: 'Громила', strength: 18})).json();
  await db.query(`INSERT INTO character_skills(campaign_id, character_id, skill_index, proficient) VALUES($1,$2,'sleight-of-hand',true)`, [campaignId, thief.id]);
  const door = (await request('POST', characters, gm.token, {kind: 'object', name: 'Дверь'})).json();
  const vault = (await request('POST', characters, gm.token, {kind: 'object', name: 'Тайник'})).json();
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: door.id, x: 0.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: vault.id, x: 2.5, z: 2.5, hidden: true});

  const setState = (token: string, body: any) => request('PUT', `${characters}/${door.id}/state`, token, body);
  const act = (token: string, action: string, actorId?: string, id = door.id) =>
    request('POST', `${characters}/${id}/interact`, token, {action, ...(actorId ? {actorId} : {})});
  const doorSeenBy = async (token: string) =>
    (await request('GET', scenePath, token)).json().objects.find((o: any) => o.character_id === door.id).state;

  await t.test('only the GM (or whoever controls the object) sets its states', async () => {
    assert.equal((await setState(alice.token, {openable: true})).statusCode, 403);
    assert.equal((await request('PUT', `${characters}/${thief.id}/state`, alice.token, {openable: true})).statusCode, 400, 'not for creatures');
    const saved = await setState(gm.token, {
      openable: true, locked: true, lockDc: 40, breakDc: 40,
      trapArmed: true, trapDetectDc: 1, trapDisarmDc: 40, trapNote: 'Отравленная игла: 1d4 урона ядом.',
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().state.lockDc, 40);
  });

  await t.test('players see the door is shut — not that it is locked, nor the trap', async () => {
    assert.deepEqual(await doorSeenBy(alice.token), {full: false, openable: true, open: false, locked: null, broken: false, blocks: false, blockKind: 'both', light: null, trap: null});
    const gmView = await doorSeenBy(gm.token);
    assert.equal(gmView.full, true);
    assert.equal(gmView.trap.disarmDc, 40);
  });

  await t.test('trying the door reveals the lock; picking it rolls the thief’s check, DC stays secret', async () => {
    const tried = await act(alice.token, 'open');
    assert.equal(tried.json().outcome, 'locked');
    assert.equal((await doorSeenBy(bob.token)).locked, true, 'now everyone knows it is locked');

    assert.equal((await act(alice.token, 'pick')).statusCode, 400, 'who is picking?');
    assert.equal((await act(alice.token, 'pick', brute.id)).statusCode, 403, 'not someone else’s character');

    const failed = (await act(alice.token, 'pick', thief.id)).json();
    assert.equal(failed.outcome, 'failure');
    assert.equal(failed.roll.label, 'Взлом замка: Дверь — Воровка');
    assert.equal(failed.roll.modifier, 7, 'DEX +4 and proficiency +3 in Sleight of Hand');
    assert.equal(failed.state.lockDc, undefined, 'the DC is never sent to a player');

    await setState(gm.token, {lockDc: 1});
    const picked = (await act(alice.token, 'pick', thief.id)).json();
    assert.equal(picked.outcome, 'success');
    assert.equal(picked.state.locked, false);
  });

  await t.test('searching finds the trap; a failed disarm by 5+ springs it', async () => {
    const found = (await act(bob.token, 'search', brute.id)).json();
    assert.equal(found.outcome, 'found');
    assert.deepEqual((await doorSeenBy(alice.token)).trap, {armed: true, detected: true});

    const sprung = (await act(alice.token, 'disarm', thief.id)).json();
    assert.equal(sprung.outcome, 'trap');
    assert.match(sprung.message, /Отравленная игла/);
    assert.equal((await doorSeenBy(gm.token)).trap.armed, false, 'a sprung trap is spent');
    assert.equal((await act(alice.token, 'disarm', thief.id)).statusCode, 400, 'nothing left to disarm');

    const nothing = (await act(alice.token, 'search', thief.id)).json();
    assert.equal(nothing.outcome, 'nothing');
  });

  await t.test('open, close, and forcing a door breaks it for good', async () => {
    assert.equal((await act(bob.token, 'open')).json().outcome, 'opened');
    assert.equal((await doorSeenBy(alice.token)).open, true);
    assert.equal((await act(bob.token, 'close')).json().outcome, 'closed');

    await setState(gm.token, {locked: true, breakDc: 1});
    const forced = (await act(bob.token, 'force', brute.id)).json();
    assert.equal(forced.outcome, 'success');
    assert.equal(forced.roll.label, 'Выбить: Дверь — Громила');
    assert.deepEqual([forced.state.broken, forced.state.open, forced.state.locked], [true, true, false]);
    assert.equal((await act(bob.token, 'close')).statusCode, 400, 'a broken door does not close');
  });

  await t.test('players cannot touch what they cannot see', async () => {
    assert.equal((await act(alice.token, 'search', thief.id, vault.id)).statusCode, 404);
    assert.equal((await act(gm.token, 'search', thief.id, vault.id)).statusCode, 200, 'the GM can');
  });
});
