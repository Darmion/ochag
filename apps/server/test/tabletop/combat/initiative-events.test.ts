import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('lair actions: an initiative event on count 20 that loses ties, picked by the GM or by the auto-turn', async t => {
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

  const gm = await register('gm_lair'), alice = await register('alice_lair');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Lair'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Пещера', widthCells: 12, heightCells: 12})).json().id;
  const initiative = `${base}/scenes/${sceneId}/initiative`;

  const dragon = (await request('POST', `${base}/bestiary/spawn`, gm.token, {monsters: [{index: 'young-red-dragon', count: 1}], sceneId, x: 2.5, z: 2.5})).json().characters[0];
  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Лира', hpMax: 40, hpCurrent: 40, armorClass: 14, speedFeet: 30, level: 3})).json();
  await request('POST', `${base}/scenes/${sceneId}/objects`, alice.token, {characterId: hero.id, x: -3.5, z: -3.5});
  const boss = `${base}/characters/${dragon.id}/boss`;
  const lair = {
    active: true,
    options: [
      {name: 'Магма', text: 'Из пола бьёт магма.'},
      {name: 'Толчок', text: 'Пещеру трясёт.'},
      {name: 'Дым', text: 'Пещеру затягивает дымом.'},
    ],
  };
  const settings = (body: any) => request('PUT', boss, gm.token, {legendaryActions: 0, options: [], phases: [], ...body});
  const queue = async (token = gm.token) => (await request('GET', initiative, token)).json();

  await t.test('the lair is set in the boss window; D&D 5e numbers come by default; bad settings are refused', async () => {
    assert.equal((await settings({lair: {active: true, options: []}})).statusCode, 400);
    assert.equal((await settings({lair: {active: true, options: [{name: 'Магма'}]}})).statusCode, 400, 'no repeat needs a second option');
    const saved = await settings({lair});
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json().lair.rules, {score: 20, tieRank: 1, noRepeat: true});
    assert.equal((await request('GET', boss, gm.token)).json().lair.options.length, 3);
    assert.equal((await request('PUT', boss, alice.token, {legendaryActions: 0, options: [], phases: [], lair})).statusCode, 403);
  });

  let lairEntry = '';

  await t.test('combat starts: the lair takes its slot on 20 and yields to a creature on 20', async () => {
    assert.equal((await request('POST', `${initiative}/start`, gm.token, {})).statusCode, 201);
    const heroEntry = (await queue()).entries.find((e: any) => e.character_id === hero.id);
    const dragonEntry = (await queue()).entries.find((e: any) => e.character_id === dragon.id);
    await request('PATCH', `${initiative}/${heroEntry.id}`, gm.token, {score: 20});
    await request('PATCH', `${initiative}/${dragonEntry.id}`, gm.token, {score: 5});
    const {entries} = await queue();
    assert.deepEqual(entries.map((e: any) => e.name), ['Лира', 'Логово: Молодой красный дракон', 'Молодой красный дракон']);
    const slot = entries[1];
    lairEntry = slot.id;
    assert.deepEqual([slot.score, slot.event_kind, slot.event_of, slot.character_id], [20, 'lair', dragon.id, null]);
    assert.deepEqual(slot.event.free, [0, 1, 2]);
    const seen = (await queue(alice.token)).entries.find((e: any) => e.id === lairEntry);
    assert.equal(seen.event, undefined, 'players do not see the lair options');
  });

  await t.test('on its slot the GM picks an action; the same one waits a round; players cannot pick', async () => {
    while (!(await queue()).entries.find((e: any) => e.id === lairEntry).is_current) {
      assert.equal((await request('POST', `${initiative}/advance`, gm.token, {})).statusCode, 204);
    }
    assert.equal((await request('POST', `${initiative}/${lairEntry}/event`, alice.token, {option: 0})).statusCode, 403);
    const used = await request('POST', `${initiative}/${lairEntry}/event`, gm.token, {option: 1});
    assert.equal(used.statusCode, 200, used.body);
    assert.equal(used.json().option.name, 'Толчок');
    const chat = (await pg.query<any>(`SELECT body FROM chat_messages WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 1`, [campaignId])).rows[0];
    assert.equal(chat.body, 'Логово «Молодой красный дракон»: Толчок — Пещеру трясёт.');
    const slot = (await queue()).entries.find((e: any) => e.id === lairEntry);
    assert.deepEqual([slot.event_last, slot.event.free], ['Толчок', [0, 2]]);
    assert.equal((await request('POST', `${initiative}/${lairEntry}/event`, gm.token, {option: 1})).statusCode, 400, 'not twice in a row');
  });

  await t.test('the auto-turn takes a free action on the lair slot and passes the turn', async () => {
    for (let round = 0; round < 3; round += 1) {
      do {
        assert.equal((await request('POST', `${initiative}/advance`, gm.token, {})).statusCode, 204);
      } while (!(await queue()).entries.find((e: any) => e.id === lairEntry).is_current);
      const before = (await queue()).entries.find((e: any) => e.id === lairEntry).event_last;
      const auto = await request('POST', `${initiative}/auto`, gm.token, {pace: 'fast'});
      assert.equal(auto.statusCode, 200, auto.body);
      const result = auto.json();
      assert.ok(result.event?.name && result.event.name !== before, `${before} → ${result.event?.name}`);
      assert.equal(result.advanced, true);
      assert.equal((await queue()).entries.find((e: any) => e.id === lairEntry).is_current, false);
    }
  });

  await t.test('a fallen owner keeps the lair silent; switching the lair off or removing the owner clears the slot', async () => {
    await pg.query('UPDATE characters SET hp_current=0 WHERE id=$1', [dragon.id]);
    do {
      await request('POST', `${initiative}/advance`, gm.token, {});
    } while (!(await queue()).entries.find((e: any) => e.id === lairEntry).is_current);
    const silent = await request('POST', `${initiative}/${lairEntry}/event`, gm.token, {option: 0});
    assert.equal(silent.statusCode, 400);
    assert.match(silent.json().message ?? silent.body, /молчит/);
    await pg.query('UPDATE characters SET hp_current=hp_max WHERE id=$1', [dragon.id]);
    await request('POST', `${initiative}/advance`, gm.token, {});

    assert.equal((await settings({lair: {...lair, active: false}})).statusCode, 200);
    assert.equal((await queue()).entries.some((e: any) => e.event_kind), false);
    await settings({lair});
    const slot = (await queue()).entries.find((e: any) => e.event_kind === 'lair');
    assert.ok(slot, 'back in the order');
    const dragonEntry = (await queue()).entries.find((e: any) => e.character_id === dragon.id);
    assert.equal((await request('DELETE', `${initiative}/${dragonEntry.id}`, gm.token)).statusCode, 204);
    assert.equal((await queue()).entries.some((e: any) => e.event_kind), false);
  });

  await t.test('a copy of the boss keeps its lair', async () => {
    const copy = (await request('POST', `${base}/characters/${dragon.id}/duplicate`, gm.token, {count: 1})).json().characters[0];
    const row = (await pg.query<any>(`SELECT turn_events FROM characters WHERE id=$1`, [copy.id])).rows[0];
    assert.deepEqual(row.turn_events.map((e: any) => [e.kind, e.active, e.options.length]), [['lair', true, 3]]);
  });
});
