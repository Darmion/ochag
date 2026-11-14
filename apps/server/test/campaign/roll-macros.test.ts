import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('own roll buttons and the new dice modifiers', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({
    method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {}),
  }));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_macros'), alice = await register('alice_macros'), bob = await register('bob_macros');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Macros'})).json().id;
  for (const member of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  const base = `/campaigns/${campaignId}`;
  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Лиса', dexterity: 16})).json();
  const list = async (token = alice.token) => (await request('GET', `${base}/roll-macros`, token)).json().macros;

  await t.test('a player saves a button with a caption, a formula and a hero; only she sees it', async () => {
    const made = await request('POST', `${base}/roll-macros`, alice.token, {label: 'Ловкость', formula: '1к20+@DEX', characterId: hero.id});
    assert.equal(made.statusCode, 201, made.body);
    assert.deepEqual(made.json(), {id: made.json().id, label: 'Ловкость', formula: '1d20+@dex', characterId: hero.id, hidden: false});
    assert.equal((await list()).length, 1);
    assert.deepEqual(await list(bob.token), [], 'Bob has his own list');
    const id = made.json().id;
    assert.equal((await request('PUT', `${base}/roll-macros/${id}`, bob.token, {label: 'Чужая'})).statusCode, 404);
    assert.equal((await request('DELETE', `${base}/roll-macros/${id}`, bob.token)).statusCode, 404);
    const renamed = await request('PUT', `${base}/roll-macros/${id}`, alice.token, {label: 'Ловкость с удачей', formula: '2d20kh1+@dex', characterId: null});
    assert.deepEqual([renamed.json().label, renamed.json().formula, renamed.json().characterId], ['Ловкость с удачей', '2d20kh1+@dex', null]);
  });

  await t.test('a formula the dice cannot read is refused with examples', async () => {
    const bad = await request('POST', `${base}/roll-macros`, alice.token, {label: 'Ошибка', formula: '1d6r<7'});
    assert.equal(bad.statusCode, 400);
    assert.match(bad.json().message, /1d20r1/);
    assert.match((await request('POST', `${base}/roll-macros`, alice.token, {label: 'Удача', formula: '1d20+@luck'})).json().message, /@luck/);
    assert.equal((await request('POST', `${base}/roll-macros`, alice.token, {label: 'Чужой', formula: '1d20', characterId: '00000000-0000-4000-8000-000000000000'})).statusCode, 400);
  });

  await t.test('deleting a button closes the gap; a deleted hero leaves the button without a hero', async () => {
    const second = (await request('POST', `${base}/roll-macros`, alice.token, {label: 'Урон', formula: '1d8+@dex', characterId: hero.id})).json();
    const third = (await request('POST', `${base}/roll-macros`, alice.token, {label: 'Пул', formula: '6d10!cs>=8'})).json();
    assert.deepEqual((await list()).map((macro: any) => macro.label), ['Ловкость с удачей', 'Урон', 'Пул']);
    assert.equal((await request('DELETE', `${base}/roll-macros/${second.id}`, alice.token)).statusCode, 204);
    assert.deepEqual((await list()).map((macro: any) => macro.label), ['Ловкость с удачей', 'Пул']);
    const positions = (await pg.query<any>('SELECT position FROM roll_macros WHERE user_id=$1 ORDER BY position', [alice.user.id])).rows.map(row => row.position);
    assert.deepEqual(positions, [0, 1]);
    const tied = (await request('PUT', `${base}/roll-macros/${third.id}`, alice.token, {characterId: hero.id})).json();
    assert.equal(tied.characterId, hero.id);
    await pg.query('DELETE FROM characters WHERE id=$1', [hero.id]);
    assert.equal((await list()).find((macro: any) => macro.id === third.id).characterId, null);
  });

  await t.test('a roll keeps what was rerolled and how many dice succeeded', async () => {
    const pool = await request('POST', `${base}/rolls`, alice.token, {formula: '8d10!cs>=8cf=1', label: 'Пул'});
    assert.equal(pool.statusCode, 201, pool.body);
    const group = pool.json().breakdown[0];
    assert.equal(group.notation, '8d10!cs>=8cf=1');
    assert.equal(pool.json().total, group.successes - group.failures);
    assert.equal(group.successes, group.kept.filter((value: number) => value >= 8).length);
    const lucky = (await request('POST', `${base}/rolls`, alice.token, {formula: '20d20r1'})).json().breakdown[0];
    assert.ok(Array.isArray(lucky.rerolled ?? []) && (lucky.rerolled ?? []).every((value: number) => value === 1));
  });
});
