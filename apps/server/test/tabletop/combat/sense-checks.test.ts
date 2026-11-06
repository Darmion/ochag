import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('checks that need sight or hearing', async t => {
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
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_sense', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Sense'})).json().id;
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Подвал', widthCells: 6, heightCells: 6})).json().id;
  const hero = (await request('POST', `${base}/characters`, gm.token, {kind: 'character', name: 'Лира', level: 1, wisdom: 14})).json();
  await request('POST', `${base}/scenes/${sceneId}/objects`, gm.token, {characterId: hero.id, x: 0.5, z: 0.5});
  const roll = (payload: any) => request('POST', `${base}/rolls/check`, gm.token, {characterId: hero.id, kind: 'skill', key: 'perception', sceneId, ...payload});
  const effect = (code: string) => pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code) VALUES ($1,$2,$3)`, [campaignId, hero.id, code]);
  const clear = () => pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [hero.id]);

  await t.test('blinded: by sight — fails by itself; by hearing — rolls; not said — a hint only', async () => {
    await effect('blinded');
    const sight = (await roll({sense: 'sight'})).json().outcome;
    assert.equal(sight.autoFail, true);
    assert.ok(sight.reasons.includes('автопровал: ослеплён — проверка зрением'), JSON.stringify(sight));
    const hearing = (await roll({sense: 'hearing'})).json().outcome;
    assert.equal(hearing.autoFail, undefined);
    const plain = (await roll({})).json().outcome;
    assert.equal(plain.autoFail, undefined);
    assert.ok(plain.notes.some((note: string) => note.startsWith('Ослеплён')));
    await clear();
  });

  await t.test('deafened: by hearing — fails by itself', async () => {
    await effect('deafened');
    assert.equal((await roll({sense: 'hearing'})).json().outcome.autoFail, true);
    assert.equal((await roll({sense: 'sight'})).json().outcome.autoFail, undefined);
    await clear();
  });

  await t.test('pitch dark without darkvision: a sight check fails; darkvision sees', async () => {
    await request('PATCH', `${base}/scenes/${sceneId}`, gm.token, {lighting: 'dark'});
    const dark = (await roll({sense: 'sight'})).json().outcome;
    assert.equal(dark.autoFail, true);
    assert.ok(dark.reasons.includes('автопровал: темнота — проверка зрением'));
    await pg.query(`UPDATE characters SET sheet_extra = sheet_extra || '{"darkvisionFeet": 60}'::jsonb WHERE id=$1`, [hero.id]);
    const seen = (await roll({sense: 'sight'})).json().outcome;
    assert.equal(seen.autoFail, undefined, 'darkvision: dim, not dark');
  });

  await t.test('a saving throw has no sense', async () => {
    assert.equal((await request('POST', `${base}/rolls/check`, gm.token, {characterId: hero.id, kind: 'save', key: 'wisdom', sense: 'sight'})).statusCode, 400);
  });
});
