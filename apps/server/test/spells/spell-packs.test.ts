import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildApp} from '../../src/app.ts';
import {loadMods} from '../../src/system/mods.ts';
import {createTestDatabase} from '../helpers.ts';

const spellFile = (name: string, level = 1) => JSON.stringify({format: 'ochag-spell-template', version: 1, template: {passport: {name, level, school: 'evocation'}}});

test('spell packs: a mod of spells is added to a campaign at once, once, and taken out without touching what heroes know', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ochag-spell-packs-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const pack = path.join(dir, 'home-spells');
  await mkdir(path.join(pack, 'spells'), {recursive: true});
  await writeFile(path.join(pack, 'mod.json'), JSON.stringify({id: 'home-spells', name: 'Домашние заклинания', version: '1.0.0', kind: 'spells', author: 'Мастер'}));
  await writeFile(path.join(pack, 'spells', 'a-hearth-spark.spell.json'), spellFile('Искра очага', 0));
  await writeFile(path.join(pack, 'spells', 'b-warm-rest.spell.json'), spellFile('Тёплый привал', 1));
  await writeFile(path.join(pack, 'spells', 'c-broken.spell.json'), '{ not json');
  await writeFile(path.join(pack, 'spells', 'd-other.spell.json'), JSON.stringify({format: 'something-else'}));
  await writeFile(path.join(pack, 'spells', 'notes.txt'), 'not a spell');
  const escape = path.join(dir, 'escape');
  await mkdir(escape, {recursive: true});
  await writeFile(path.join(escape, 'mod.json'), JSON.stringify({id: 'escape', name: 'Побег', version: '1.0.0', kind: 'spells', spells: '../home-spells/spells'}));

  const mods = await loadMods(dir);
  assert.equal(mods.list.length, 0, 'spell packs are not mechanics: the mechanics loader leaves them out');
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000, mods});
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
  const gm = await register('gm_packs'), alice = await register('alice_packs');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Packs'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;

  await t.test('the list: good spells counted, broken files named with a reason, a path outside the pack refused', async () => {
    const list = await request('GET', `${base}/spell-packs`, alice.token);
    assert.equal(list.statusCode, 200, list.body);
    const {packs, canManage} = list.json();
    assert.equal(canManage, false);
    const home = packs.find((entry: any) => entry.id === 'home-spells');
    assert.deepEqual([home.count, home.names, home.added, home.error], [2, ['Искра очага', 'Тёплый привал'], 0, null]);
    assert.deepEqual(home.skipped.map((entry: any) => entry.file), ['c-broken.spell.json', 'd-other.spell.json']);
    assert.match(packs.find((entry: any) => entry.id === 'escape').error, /внутри папки мода/);
  });

  await t.test('only the GM adds a pack; a second time adds nothing', async () => {
    assert.equal((await request('POST', `${base}/spell-packs/home-spells`, alice.token)).statusCode, 403);
    const first = await request('POST', `${base}/spell-packs/home-spells`, gm.token);
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual(first.json(), {added: 2, already: 0});
    assert.deepEqual((await request('POST', `${base}/spell-packs/home-spells`, gm.token)).json(), {added: 0, already: 2});
    const spells = (await pg.query<any>(`SELECT name, status, pack_id FROM campaign_spells WHERE campaign_id=$1 ORDER BY name`, [campaignId])).rows;
    assert.deepEqual(spells.map(row => [row.name, row.status, row.pack_id]), [['Искра очага', 'approved', 'home-spells'], ['Тёплый привал', 'approved', 'home-spells']]);
    assert.equal((await request('POST', `${base}/spell-packs/escape`, gm.token)).statusCode, 400);
    assert.equal((await request('POST', `${base}/spell-packs/nowhere`, gm.token)).statusCode, 404);
  });

  await t.test('taking the pack out keeps the spell a hero knows', async () => {
    const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Тиль'})).json();
    const spark = (await pg.query<any>(`SELECT id FROM campaign_spells WHERE campaign_id=$1 AND name='Искра очага'`, [campaignId])).rows[0].id;
    const learned = await request('POST', `${base}/characters/${hero.id}/spells`, alice.token, {source: 'custom', customSpellId: spark});
    assert.equal(learned.statusCode, 201, learned.body);
    assert.equal((await request('DELETE', `${base}/spell-packs/home-spells`, alice.token)).statusCode, 403);
    const out = await request('DELETE', `${base}/spell-packs/home-spells`, gm.token);
    assert.deepEqual(out.json(), {removed: 1, kept: 1});
    const left = (await pg.query<any>(`SELECT name FROM campaign_spells WHERE campaign_id=$1`, [campaignId])).rows.map(row => row.name);
    assert.deepEqual(left, ['Искра очага']);
    const list = (await request('GET', `${base}/spell-packs`, gm.token)).json();
    assert.equal(list.packs.find((entry: any) => entry.id === 'home-spells').added, 1);
  });
});
