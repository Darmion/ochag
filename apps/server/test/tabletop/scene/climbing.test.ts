import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('climbing walls: only beside a wall, height counts, a fall when knocked down or when «Spider Climb» ends', async t => {
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
  const gm = await register('gm_climb'), alice = await register('alice_climb');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Стены'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Башня', widthCells: 10, heightCells: 10})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  await request('POST', `${scenePath}/walls`, gm.token, {x1: 0, z1: -5, x2: 0, z2: 5});

  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Лазутчица', hpMax: 30, hpCurrent: 30, speedFeet: 30})).json();
  const spider = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Паук', disposition: 'hostile', hpMax: 20, hpCurrent: 20})).json();
  await pg.query(`UPDATE characters SET sheet_extra='{"climbSpeedFeet": 30}'::jsonb WHERE id=$1`, [spider.id]);
  const heroAt = (await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: -0.5, z: 0.5})).json().id;
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: spider.id, x: 3.5, z: 0.5});
  const climb = (characterId: string, body: any, token = alice.token) => request('PUT', `${base}/characters/${characterId}/climbing`, token, {sceneId, ...body});
  const view = async (characterId: string) => (await request('GET', scenePath, gm.token)).json().objects.find((object: any) => object.character_id === characterId);
  const move = async (x: number, z: number) => {
    const current = await view(hero.id);
    return request('PUT', `${scenePath}/objects/${heroAt}`, alice.token, {x, y: 0, z, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision});
  };
  const hp = async () => Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [hero.id])).rows[0].hp_current);
  const climbing = async () => (await pg.query<any>(`SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code='climbing' AND active`, [hero.id])).rows;

  await t.test('a natural climber is marked; away from a wall nobody climbs', async () => {
    assert.equal((await view(spider.id)).canClimb, true);
    assert.equal((await view(hero.id)).canClimb, undefined, 'the hero has no climbing speed of her own');
    const far = await climb(spider.id, {on: true, height: 10}, gm.token);
    assert.equal(far.statusCode, 400);
    assert.match(far.json().message, /рядом нет стены/);
  });

  await t.test('«Spider Climb»: up the wall, the height is shown, along the wall but not away from it', async () => {
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'spider_climb',$3::jsonb)`, [campaignId, hero.id, JSON.stringify({source: 'spell', sourceName: 'Паук', concentrationOf: hero.id})]);
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'concentration','{"source":"spell","spellName":"Паук"}'::jsonb)`, [campaignId, hero.id]);
    const up = await climb(hero.id, {on: true, height: 10});
    assert.equal(up.statusCode, 200, up.body);
    assert.match(up.json().message, /на стене, высота 10/);
    assert.equal((await view(hero.id)).flightHeight, 10, 'the height counts like flight for reach and areas');
    assert.equal((await climbing())[0]?.parameters.bySpell, true, JSON.stringify(await climbing()));
    assert.equal((await move(-0.5, 2.5)).statusCode, 200, 'along the wall');
    const away = await move(-2.5, 2.5);
    assert.equal(away.statusCode, 400);
    assert.match(away.json().message, /на стене/);
  });

  await t.test('the spell ends — she falls from the wall', async () => {
    const before = await hp();
    const held = (await pg.query<any>(`SELECT id FROM character_effects WHERE character_id=$1 AND effect_code='concentration' AND active`, [hero.id])).rows[0];
    assert.equal((await request('DELETE', `${base}/characters/${hero.id}/effects/${held.id}`, alice.token)).statusCode, 204);
    assert.equal((await climbing()).length, 0);
    assert.ok(await hp() < before, 'a 10-foot fall hurts');
  });

  await t.test('a natural climber knocked prone falls too', async () => {
    assert.equal((await climb(spider.id, {on: true, height: 20}, gm.token)).statusCode, 400, 'still away from the wall');
    await pg.query('UPDATE scene_objects SET x=0.5 WHERE character_id=$1', [spider.id]);
    assert.equal((await climb(spider.id, {on: true, height: 20}, gm.token)).statusCode, 200);
    const before = Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [spider.id])).rows[0].hp_current);
    const knocked = await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [spider.id], code: 'prone'});
    assert.ok(knocked.statusCode < 300, knocked.body);
    const after = Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [spider.id])).rows[0].hp_current);
    assert.ok(after < before, `fell 20 feet: ${before} → ${after}`);
    assert.equal((await pg.query<any>(`SELECT 1 FROM character_effects WHERE character_id=$1 AND effect_code='climbing' AND active`, [spider.id])).rows.length, 0);
  });
});
