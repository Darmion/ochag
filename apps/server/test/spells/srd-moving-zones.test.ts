import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('moving zones: Spirit Guardians go with the cleric and spare allies; Cloudkill drifts away at the caster’s turn', async t => {
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
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_moving_zones', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Moving zones'})).json().id;
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Храм', widthCells: 24, heightCells: 6})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const create = async (body: any) => (await request('POST', `${base}/characters`, gm.token, body)).json();
  const cleric = await create({kind: 'character', name: 'Ирма', wisdom: 18, level: 9, hpMax: 60, hpCurrent: 60});
  const friend = await create({kind: 'character', name: 'Борин', hpMax: 60, hpCurrent: 60});
  const goblin = await create({kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 200, hpCurrent: 200, wisdom: 1, constitution: 1});
  const place = async (characterId: string, x: number) => (await request('POST', `${scenePath}/objects`, gm.token, {characterId, x, z: 0.5})).json().id as string;
  const clericAt = await place(cleric.id, -9.5);
  const friendAt = await place(friend.id, -2.5);
  const goblinAt = await place(goblin.id, 9.5);
  await pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,3,9,9),($1,$2,5,9,9)', [campaignId, cleric.id]);
  await pg.query('UPDATE characters SET spell_save_dc_override=40 WHERE id=$1', [cleric.id]);
  const learn = async (srdIndex: string) => (await request('POST', `${base}/characters/${cleric.id}/spells`, gm.token, {source: 'srd', srdIndex})).json().id as string;
  const cast = (spell: string, body: any) => request('POST', `${base}/characters/${cleric.id}/spells/${spell}/cast`, gm.token, {sceneId, ...body});
  const move = async (placementId: string, x: number) => {
    const current = (await request('GET', scenePath, gm.token)).json().objects.find((object: any) => object.id === placementId);
    return request('PUT', `${scenePath}/objects/${placementId}`, gm.token, {x, y: 0, z: 0.5, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision});
  };
  const hp = async (id: string) => Number((await pg.query<{ hp_current: number }>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0]!.hp_current);
  const guardians = async () => (await pg.query<{ x: number; z: number; spell: any }>(`SELECT x::float8 AS x, z::float8 AS z, spell FROM scene_triggers WHERE scene_id=$1 AND (spell->>'follows')::boolean IS TRUE`, [sceneId])).rows[0];

  await t.test('Spirit Guardians: an area around the cleric, no blast at the cast, following every step', async () => {
    const response = await cast(await learn('spirit-guardians'), {slotLevel: 3});
    assert.ok(response.statusCode < 300, response.body);
    const placed = await guardians();
    assert.ok(placed, 'the zone is there without an area chosen by hand');
    assert.equal(placed!.x, -9.5, 'centred on the cleric');
    assert.equal(await hp(goblin.id), 200);
    assert.equal((await move(clericAt, -0.5)).statusCode, 200);
    const moved = await guardians();
    assert.equal(moved!.x, -0.5, 'the zone came along');
    const area = (await pg.query<{ x: number }>('SELECT x::float8 AS x FROM scene_templates WHERE id=$1', [moved!.spell.templateId])).rows[0];
    assert.equal(area?.x, -0.5, 'and its area on the table too');
    assert.equal(await hp(cleric.id), 60, 'the cleric is never struck by her own guardians');
  });

  await t.test('Spirit Guardians spare an ally and strike an enemy who comes close', async () => {
    await move(friendAt, 7.5);
    const walkIn = await move(friendAt, 1.5);
    assert.equal(walkIn.statusCode, 200, walkIn.body);
    assert.equal(await hp(friend.id), 60, 'an ally walks in unharmed');
    const goblinIn = await move(goblinAt, 2.5);
    assert.equal(goblinIn.statusCode, 200, goblinIn.body);
    assert.ok(await hp(goblin.id) < 200, 'an enemy entering takes radiant damage');
  });

  await t.test('Cloudkill drifts 10 feet away from the caster at the start of her turn', async () => {
    await move(goblinAt, 11.5);
    await move(friendAt, -11.5);
    const areaId = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: 6.5, z: 0.5, sizeFeet: 20})).json().id;
    const response = await cast(await learn('cloudkill'), {templateId: areaId, slotLevel: 5});
    assert.ok(response.statusCode < 300, response.body);
    const cloud = (await pg.query<{ id: string; x: number; spell: any }>(`SELECT id, x::float8 AS x, spell FROM scene_triggers WHERE scene_id=$1 AND (spell->>'drift')::numeric > 0`, [sceneId])).rows[0];
    assert.ok(cloud, 'the cloud is on the scene');
    assert.equal(cloud!.x, 6.5);
    const initiative = `${scenePath}/initiative`;
    const mine = (await request('POST', `${initiative}/join`, gm.token, {characterId: cleric.id})).json().id;
    const theirs = (await request('POST', `${initiative}/join`, gm.token, {characterId: goblin.id})).json().id;
    await request('PATCH', `${initiative}/${mine}`, gm.token, {score: 20});
    await request('PATCH', `${initiative}/${theirs}`, gm.token, {score: 5});
    await request('POST', `${initiative}/advance`, gm.token, {});
    const drifted = (await pg.query<{ x: number }>('SELECT x::float8 AS x FROM scene_triggers WHERE id=$1', [cloud!.id])).rows[0];
    assert.equal(drifted!.x, 8.5, 'two cells away from the caster at -0.5');
  });
});
