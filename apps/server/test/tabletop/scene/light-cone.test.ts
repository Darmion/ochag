import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';
import {inLightCone} from '../../../../../packages/domain/map/light.ts';

test('a bullseye lantern lights a cone', async t => {
  await t.test('the cone geometry: 0° looks along +z, 90° along +x', () => {
    assert.equal(inLightCone(0, 3, 0), true);
    assert.equal(inLightCone(0, -3, 0), false, 'behind');
    assert.equal(inLightCone(3, 0, 0), false, 'to the side');
    assert.equal(inLightCone(3, 1, 90), true);
    assert.equal(inLightCone(3, 2, 90), false, 'wider than the cone (half-angle 26.6°)');
    assert.equal(inLightCone(0.2, -0.1, 180), true, 'the lantern’s own cell');
  });

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
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_cone', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Cone'})).json().id;
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Коридор', widthCells: 9, heightCells: 1})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  await request('PATCH', scenePath, gm.token, {lighting: 'dark'});
  const lantern = (await request('POST', `${base}/characters`, gm.token, {kind: 'object', name: 'Фонарь'})).json();
  const lanternAt = (await request('POST', `${scenePath}/objects`, gm.token, {characterId: lantern.id, x: 0, z: 0})).json().id;
  const lit = await request('PUT', `${base}/characters/${lantern.id}/state`, gm.token, {lightBrightFeet: 10, lightDimFeet: 5, lit: true, lightCone: true});
  assert.equal(lit.statusCode, 200, lit.body);
  const map = async () => (await request('GET', scenePath, gm.token)).json().illumination as string;

  await t.test('facing +x (90°) — only the cells to its right are lit', async () => {
    await pg.query('UPDATE scene_objects SET rotation_y=90 WHERE id=$1', [lanternAt]);
    assert.equal(await map(), '000022210', 'its own cell, two bright, one dim — to the right only');
    await pg.query('UPDATE scene_objects SET rotation_y=270 WHERE id=$1', [lanternAt]);
    assert.equal(await map(), '012220000', 'turned round');
  });

  await t.test('in a hand it turns with the bearer; off — a round light again', async () => {
    const hero = (await request('POST', `${base}/characters`, gm.token, {kind: 'character', name: 'Герой'})).json();
    const heroAt = (await request('POST', `${scenePath}/objects`, gm.token, {characterId: hero.id, x: 0, z: 0})).json().id;
    await pg.query('UPDATE scene_objects SET parent_object_id=$2, rotation_y=0, x=0, z=0 WHERE id=$1', [lanternAt, heroAt]);
    await pg.query('UPDATE scene_objects SET rotation_y=90 WHERE id=$1', [heroAt]);
    assert.equal(await map(), '000022210', 'the hero looks right — so does the lantern');
    await request('PUT', `${base}/characters/${lantern.id}/state`, gm.token, {lightCone: false});
    assert.equal(await map(), '012222210', 'a plain lantern lights both ways');
  });
});
