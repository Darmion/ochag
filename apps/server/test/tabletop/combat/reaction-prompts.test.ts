import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('reactions that ask: Counterspell and Hellish Rebuke', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000, reactionWindowMs: 1500});
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
  const gm = await register('gm_counter'), alice = await register('alice_counter'), bob = await register('bob_counter');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Counter'})).json().id;
  for (const player of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', player.token, {code});
  }
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Башня', widthCells: 20, heightCells: 10})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const create = async (token: string, body: any) => (await request('POST', `${base}/characters`, token, body)).json();
  const learn = async (token: string, characterId: string, srdIndex: string) => {
    const made = await request('POST', `${base}/characters/${characterId}/spells`, token, {source: 'srd', srdIndex});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const slots = (characterId: string, level: number, count: number) => pg.query(
    `INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT (campaign_id, character_id, level) DO UPDATE SET current=$4, max=$4`,
    [campaignId, characterId, level, count],
  );
  const slotsLeft = async (characterId: string, level: number) =>
    (await pg.query<any>('SELECT current FROM character_spell_slots WHERE character_id=$1 AND level=$2', [characterId, level])).rows[0]?.current as number;
  const hp = async (characterId: string) => (await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [characterId])).rows[0].hp_current as number;

  const wizard = await create(alice.token, {kind: 'character', name: 'Мелвин', intelligence: 16, hpMax: 200, hpCurrent: 200});
  const mage = await create(gm.token, {kind: 'npc', name: 'Маг', disposition: 'hostile', hpMax: 200, hpCurrent: 200});
  await learn(alice.token, wizard.id, 'counterspell');
  const missile = await learn(gm.token, mage.id, 'magic-missile');
  await slots(wizard.id, 3, 3);
  await slots(wizard.id, 5, 1);
  await slots(mage.id, 1, 9);
  await slots(mage.id, 5, 2);
  const wizardAt = (await request('POST', `${scenePath}/objects`, alice.token, {characterId: wizard.id, x: -2.5, z: 0.5})).json().id;
  const mageAt = (await request('POST', `${scenePath}/objects`, gm.token, {characterId: mage.id, x: 2.5, z: 0.5})).json().id;
  const castMissile = async (payload: any = {}) => {
    await pg.query('UPDATE initiative_entries SET is_current=true, action_used=false, bonus_used=false, attacks_made=0, leveled_action_spell=false, bonus_spell=false WHERE character_id=$1', [mage.id]);
    return request('POST', `${base}/characters/${mage.id}/spells/${missile}/cast`, gm.token, {targetIds: [wizard.id], sceneId, ...payload});
  };
  const counter = (windowId: string, token: string, payload: any = {}) =>
    request('POST', `${base}/counterspell/${windowId}`, token, {characterId: wizard.id, ...payload});

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
  const settle = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms));
  const aliceHears = await listen(alice.token);
  const bobHears = await listen(bob.token);

  await t.test('a hostile cast in sight within 60 ft waits for the counterspeller; «interrupt» — the spell fails, both slots spent', async () => {
    const before = await hp(wizard.id);
    const cast = await castMissile();
    assert.equal(cast.statusCode, 202, cast.body);
    const {windowId} = cast.json().pending;
    assert.ok(windowId);
    assert.equal(await hp(wizard.id), before, 'nothing happened yet');
    assert.equal(await slotsLeft(mage.id, 1), 9, 'the slot waits too');
    await settle();
    const asked = aliceHears.find(m => m.type === 'counterspell' && m.windowId === windowId);
    assert.ok(asked, 'the owner of the counterspeller is asked');
    assert.deepEqual([asked.spellLevel, asked.reactors[0].characterId, asked.reactors[0].slots], [1, wizard.id, [3, 5]]);
    assert.equal(bobHears.some(m => m.type === 'counterspell'), false, 'other players are not told who can counter');

    assert.equal((await counter(windowId, bob.token)).statusCode, 403, 'not his character');
    const done = await counter(windowId, alice.token);
    assert.equal(done.statusCode, 200, done.body);
    assert.deepEqual([done.json().countered, done.json().auto, done.json().slotLevel], [true, true, 3]);
    assert.equal(await hp(wizard.id), before, 'the missile never flew');
    assert.equal(await slotsLeft(mage.id, 1), 8, 'the caster’s slot is still spent');
    assert.equal(await slotsLeft(wizard.id, 3), 2);
    assert.equal((await counter(windowId, alice.token)).statusCode, 409, 'the window is closed');
    await settle();
    assert.ok(bobHears.some(m => m.type === 'counterspell-closed' && m.windowId === windowId && m.reason === 'answered'), 'the question is closed for everyone');
    assert.ok(bobHears.some(m => m.type === 'notice' && m.title === '«Волшебная стрела» прервано'), 'everyone learns it was countered');
  });

  await t.test('«skip» and the timeout — the spell goes off as usual', async () => {
    const before = await hp(wizard.id);
    const cast = await castMissile();
    assert.equal(cast.statusCode, 202);
    const declined = await request('POST', `${base}/counterspell/${cast.json().pending.windowId}/decline`, alice.token, {characterId: wizard.id});
    assert.equal(declined.statusCode, 204);
    assert.ok(await hp(wizard.id) < before, 'the missile hit after the refusal');

    const middle = await hp(wizard.id);
    assert.equal((await castMissile()).statusCode, 202);
    await settle(2200);
    assert.ok(await hp(wizard.id) < middle, 'no answer within the window — cast anyway');
  });

  await t.test('a spell above the counter slot needs a check against DC 10 + its level; a slot as high — no check', async () => {
    const before = await hp(wizard.id);
    const cast = await castMissile({slotLevel: 5});
    assert.equal(cast.statusCode, 202);
    const done = await counter(cast.json().pending.windowId, alice.token);
    assert.equal(done.statusCode, 200, done.body);
    const result = done.json();
    assert.equal(result.auto, false);
    assert.equal(result.check.dc, 15);
    assert.equal(result.countered, result.check.total >= 15);
    assert.equal(await hp(wizard.id) < before, !result.countered, 'resisted — the spell goes off');
    const logged = (await pg.query<any>(`SELECT outcome FROM roll_log WHERE character_id=$1 AND label LIKE 'Контрзаклинание%' ORDER BY created_at DESC LIMIT 1`, [wizard.id])).rows[0];
    assert.equal(logged.outcome.dc, 15);

    const again = await castMissile({slotLevel: 5});
    assert.equal(again.statusCode, 202);
    const high = await counter(again.json().pending.windowId, alice.token, {slotLevel: 5});
    assert.deepEqual([high.json().countered, high.json().auto], [true, true]);
  });

  await t.test('no window: an ally casting, a wall between, no slot 3+, the reaction spent in combat; the cast fails before asking', async () => {
    await pg.query(`UPDATE characters SET disposition='friendly' WHERE id=$1`, [mage.id]);
    assert.equal((await castMissile()).statusCode, 201, 'an ally');
    await pg.query(`UPDATE characters SET disposition='hostile' WHERE id=$1`, [mage.id]);
    const wall = (await request('POST', `${scenePath}/walls`, gm.token, {x1: 0, z1: -5, x2: 0, z2: 5})).json();
    const blind = await castMissile();
    assert.equal(blind.statusCode, 400);
    assert.match(blind.json().message, /не видит/);
    await request('DELETE', `${scenePath}/walls/${wall.id}`, gm.token);
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code) VALUES ($1,$2,'invisible')`, [campaignId, mage.id]);
    assert.equal((await castMissile()).statusCode, 201, 'the wizard cannot see the casting');
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code='invisible'`, [mage.id]);
    await pg.query('UPDATE scene_objects SET x=-5.5 WHERE id=$1', [wizardAt]);
    await pg.query('UPDATE scene_objects SET x=9.5 WHERE id=$1', [mageAt]);
    assert.equal((await castMissile()).statusCode, 201, 'too far to see the casting');
    await pg.query('UPDATE scene_objects SET x=-2.5 WHERE id=$1', [wizardAt]);
    await pg.query('UPDATE scene_objects SET x=2.5 WHERE id=$1', [mageAt]);
    await pg.query('UPDATE character_spell_slots SET current=0 WHERE character_id=$1', [wizard.id]);
    assert.equal((await castMissile()).statusCode, 201, 'no slot to counter with');
    await slots(wizard.id, 3, 3);
    const initiative = `${scenePath}/initiative`;
    const entry = (await request('POST', `${initiative}/join`, alice.token, {characterId: wizard.id})).json().id;
    await request('POST', `${initiative}/join`, gm.token, {characterId: mage.id});
    await pg.query('UPDATE initiative_entries SET reaction_used=true WHERE id=$1', [entry]);
    assert.equal((await castMissile()).statusCode, 201, 'the reaction is gone this round');
    await pg.query('UPDATE initiative_entries SET reaction_used=false WHERE id=$1', [entry]);
    await pg.query('UPDATE character_spell_slots SET current=0 WHERE character_id=$1 AND level=1', [mage.id]);
    const failed = await castMissile();
    assert.equal(failed.statusCode, 400);
    assert.match(failed.json().message, /Нет свободных ячеек 1 уровня/);
    await slots(mage.id, 1, 9);
  });

  await t.test('in combat the counter spends the reaction', async () => {
    const cast = await castMissile();
    assert.equal(cast.statusCode, 202);
    assert.equal((await counter(cast.json().pending.windowId, alice.token)).json().countered, true);
    const used = (await pg.query<any>('SELECT reaction_used FROM initiative_entries WHERE character_id=$1', [wizard.id])).rows[0].reaction_used;
    assert.equal(used, true);
    assert.equal((await castMissile()).statusCode, 201, 'one reaction per round');
    await request('DELETE', `${scenePath}/initiative`, gm.token);
  });

  await t.test('Hellish Rebuke: the wounded one is asked; the answer is an ordinary reaction cast at the attacker', async () => {
    const tiefling = await create(alice.token, {kind: 'character', name: 'Тифлинг', hpMax: 100, hpCurrent: 100});
    const rebuke = await learn(alice.token, tiefling.id, 'hellish-rebuke');
    await slots(tiefling.id, 1, 2);
    await request('POST', `${scenePath}/objects`, alice.token, {characterId: tiefling.id, x: -1.5, z: 2.5});
    const club = (await request('POST', `${base}/characters/${mage.id}/weapons`, gm.token, {name: 'Посох', ability: 'strength', proficient: false, damageFormula: '1d4+5', rangeFeet: 60})).json();
    let offer: any = null;
    for (let i = 0; i < 40 && !offer; i += 1) {
      const strike = await request('POST', `${base}/rolls/check`, gm.token, {characterId: mage.id, kind: 'attack', key: club.id, targetCharacterId: tiefling.id, sceneId});
      assert.equal(strike.statusCode, 201, strike.body);
      if (!strike.json().damage) continue;
      await settle();
      offer = aliceHears.find(m => m.type === 'reaction-offer' && m.reactorId === tiefling.id);
    }
    assert.ok(offer, 'a hit offers the rebuke');
    assert.deepEqual([offer.kind, offer.triggerId, offer.spellEntryId, offer.slots], ['hellish-rebuke', mage.id, rebuke, [1]]);
    assert.equal(bobHears.some(m => m.type === 'reaction-offer'), false);

    const mageHp = await hp(mage.id);
    const answered = await request('POST', `${base}/characters/${tiefling.id}/spells/${rebuke}/cast`, alice.token, {targetIds: [mage.id], sceneId});
    assert.equal(answered.statusCode, 201, answered.body);
    const target = answered.json().targets[0];
    assert.equal(target.save !== undefined, true, 'the attacker saves (DEX)');
    assert.equal(await hp(mage.id), mageHp - target.damage);
    assert.equal(await slotsLeft(tiefling.id, 1), 1);

    await pg.query('UPDATE character_spell_slots SET current=0 WHERE character_id=$1', [tiefling.id]);
    aliceHears.length = 0;
    for (let i = 0; i < 10; i += 1) {
      await request('POST', `${base}/rolls/check`, gm.token, {characterId: mage.id, kind: 'attack', key: club.id, targetCharacterId: tiefling.id, sceneId});
    }
    await settle();
    assert.equal(aliceHears.some(m => m.type === 'reaction-offer'), false, 'no slot — no question');
  });
});
