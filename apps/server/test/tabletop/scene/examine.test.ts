import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../../src/app.ts';
import { createTestDatabase } from '../../helpers.ts';

test('examine: the GM sets the skill and the DCs, a hero looks once and learns what the roll reaches', async t => {
  const { pg, db } = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, { rateMax: 1_000_000 });
  t.after(() => app.close());

  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({
    method, url,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    ...(payload !== undefined ? { payload } : {}),
  }));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, { username, password: 'x' })).json();
  const gm = await register('gm_examine'), alice = await register('alice_examine');
  const campaignId = (await request('POST', '/campaigns', gm.token, { name: 'Examine' })).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, { code });
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, { name: 'Зал', widthCells: 8, heightCells: 8 })).json().id;
  const create = async (token: string, body: any) => (await request('POST', `${base}/characters`, token, body)).json();
  const place = (token: string, characterId: string, x: number) => request('POST', `${base}/scenes/${sceneId}/objects`, token, { characterId, x, z: 0.5 });
  // Intelligence 18 never rolls below 5 on Investigation, and never reaches 30.
  const sage = await create(alice.token, { kind: 'character', name: 'Мудрец', intelligence: 18 });
  const ogre = await create(gm.token, { kind: 'npc', name: 'Огр', armorClass: 11, hpMax: 59, hpCurrent: 59, strength: 19 });
  await pg.query(`UPDATE characters SET damage_resistances='["fire"]'::jsonb WHERE id=$1`, [ogre.id]);
  await place(alice.token, sage.id, 0.5);
  await place(gm.token, ogre.id, 2.5);
  const examine = `${base}/characters/${ogre.id}/examine`;

  await t.test('the GM sets the skill, the DC and a DC per part; a player may not', async () => {
    assert.equal((await request('PUT', examine, alice.token, { skill: 'investigation', dc: 5, dcs: {}, text: '' })).statusCode, 403);
    const set = await request('PUT', examine, gm.token, { skill: 'investigation', dc: 5, dcs: { abilities: 30, defenses: null }, text: 'Пахнет болотом.' });
    assert.equal(set.statusCode, 200, set.body);
    const view = (await request('GET', examine, gm.token)).json();
    assert.equal(view.manager, true);
    assert.equal(view.partDcs.abilities, 30);
    assert.equal(view.partDcs.defenses, 10, 'an empty part DC falls back to the base DC and its usual offset');
    assert.deepEqual(view.card.abilities, [19, 10, 10, 10, 10, 10], 'the GM sees everything');
  });

  await t.test('one roll reveals every part whose DC it meets, and only those', async () => {
    const before = (await request('GET', `${examine}?heroId=${sage.id}`, alice.token)).json();
    assert.equal(before.card, null);
    assert.equal(before.skill.id, 'investigation');
    const looked = await request('POST', examine, alice.token, { heroId: sage.id });
    assert.equal(looked.statusCode, 200, looked.body);
    const { card, rolled } = looked.json();
    assert.equal(rolled, true);
    assert.deepEqual([card.ac, card.hp.max, card.text], [11, 59, 'Пахнет болотом.']);
    assert.equal(card.abilities, undefined, 'DC 30 is out of reach');
    assert.equal(card.known.includes('abilities'), false);
    const again = (await request('POST', examine, alice.token, { heroId: sage.id })).json();
    assert.equal(again.rolled, false, 'a hero looks once');
    assert.equal(again.total, looked.json().total);
  });

  await t.test('the GM lets everyone look again; a hidden figure cannot be examined', async () => {
    const view = (await request('GET', examine, gm.token)).json();
    assert.deepEqual(view.results.map((result: any) => result.name), ['Мудрец']);
    assert.equal((await request('DELETE', examine, alice.token)).statusCode, 403);
    assert.deepEqual((await request('DELETE', examine, gm.token)).json(), { cleared: 1 });
    assert.equal((await request('POST', examine, alice.token, { heroId: sage.id })).json().rolled, true);
    await pg.query('UPDATE scene_objects SET hidden=true WHERE character_id=$1', [ogre.id]);
    assert.equal((await request('GET', examine, alice.token)).statusCode, 404);
  });

  await t.test('an object is studied with Investigation and shows its own note', async () => {
    const barrel = await create(gm.token, { kind: 'object', name: 'Бочка' });
    await pg.query(`UPDATE characters SET item_note='Доски плотно подогнаны.', hp_max=10, hp_current=10 WHERE id=$1`, [barrel.id]);
    await place(gm.token, barrel.id, 4.5);
    const view = (await request('GET', `${base}/characters/${barrel.id}/examine`, gm.token)).json();
    assert.equal(view.settings.skill, 'investigation');
    assert.equal(view.card.text, 'Доски плотно подогнаны.');
    assert.equal(view.card.object, true);
  });
});
