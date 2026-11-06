import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

const ru = JSON.parse(readFileSync(new URL('../../../../packages/domain/srd/spells.ru.json', import.meta.url), 'utf8'));
const raw = JSON.parse(readFileSync(new URL('../../../../packages/domain/srd/spells.json', import.meta.url), 'utf8'));
const srd: any[] = Array.isArray(raw) ? raw : raw.spells;

test('Russian spell text comes from the data file; the old translation routes and table are gone', async t => {
  const indices = new Set(srd.map(spell => spell.index));
  for (const [index, entry] of Object.entries<any>(ru)) {
    assert.ok(indices.has(index), `${index} is an SRD spell`);
    assert.ok(typeof entry.name === 'string' && entry.name.trim(), `${index}: name`);
    assert.ok(typeof entry.desc === 'string' && entry.desc.trim(), `${index}: desc`);
    assert.ok(entry.higherLevel === undefined || typeof entry.higherLevel === 'string', `${index}: higherLevel`);
  }
  assert.equal(Object.keys(ru).length, srd.length);

  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 100_000});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({
    method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {}),
  }));
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_ru_text', password: 'x'})).json();

  const spells = (await request('GET', '/srd/spells', gm.token)).json().spells;
  const fireBolt = spells.find((spell: any) => spell.index === 'fire-bolt');
  assert.deepEqual([fireBolt.nameRu, fireBolt.descRu.slice(0, 20), fireBolt.name], [ru['fire-bolt'].name, ru['fire-bolt'].desc.slice(0, 20), 'Fire Bolt']);
  const spikeGrowth = spells.find((spell: any) => spell.index === 'spike-growth');
  assert.deepEqual([spikeGrowth.nameRu, spikeGrowth.descRu.slice(0, 20), spikeGrowth.higherLevelRu], [ru['spike-growth'].name, ru['spike-growth'].desc.slice(0, 20), null]);
  assert.equal('flagged' in fireBolt, false);
  assert.equal(spells.filter((spell: any) => spell.nameRu).length, srd.length);

  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'RU'})).json().id;
  const hero = (await request('POST', `/campaigns/${campaignId}/characters`, gm.token, {kind: 'character', name: 'Маг'})).json();
  await request('POST', `/campaigns/${campaignId}/characters/${hero.id}/spells`, gm.token, {source: 'srd', srdIndex: 'fire-bolt'});
  const own = (await request('GET', `/campaigns/${campaignId}/characters/${hero.id}/spells`, gm.token)).json().spells[0];
  assert.equal(own.spell.nameRu, ru['fire-bolt'].name);

  for (const [method, url] of [['POST', '/srd/spells/fire-bolt/translation'], ['POST', '/srd/spells/fire-bolt/flag'], ['DELETE', '/srd/spells/fire-bolt/flag']] as const) {
    assert.equal((await request(method, url, gm.token, method === 'POST' && url.endsWith('translation') ? {nameRu: 'x', descRu: 'y'} : undefined)).statusCode, 404, url);
  }
  assert.equal((await pg.query<{table: string | null}>(`SELECT to_regclass('public.srd_spell_translations') AS table`)).rows[0]!.table, null);

  const saved = await request('POST', '/srd/spells/spike-growth/mechanics', gm.token, {damageFormula: '2d4'});
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().damageFormula, '2d4');
});
