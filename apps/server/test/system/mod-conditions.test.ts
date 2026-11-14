import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildApp} from '../../src/app.ts';
import {loadMods} from '../../src/system/mods.ts';
import {createTestDatabase} from '../helpers.ts';

async function writeMod(dir: string, folder: string, manifest: Record<string, unknown>, code: string) {
  const at = path.join(dir, folder);
  await mkdir(at, {recursive: true});
  await writeFile(path.join(at, 'mod.json'), JSON.stringify(manifest));
  await writeFile(path.join(at, 'index.js'), code);
}

test('conditions from mods: a new one and a replaced SRD one work at the table; a bad code refuses the whole mod', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ochag-mod-conditions-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await writeMod(dir, 'a-grim', {id: 'grim-rules', name: 'Суровые правила', version: '1.0.0'}, `
export default function (api) {
  api.conditions.define({
    code: 'mod_shaken', name: 'Потрясён', kind: 'condition', icon: 'frightened', description: 'Дрожат руки после ужаса.',
    clauses: [{ kind: 'own-rolls', values: { rolls: 'attacks', effect: 'disadvantage' } }, { kind: 'repeat-save', values: { ability: 'wisdom', dc: '8', when: 'turn-end' } }],
  });
  api.conditions.define({ code: 'poisoned', name: 'не важно', clauses: [{ kind: 'own-rolls', values: { rolls: 'checks', effect: 'disadvantage' } }] });
}`);
  await writeMod(dir, 'b-bad', {id: 'bad-code', name: 'Плохой код', version: '1.0.0'}, `
export default function (api) {
  api.conditions.define({ code: 'mod_fine', name: 'Хорошее', clauses: [] });
  api.conditions.define({ code: 'shaken', name: 'Без приставки', clauses: [] });
}`);

  const mods = await loadMods(dir, () => {});
  const byId = Object.fromEntries(mods.list.map(mod => [mod.id, mod]));
  await t.test('the loader: what changed and why the bad mod is refused', () => {
    assert.equal(byId['grim-rules']!.status, 'loaded');
    assert.deepEqual(byId['grim-rules']!.changes, ['состояние «Потрясён»: новое', 'состояние «отравлен»: правила SRD заменены']);
    assert.equal(byId['bad-code']!.status, 'error');
    assert.match(byId['bad-code']!.error!, /conditions\.define: код «shaken»/);
  });

  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000, mods});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => { await pg.exec('SET ROLE ttrpg_app'); try { return await fn(); } finally { await pg.exec('RESET ROLE'); } };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {})}));
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_mod_cond', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Состояния модов'})).json().id;
  const base = `/campaigns/${campaignId}`;
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'action_economy','flag','Экономия действий','false'::jsonb,$2)`, [campaignId, gm.user.id]);
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Зал', widthCells: 6, heightCells: 2})).json().id;
  const hero = (await request('POST', `${base}/characters`, gm.token, {kind: 'character', name: 'Гронд', level: 3, hpMax: 40, hpCurrent: 40})).json();
  const dummy = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Чучело', disposition: 'hostile', hpMax: 90, hpCurrent: 90, armorClass: 1})).json();
  for (const [id, x] of [[hero.id, -0.5], [dummy.id, 0.5]] as const) await request('POST', `${base}/scenes/${sceneId}/objects`, gm.token, {characterId: id, x, z: 0});
  const sword = (await request('POST', `${base}/characters/${hero.id}/weapons`, gm.token, {name: 'Меч', ability: 'strength', proficient: true, damageFormula: '1d8', damageType: 'slashing'})).json();
  const attackReasons = async () => ((await request('POST', `${base}/rolls/check`, gm.token, {characterId: hero.id, kind: 'attack', key: sword.id, targetCharacterId: dummy.id, sceneId})).json().outcome.reasons ?? []) as string[];

  await t.test('the Conditions tab lists the mod’s rules with their source; the GM can change and reset them', async () => {
    const rules = (await request('GET', `${base}/condition-rules`, gm.token)).json().rules;
    const shaken = rules.find((rule: any) => rule.code === 'mod_shaken');
    assert.deepEqual([shaken.origin, shaken.modName, shaken.standard, shaken.changed, shaken.description], ['mod', 'Суровые правила', true, false, 'Дрожат руки после ужаса.']);
    const poisoned = rules.find((rule: any) => rule.code === 'poisoned');
    assert.deepEqual([poisoned.origin, poisoned.name, poisoned.summary], ['mod', 'отравлен', 'Его проверки — с помехой.']);
    const edited = await request('PUT', `${base}/condition-rules/mod_shaken`, gm.token, {clauses: [{kind: 'own-rolls', values: {rolls: 'attacks', effect: 'advantage'}}]});
    assert.equal(edited.statusCode, 200, edited.body);
    assert.equal(edited.json().changed, true);
    assert.equal(edited.json().description, 'Дрожат руки после ужаса.', 'the mod’s description stays when the GM did not write one');
    const reset = await request('DELETE', `${base}/condition-rules/mod_shaken`, gm.token);
    assert.equal(reset.json().rules.find((rule: any) => rule.code === 'mod_shaken').changed, false);
  });

  await t.test('at the table: the mod’s condition goes on and works; the replaced «poisoned» no longer hinders attacks', async () => {
    assert.equal((await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [hero.id], code: 'mod_shaken'})).json().results[0].applied, true);
    assert.ok((await attackReasons()).includes('помеха: Потрясён'));
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [hero.id]);
    await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [hero.id], code: 'poisoned'});
    assert.ok(!(await attackReasons()).some(reason => reason.includes('отравлен')), 'the mod made poison hinder only checks');
    assert.equal((await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [hero.id], code: 'mod_fine'})).statusCode, 404, 'the refused mod’s condition does not exist');
  });
});
