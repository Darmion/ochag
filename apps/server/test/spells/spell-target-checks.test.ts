import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('spell targets as the spell text says', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000});
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
  const gm = await register('gm_targets'), alice = await register('alice_targets');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Targets'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Склеп', widthCells: 10, heightCells: 6})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const create = async (token: string, body: any) => (await request('POST', `${base}/characters`, token, body)).json();
  const cleric = await create(alice.token, {kind: 'character', name: 'Ирма', wisdom: 16, hpMax: 30, hpCurrent: 30});
  const friend = await create(alice.token, {kind: 'character', name: 'Борин', hpMax: 30, hpCurrent: 10});
  const goblin = await create(gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 7, hpCurrent: 7});
  const wolf = await create(gm.token, {kind: 'npc', name: 'Волк', disposition: 'hostile', hpMax: 11, hpCurrent: 11});
  const skeleton = await create(gm.token, {kind: 'npc', name: 'Скелет', disposition: 'hostile', hpMax: 13, hpCurrent: 5});
  await pg.query(`UPDATE characters SET sheet_extra = sheet_extra || '{"srdMonster": "goblin"}'::jsonb WHERE id=$1`, [goblin.id]);
  await pg.query(`UPDATE characters SET sheet_extra = sheet_extra || '{"srdMonster": "wolf"}'::jsonb WHERE id=$1`, [wolf.id]);
  await pg.query(`UPDATE characters SET sheet_extra = sheet_extra || '{"creatureType": "undead"}'::jsonb WHERE id=$1`, [skeleton.id]);
  for (const [token, id, x] of [[alice.token, cleric.id, -3.5], [alice.token, friend.id, -2.5], [gm.token, goblin.id, 1.5], [gm.token, wolf.id, 2.5], [gm.token, skeleton.id, 3.5]] as const) {
    await request('POST', `${scenePath}/objects`, token, {characterId: id, x, z: 0.5});
  }
  const learn = async (srdIndex: string) => (await request('POST', `${base}/characters/${cleric.id}/spells`, alice.token, {source: 'srd', srdIndex})).json().id as string;
  const hold = await learn('hold-person');
  const cure = await learn('cure-wounds');
  await pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,9,9),($1,$2,2,9,9)', [campaignId, cleric.id]);
  const cast = (spell: string, targetId: string, sceneless = false) =>
    request('POST', `${base}/characters/${cleric.id}/spells/${spell}/cast`, alice.token, {targetIds: [targetId], ...(sceneless ? {} : {sceneId})});

  await t.test('Hold Person: only a humanoid', async () => {
    const onWolf = await cast(hold, wolf.id);
    assert.equal(onWolf.statusCode, 400);
    assert.match(onWolf.json().message, /только на гуманоида, а это зверь: «Волк»/);
    assert.equal((await cast(hold, skeleton.id)).statusCode, 400, 'undead is not a humanoid');
    assert.equal((await cast(hold, goblin.id)).statusCode, 201, 'a goblin from the bestiary is a humanoid');
  });

  await t.test('Cure Wounds: not on the undead', async () => {
    const onSkeleton = await cast(cure, skeleton.id);
    assert.equal(onSkeleton.statusCode, 400);
    assert.match(onSkeleton.json().message, /не действует на нежить и конструкт/);
    assert.equal((await cast(cure, friend.id)).statusCode, 201);
  });

  await t.test('«that you can see»: not through a wall; without a scene — not checked', async () => {
    const wall = (await request('POST', `${scenePath}/walls`, gm.token, {x1: 0, z1: -3, x2: 0, z2: 3})).json();
    const unseen = await cast(hold, goblin.id);
    assert.equal(unseen.statusCode, 400);
    assert.match(unseen.json().message, /не видит «Гоблин»/);
    assert.equal((await cast(hold, goblin.id, true)).statusCode, 201, 'no scene — no sight check');
    await request('DELETE', `${scenePath}/walls/${wall.id}`, gm.token);
  });

  await t.test('the campaign flag spell_targets = false turns it off', async () => {
    await request('POST', `${base}/rules`, gm.token, {key: 'spell_targets', kind: 'flag', label: 'Цели', value: false});
    assert.equal((await cast(hold, wolf.id)).statusCode, 201);
  });
});
