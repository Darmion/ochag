import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('encounter difficulty for this party', async t => {
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

  const gm = await register('gm_difficulty'), alice = await register('alice_difficulty');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Difficulty'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Лес', widthCells: 10, heightCells: 10})).json().id;
  const difficulty = (body: any, token = gm.token) => request('POST', `${base}/difficulty`, token, body);

  const liena = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Лиэна', level: 3})).json();
  const bran = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Бран', level: 3})).json();
  const sage = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Мудрец'})).json();
  await pg.query('UPDATE characters SET experience=6500 WHERE id=$1', [sage.id]);
  await request('POST', `${base}/scenes/${sceneId}/objects`, alice.token, {characterId: liena.id, x: -4.5, z: -4.5});
  await request('POST', `${base}/scenes/${sceneId}/objects`, alice.token, {characterId: bran.id, x: -3.5, z: -4.5});

  await t.test('only whoever builds encounters sees the difficulty', async () => {
    assert.equal((await difficulty({sceneId}, alice.token)).statusCode, 403);
    assert.equal((await difficulty({})).statusCode, 400);
    assert.equal((await difficulty({monsters: [{index: 'tarrasque', count: 1}]})).statusCode, 400);
  });

  await t.test('a bestiary pick against the heroes on the scene: an owlbear is deadly for two', async () => {
    const result = (await difficulty({sceneId, monsters: [{index: 'owlbear', count: 1}]})).json();
    assert.deepEqual(result.party.map((hero: any) => [hero.name, hero.level]).sort(), [['Бран', 3], ['Лиэна', 3]]);
    assert.deepEqual(result.thresholds, {easy: 150, medium: 300, hard: 450, deadly: 800});
    assert.deepEqual([result.experience, result.multiplier, result.adjusted, result.rating, result.label], [700, 1.5, 1050, 'deadly', 'смертельная']);
  });

  await t.test('without a scene the whole party counts, levels from experience', async () => {
    const result = (await difficulty({monsters: [{index: 'goblin', count: 4}]})).json();
    assert.deepEqual(result.party.map((hero: any) => hero.level).sort(), [3, 3, 5]);
    assert.deepEqual([result.experience, result.multiplier, result.adjusted, result.rating], [200, 2, 400, 'easy']);
  });

  await t.test('the hostile creatures standing on the scene, not the fallen nor the friendly', async () => {
    await request('POST', `${base}/bestiary/spawn`, gm.token, {monsters: [{index: 'goblin', count: 3}], sceneId, x: 3.5, z: 3.5});
    await request('POST', `${base}/bestiary/spawn`, gm.token, {monsters: [{index: 'commoner', count: 1}], disposition: 'friendly', sceneId, x: 0.5, z: 0.5});
    await pg.query(`UPDATE characters SET hp_current=0 WHERE campaign_id=$1 AND name='Гоблин 3'`, [campaignId]);
    const result = (await difficulty({sceneId})).json();
    assert.deepEqual(result.foes.map((foe: any) => foe.name).sort(), ['Гоблин 1', 'Гоблин 2']);
    assert.deepEqual([result.experience, result.multiplier, result.adjusted, result.rating], [100, 2, 200, 'easy']);
  });

  await t.test('a saved encounter is judged before it is deployed', async () => {
    const saved = (await request('POST', `${base}/encounters/bestiary`, gm.token, {name: 'Стая', monsters: [{index: 'wolf', count: 3}]})).json();
    const result = (await difficulty({sceneId, encounterId: saved.id})).json();
    assert.equal(result.monsters, 3);
    assert.deepEqual([result.experience, result.multiplier, result.adjusted, result.rating], [150, 2.5, 375, 'medium']);
    assert.equal((await difficulty({encounterId: '00000000-0000-4000-8000-000000000000'})).statusCode, 404);
  });
});
