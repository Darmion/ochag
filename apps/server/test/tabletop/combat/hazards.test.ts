import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('hazardous surroundings', async t => {
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

  const gm = await register('gm_hazard'), alice = await register('alice_hazard');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Hazards'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Склад', widthCells: 10, heightCells: 1})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const characters = `${base}/characters`;
  const hero = (await request('POST', characters, alice.token, {kind: 'character', name: 'Герой', hpMax: 20})).json();
  const barrelA = (await request('POST', characters, gm.token, {kind: 'object', name: 'Бочка с маслом', hpMax: 5})).json();
  const barrelB = (await request('POST', characters, gm.token, {kind: 'object', name: 'Вторая бочка', hpMax: 5})).json();
  const crate = (await request('POST', characters, gm.token, {kind: 'object', name: 'Ящик', hpMax: 5})).json();
  for (const [id, x, token] of [[hero.id, -4.5, alice.token], [barrelA.id, -2.5, gm.token], [barrelB.id, -0.5, gm.token], [crate.id, 3.5, gm.token]] as const) {
    await request('POST', `${scenePath}/objects`, token, {characterId: id, x, z: 0});
  }
  const oil = {types: ['fire'], radiusFeet: 10, formula: '1d1+5', damageType: 'fire', save: 'dexterity', dc: 40, halfOnSuccess: true, message: 'Масло вспыхивает!'};
  const hp = async (id: string) => (await request('GET', `${characters}/${id}`, gm.token)).json().hp_current;
  const damage = async (targetId: string, damageType: string) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: '1d1+2'})).json();
    return request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId: targetId, mode: 'damage', damageType});
  };

  await t.test('only whoever controls the item sets its hazard; players do not see it', async () => {
    assert.equal((await request('PUT', `${characters}/${barrelA.id}/state`, alice.token, {hazard: oil})).statusCode, 403);
    assert.equal((await request('PUT', `${characters}/${barrelA.id}/state`, gm.token, {hazard: {...oil, radiusFeet: 0}})).statusCode, 400);
    assert.equal((await request('PUT', `${characters}/${barrelA.id}/state`, gm.token, {hazard: oil})).statusCode, 200);
    assert.equal((await request('PUT', `${characters}/${barrelB.id}/state`, gm.token, {hazard: oil})).statusCode, 200);
    const seen = (await request('GET', scenePath, alice.token)).json().objects.find((o: any) => o.character_id === barrelA.id);
    assert.equal(seen.state.hazard, undefined);
  });

  await t.test('cold does nothing; fire blows the barrel up and the next barrel with it', async () => {
    assert.equal((await damage(barrelA.id, 'cold')).statusCode, 200);
    assert.equal(await hp(hero.id), 20);
    const fire = await damage(barrelA.id, 'fire');
    assert.equal(fire.statusCode, 200, fire.body);
    assert.equal(await hp(hero.id), 14, 'a failed DC 40 save: the full 6 from the first barrel; the second is 20 ft away');
    const states = (await request('GET', scenePath, gm.token)).json().objects;
    const stateOf = (id: string) => states.find((o: any) => o.character_id === id).state;
    assert.deepEqual([stateOf(barrelA.id).broken, stateOf(barrelA.id).hazard], [true, null]);
    assert.deepEqual([stateOf(barrelB.id).broken, stateOf(barrelB.id).hazard], [true, null], 'the chain went on');
    const rolls = (await request('GET', `${base}/rolls`, alice.token)).json().rolls.map((r: any) => r.label);
    assert.ok(rolls.includes('Взрыв: Бочка с маслом') && rolls.includes('Взрыв: Вторая бочка'), rolls.join(' | '));
    assert.equal((await damage(barrelA.id, 'fire')).statusCode, 200);
    assert.equal(await hp(hero.id), 14, 'once only');
  });

  await t.test('burning ground: the area hits whoever starts a turn in it', async () => {
    const fire = await request('POST', `${scenePath}/triggers`, gm.token, {
      kind: 'enter', shape: 'circle', x: -5, z: 0.5, direction: 0, sizeFeet: 5, name: 'Горящее масло',
      damageFormula: '1d1+1', damageType: 'fire', once: false, onTurn: true,
    });
    assert.equal(fire.statusCode, 201, fire.body);
    assert.equal(fire.json().on_turn, true);
    const initiative = `${scenePath}/initiative`;
    const entry = (await request('POST', `${initiative}/join`, alice.token, {characterId: hero.id})).json().id;
    await request('PATCH', `${initiative}/${entry}`, gm.token, {score: 10});
    await request('POST', `${initiative}/advance`, gm.token);
    assert.equal(await hp(hero.id), 12, 'starts the turn in the flames: 2 fire damage');
    await request('POST', `${initiative}/advance`, gm.token);
    assert.equal(await hp(hero.id), 10, 'and again next round');
  });
});
