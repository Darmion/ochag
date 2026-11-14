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

test('campaign rules from mods: a switch and a choice in the Rules window, read by the mod’s own code', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ochag-mod-rules-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await writeMod(dir, 'a-house', {id: 'house-rules', name: 'Домашние правила', version: '1.0.0'}, `
export default function (api) {
  api.rules.define({ key: 'mod_hard_mode', kind: 'flag', label: 'Жёсткий режим', description: 'Враги бьют больнее.', default: false });
  api.rules.define({ key: 'mod_crit_style', kind: 'choice', label: 'Крит', description: 'Как считать крит.', default: 'double',
    options: [{ value: 'double', label: 'Кости дважды' }, { value: 'max', label: 'Максимум и кости' }] });
  api.routes(ctx => {
    ctx.app.get('/campaigns/:campaignId/house-rules', async request => {
      const userId = await ctx.auth(request);
      await ctx.membership(ctx.db, request.params.campaignId, userId);
      return { hard: await api.rules.value(ctx.db, request.params.campaignId, 'mod_hard_mode'), crit: await api.rules.value(ctx.db, request.params.campaignId, 'mod_crit_style') };
    });
  });
}`);
  await writeMod(dir, 'b-bad', {id: 'bad-rule', name: 'Плохое правило', version: '1.0.0'}, `
export default function (api) {
  api.rules.define({ key: 'hard', kind: 'flag', label: 'Без приставки' });
}`);
  await writeMod(dir, 'c-one-option', {id: 'one-option', name: 'Один вариант', version: '1.0.0'}, `
export default function (api) {
  api.rules.define({ key: 'mod_lonely', kind: 'choice', label: 'Одинокий', options: [{ value: 'only', label: 'Только так' }] });
}`);

  const mods = await loadMods(dir, () => {});
  const byId = Object.fromEntries(mods.list.map(mod => [mod.id, mod]));
  await t.test('the loader: two new rules; a key without mod_ and a choice of one option are refused', () => {
    assert.deepEqual(byId['house-rules']!.changes.filter(line => line.startsWith('правило')), ['правило кампании «Жёсткий режим»: новое', 'правило кампании «Крит»: новое']);
    assert.match(byId['bad-rule']!.error!, /rules\.define: ключ «hard»/);
    assert.match(byId['one-option']!.error!, /хотя бы два варианта/);
  });

  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000, mods});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => { await pg.exec('SET ROLE ttrpg_app'); try { return await fn(); } finally { await pg.exec('RESET ROLE'); } };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {})}));
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_mod_rules', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Домашние'})).json().id;
  const base = `/campaigns/${campaignId}`;
  const values = async () => (await request('GET', `${base}/house-rules`, gm.token)).json();

  await t.test('the Rules window gets the mod’s rules; until the GM touches them, the mod reads its defaults', async () => {
    const view = (await request('GET', `${base}/rules`, gm.token)).json();
    assert.deepEqual(view.modRules.map((rule: any) => [rule.key, rule.kind, rule.default, rule.modName]), [
      ['mod_hard_mode', 'flag', false, 'Домашние правила'], ['mod_crit_style', 'choice', 'double', 'Домашние правила'],
    ]);
    assert.deepEqual(await values(), {hard: false, crit: 'double'});
  });

  await t.test('the GM sets them; a value outside the choice or of the wrong kind is refused', async () => {
    const wrongKind = await request('POST', `${base}/rules`, gm.token, {key: 'mod_hard_mode', kind: 'text', label: 'Жёсткий режим', value: 'да'});
    assert.equal(wrongKind.statusCode, 400);
    assert.match(wrongKind.json().message, /переключатель правила мода «Домашние правила»/);
    assert.equal((await request('POST', `${base}/rules`, gm.token, {key: 'mod_hard_mode', kind: 'flag', label: 'Жёсткий режим', value: true})).statusCode, 201);
    const outside = await request('POST', `${base}/rules`, gm.token, {key: 'mod_crit_style', kind: 'text', label: 'Крит', value: 'triple'});
    assert.equal(outside.statusCode, 400);
    assert.match(outside.json().message, /double, max/);
    const crit = (await request('POST', `${base}/rules`, gm.token, {key: 'mod_crit_style', kind: 'text', label: 'Крит', value: 'max'})).json();
    assert.deepEqual(await values(), {hard: true, crit: 'max'});
    const back = await request('PUT', `${base}/rules/${crit.id}`, gm.token, {label: 'Крит', value: 'nonsense', revision: crit.revision});
    assert.equal(back.statusCode, 400, 'the same check when the GM changes it');
  });
});
