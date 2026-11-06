import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('magical darkness', async t => {
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
  const gm = await register('gm_dark'), alice = await register('alice_dark');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Тьма'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  assert.equal((await request('POST', '/campaigns/join', alice.token, {code})).statusCode, 201);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Коридор', widthCells: 21, heightCells: 1})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const map = async () => (await request('GET', scenePath, gm.token)).json().illumination as string | null;

  const scout = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Разведчица'})).json();
  await pg.query(`UPDATE characters SET sheet_extra = COALESCE(sheet_extra, '{}'::jsonb) || '{"darkvisionFeet": 60}'::jsonb WHERE id=$1`, [scout.id]);
  const goblin = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile'})).json();
  const mage = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Тёмный маг', disposition: 'hostile', level: 5, intelligence: 16})).json();
  const stone = (await request('POST', `${base}/characters`, gm.token, {kind: 'object', name: 'Камень'})).json();
  const torch = (await request('POST', `${base}/characters`, gm.token, {kind: 'object', name: 'Факел'})).json();
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: scout.id, x: -8, z: 0});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 1, z: 0});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: mage.id, x: 6, z: 0});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: stone.id, x: 0, z: 0});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: torch.id, x: 5, z: 0});
  await pg.query(
    `INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,2,3,3), ($1,$2,3,3,3)`,
    [campaignId, mage.id],
  );
  const learn = async (index: string) => {
    const made = await request('POST', `${base}/characters/${mage.id}/spells`, gm.token, {source: 'srd', srdIndex: index});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const cast = async (spellId: string, body: any = {}) => {
    const done = await request('POST', `${base}/characters/${mage.id}/spells/${spellId}/cast`, gm.token, {sceneId, ...body});
    assert.ok(done.statusCode < 300, done.body);
    return done.json();
  };
  const seesGoblin = async () => (await request('GET', scenePath, alice.token)).json().objects.some((object: any) => object.character_id === goblin.id);
  const effects = async (code: string) => (await pg.query<any>(`SELECT character_id FROM character_effects WHERE campaign_id=$1 AND effect_code=$2 AND active`, [campaignId, code])).rows.map(row => row.character_id);

  const light = await learn('light');
  const darkness = await learn('darkness');
  const daylight = await learn('daylight');

  await t.test('«Тьма» on the stone darkens a 15-ft sphere even by day; darkvision cannot see the goblin in it', async () => {
    assert.equal(await map(), null, 'a bright scene — no light map');
    assert.equal(await seesGoblin(), true, 'by day the scout sees the goblin');
    await cast(light, {targetIds: [torch.id]});
    assert.deepEqual(await effects('spell_light'), [torch.id]);
    const result = await cast(darkness, {targetIds: [stone.id]});
    assert.deepEqual(await effects('spell_darkness'), [stone.id]);
    assert.equal(await map(), '2'.repeat(7) + '0'.repeat(7) + '2'.repeat(7), 'three cells each way around the stone');
    assert.equal(await seesGoblin(), false, 'darkvision 60 ft does not pierce magical darkness');
    assert.deepEqual(await effects('spell_light'), [], '«Свет» (a cantrip) inside the darkness is dispelled');
    assert.ok(JSON.stringify(result).includes('рассеяно: «Свет»'), JSON.stringify(result));
  });

  await t.test('devil’s sight sees through it', async () => {
    await pg.query(`UPDATE characters SET sheet_extra = sheet_extra || '{"invocations": ["devils-sight"]}'::jsonb WHERE id=$1`, [scout.id]);
    assert.equal(await seesGoblin(), true);
    await pg.query(`UPDATE characters SET sheet_extra = sheet_extra - 'invocations' WHERE id=$1`, [scout.id]);
    assert.equal(await seesGoblin(), false);
  });

  await t.test('«Дневной свет» (3rd level) overlapping it dispels the darkness and the concentration on it', async () => {
    assert.deepEqual(await effects('concentration'), [mage.id]);
    await cast(daylight);
    assert.deepEqual(await effects('spell_darkness'), [], 'dispelled');
    assert.deepEqual(await effects('concentration'), [], 'the mage no longer concentrates');
    assert.equal(await seesGoblin(), true);
    assert.deepEqual(await effects('spell_light'), [mage.id], 'daylight shines from the mage');
  });
});
