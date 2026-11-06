import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('mass revive: the dead and the dying stand up with the chosen hit points; the living are skipped', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 100_000});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({
    method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {}),
  }));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();
  const gm = await register('gm_revive'), alice = await register('alice_revive');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Revive'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const create = async (token: string, body: any) => (await request('POST', `${base}/characters`, token, body)).json();
  const hero = await create(alice.token, {kind: 'character', name: 'Герой', hpMax: 20, hpCurrent: 20});
  const goblin = await create(gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 7, hpCurrent: 7});
  const ogre = await create(gm.token, {kind: 'npc', name: 'Огр', disposition: 'hostile', hpMax: 59, hpCurrent: 59});
  const chest = await create(gm.token, {kind: 'object', name: 'Сундук'});
  const hit = async (id: string, amount: number) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: `1d1+${amount - 1}`, label: 'Удар'})).json();
    return request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId: id, mode: 'damage'});
  };
  const sheet = async (id: string) => (await request('GET', `${base}/characters/${id}`, gm.token)).json();
  const codes = async (id: string) => ((await sheet(id)).effects ?? []).map((effect: any) => effect.effect_code).sort();

  await hit(hero.id, 20);
  await pg.query('UPDATE characters SET death_failures=2, death_successes=1 WHERE id=$1', [hero.id]);
  await hit(goblin.id, 7);
  await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [hero.id], code: 'exhaustion', level: 2});
  await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [hero.id], code: 'poisoned'});
  assert.ok((await codes(hero.id)).includes('unconscious'));
  assert.ok((await codes(goblin.id)).includes('dead'));

  const ids = [hero.id, goblin.id, ogre.id, chest.id];
  assert.equal((await request('POST', `${base}/characters/revive`, alice.token, {characterIds: ids, hp: 'full'})).statusCode, 403);
  assert.equal((await request('POST', `${base}/characters/revive`, gm.token, {characterIds: ids, hp: 'most'})).statusCode, 400);

  const half = await request('POST', `${base}/characters/revive`, gm.token, {characterIds: ids, hp: 'half'});
  assert.equal(half.statusCode, 200);
  const result = half.json();
  assert.deepEqual(result.revived.map((entry: any) => [entry.name, entry.hp]).sort(), [['Герой', 10], ['Гоблин', 4]]);
  assert.deepEqual(result.skipped.map((entry: any) => [entry.name, entry.reason]).sort(), [['Огр', 'жив'], ['Сундук', 'предмет']]);
  const heroNow = await sheet(hero.id);
  assert.equal(heroNow.hp_current, 10);
  assert.equal(heroNow.death_successes, 0);
  assert.equal(heroNow.death_failures, 0);
  assert.deepEqual(await codes(hero.id), ['exhaustion_2', 'poisoned', 'prone']);
  assert.deepEqual(await codes(goblin.id), []);
  assert.equal((await sheet(goblin.id)).hp_current, 4);

  await hit(hero.id, 10);
  const one = (await request('POST', `${base}/characters/revive`, gm.token, {characterIds: [hero.id], hp: 'one', clearExhaustion: true, clearConditions: true})).json();
  assert.deepEqual(one.revived, [{id: hero.id, name: 'Герой', hp: 1}]);
  assert.deepEqual(await codes(hero.id), []);
  await hit(goblin.id, 4);
  const full = (await request('POST', `${base}/characters/revive`, gm.token, {characterIds: [goblin.id], hp: 'full'})).json();
  assert.equal(full.revived[0].hp, 7);
});
