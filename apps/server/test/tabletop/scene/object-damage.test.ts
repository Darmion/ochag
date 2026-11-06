import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('damage to objects: threshold and immunities', async t => {
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
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_dmg', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Damage'})).json().id;
  const characters = `/campaigns/${campaignId}/characters`;

  const gate = (await request('POST', characters, gm.token, {kind: 'object', name: 'Ворота', hpMax: 18, armorClass: 19})).json();
  const chest = (await request('POST', characters, gm.token, {kind: 'object', name: 'Сундук', hpMax: 10})).json();
  const ghoul = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Гуль', disposition: 'hostile', hpMax: 22})).json();

  const hit = async (targetId: string, formula: string, extra: Record<string, unknown> = {}) => {
    const roll = (await request('POST', `/campaigns/${campaignId}/rolls`, gm.token, {formula})).json();
    return request('POST', `/campaigns/${campaignId}/rolls/${roll.id}/apply`, gm.token, {characterId: targetId, mode: 'damage', ...extra});
  };

  await t.test('the GM sets a damage threshold on the sheet', async () => {
    const patched = await request('PATCH', `${characters}/${gate.id}`, gm.token, {revision: gate.revision, damageThreshold: 10});
    assert.equal(patched.statusCode, 200, patched.body);
    assert.equal(patched.json().damage_threshold, 10);
    assert.equal((await request('PATCH', `${characters}/${gate.id}`, gm.token, {revision: patched.json().revision, damageThreshold: -1})).statusCode, 400);
  });

  await t.test('damage below the threshold does nothing; at or above it goes through whole', async () => {
    const weak = await hit(gate.id, '1d1+4');
    assert.deepEqual([weak.json().applied, weak.json().blocked, weak.json().hp_current], [0, 'threshold', 18]);
    const strong = await hit(gate.id, '1d1+11');
    assert.deepEqual([strong.json().applied, strong.json().blocked, strong.json().hp_current], [12, null, 6]);
  });

  await t.test('objects are immune to poison and psychic damage, creatures are not', async () => {
    const poison = await hit(chest.id, '1d1+4', {damageType: 'poison'});
    assert.deepEqual([poison.json().applied, poison.json().blocked, poison.json().hp_current], [0, 'immune', 10]);
    const psychic = await hit(chest.id, '1d1+4', {damageType: 'psychic'});
    assert.equal(psychic.json().blocked, 'immune');
    const fire = await hit(chest.id, '1d1+4', {damageType: 'fire'});
    assert.deepEqual([fire.json().applied, fire.json().hp_current], [5, 5]);

    const poisoned = await hit(ghoul.id, '1d1+4', {damageType: 'poison'});
    assert.deepEqual([poisoned.json().applied, poisoned.json().blocked], [5, null]);
  });

  await t.test('a damage type only goes with damage', async () => {
    const roll = (await request('POST', `/campaigns/${campaignId}/rolls`, gm.token, {formula: '1d1'})).json();
    const heal = await request('POST', `/campaigns/${campaignId}/rolls/${roll.id}/apply`, gm.token, {characterId: ghoul.id, mode: 'heal', damageType: 'fire'});
    assert.equal(heal.statusCode, 400);
    assert.equal((await hit(chest.id, '1d1', {damageType: 'banana'})).statusCode, 400);
  });

  await t.test('applying the same roll to the same target twice is rejected; a different target is not', async () => {
    const victim = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Жертва', disposition: 'hostile', hpMax: 20})).json();
    const bystander = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Прохожий', disposition: 'hostile', hpMax: 20})).json();
    const roll = (await request('POST', `/campaigns/${campaignId}/rolls`, gm.token, {formula: '1d1+5'})).json();

    const first = await request('POST', `/campaigns/${campaignId}/rolls/${roll.id}/apply`, gm.token, {characterId: victim.id, mode: 'damage'});
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().hp_current, 14);

    const repeat = await request('POST', `/campaigns/${campaignId}/rolls/${roll.id}/apply`, gm.token, {characterId: victim.id, mode: 'damage'});
    assert.equal(repeat.statusCode, 409, repeat.body);

    assert.equal((await request('GET', `${characters}/${victim.id}`, gm.token)).json().hp_current, 14);

    const second = await request('POST', `/campaigns/${campaignId}/rolls/${roll.id}/apply`, gm.token, {characterId: bystander.id, mode: 'damage'});
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().hp_current, 14);

    const rolls = (await request('GET', `/campaigns/${campaignId}/rolls`, gm.token)).json().rolls;
    const logged = rolls.find((r: any) => r.id === roll.id);
    assert.deepEqual([...logged.applied_to].sort(), [bystander.id, victim.id].sort());
  });
});
