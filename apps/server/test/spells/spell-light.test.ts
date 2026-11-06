import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('spells that shed light light up the scene', async t => {
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
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_light', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Свет'})).json().id;
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Коридор', widthCells: 21, heightCells: 1})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  await request('PATCH', scenePath, gm.token, {lighting: 'dark'});
  const map = async () => (await request('GET', scenePath, gm.token)).json().illumination as string;
  const expected = (x: number, bright: number, dim: number) => Array.from({length: 21}, (_, index) => {
    const distance = Math.abs(index - 10 - x);
    return distance <= bright ? '2' : distance <= bright + dim ? '1' : '0';
  }).join('');

  const mage = (await request('POST', `${base}/characters`, gm.token, {kind: 'character', name: 'Чародейка', level: 3, intelligence: 16})).json();
  const torch = (await request('POST', `${base}/characters`, gm.token, {kind: 'object', name: 'Факел'})).json();
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: mage.id, x: -1, z: 0});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: torch.id, x: 0, z: 0});
  const learn = async (index: string) => {
    const made = await request('POST', `${base}/characters/${mage.id}/spells`, gm.token, {source: 'srd', srdIndex: index});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const cast = (spellId: string, body: any = {}) => request('POST', `${base}/characters/${mage.id}/spells/${spellId}/cast`, gm.token, {sceneId, ...body});
  const lights = async () => (await pg.query<any>(`SELECT character_id, parameters FROM character_effects WHERE campaign_id=$1 AND effect_code='spell_light' AND active`, [campaignId])).rows;

  const light = await learn('light');
  await t.test('«Свет» on the torch: bright 20 ft and dim 20 more around it, for an hour', async () => {
    assert.equal(await map(), '0'.repeat(21), 'dark at first');
    const cast1 = await cast(light, {targetIds: [torch.id]});
    assert.ok(cast1.statusCode < 300, cast1.body);
    assert.equal(await map(), expected(0, 4, 4));
    const [row] = await lights();
    assert.equal(row.character_id, torch.id);
    assert.deepEqual([row.parameters.bright, row.parameters.dim, row.parameters.remainingRounds], [20, 20, 600], 'an hour = 600 rounds');
  });

  await t.test('cast again (on herself, no target) — the torch goes dark', async () => {
    const again = await cast(light);
    assert.ok(again.statusCode < 300, again.body);
    const rows = await lights();
    assert.deepEqual(rows.map(row => row.character_id), [mage.id], 'one «Свет» per caster');
    assert.equal(await map(), expected(-1, 4, 4));
  });

  await t.test('«Сотворение пламени» (self) glows in her hand and does not dim the brighter «Свет»', async () => {
    const flame = await learn('produce-flame');
    assert.ok((await cast(flame)).statusCode < 300);
    assert.equal((await lights()).length, 2);
    assert.equal(await map(), expected(-1, 4, 4), 'the brighter light wins');
    await pg.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND effect_code='spell_light' AND parameters->>'sourceName' <> $2`, [campaignId, 'Сотворение пламени']);
    assert.equal(await map(), expected(-1, 2, 2), '«Свет» gone — the flame lights 10 ft and 10 more');
  });
});
