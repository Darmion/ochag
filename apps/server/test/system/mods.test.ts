import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildApp} from '../../src/app.ts';
import {loadMods} from '../../src/system/mods.ts';
import {FEATURE_ACTIONS} from '../../src/rules/class-features/classes/index.ts';
import {SPELL_EFFECTS} from '../../src/tabletop/spells/rules.ts';
import {createTestDatabase} from '../helpers.ts';

async function writeMod(dir: string, folder: string, manifest: Record<string, unknown>, code?: string) {
  const at = path.join(dir, folder);
  await mkdir(at, {recursive: true});
  await writeFile(path.join(at, 'mod.json'), JSON.stringify(manifest));
  if (code !== undefined) await writeFile(path.join(at, String(manifest.entry ?? 'index.js')), code);
}

test('mods: loaded from a folder, override built-ins, add features and routes; broken ones change nothing', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ochag-mods-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await writeMod(dir, 'a-stronger-wind', {id: 'stronger-wind', name: 'Второе дыхание сильнее', version: '1.0.0', description: 'Пример.'}, `
export default function (api) {
  const base = api.features.actionOf('second-wind');
  api.features.action('second-wind', async use => {
    const done = await base(use);
    return { ...done, message: done.message + ' (мод)' };
  });
  api.features.define({ id: 'battle-cry', classId: 'fighter', level: 1, name: 'Боевой клич', use: 'action', text: 'Клич союзникам.' });
  api.features.action('battle-cry', async use => ({ message: use.row.name + ': боевой клич!', float: 'клич', economyScene: null, heal: null }));
  api.features.view('battle-cry', () => ({ detail: 'громко' }));
  api.spellEffect('longstrider', { code: 'longstrider', rounds: 6000 });
  api.routes((ctx, kit) => {
    ctx.app.get('/campaigns/:campaignId/mod-ping', async request => {
      const userId = await ctx.auth(request);
      await ctx.membership(ctx.db, request.params.campaignId, userId);
      return { pong: true, dice: kit.rollDie(1) };
    });
  });
}`);
  await writeMod(dir, 'b-broken', {id: 'broken', name: 'Сломанный', version: '0.1.0'}, `
export default function (api) {
  api.features.action('broken-move', async () => ({ message: 'нет', float: null, economyScene: null, heal: null }));
  api.spellEffect('fireball', { code: 'nonsense', rounds: 1 });
  throw new Error('я сломан');
}`);
  await writeMod(dir, 'c-off', {id: 'switched-off', name: 'Выключен', version: '1.0.0', enabled: false}, 'export default function () { throw new Error("не должен грузиться"); }');
  await writeMod(dir, 'd-visual', {id: 'parchment', name: 'Пергамент', version: '1.0.0', kind: 'visual', styles: ['theme.css']});
  await writeMod(dir, 'e-bad-id', {id: 'Bad Id!', name: 'Плохой id', version: '1.0.0'}, 'export default function () {}');
  await writeMod(dir, 'f-twin', {id: 'stronger-wind', name: 'Двойник', version: '2.0.0'}, 'export default function () {}');
  await writeMod(dir, 'g-no-export', {id: 'no-export', name: 'Без функции', version: '1.0.0'}, 'export const nothing = 1;');
  await mkdir(path.join(dir, 'h-not-a-mod'));

  const logged: string[] = [];
  const mods = await loadMods(dir, message => logged.push(message));
  const byId = Object.fromEntries(mods.list.map(mod => [`${mod.id}@${mod.version}`, mod]));

  await t.test('the loader: statuses, what changed, broken and twin mods refused', () => {
    assert.deepEqual(mods.list.map(mod => [mod.id, mod.status]), [
      ['stronger-wind', 'loaded'], ['broken', 'error'], ['switched-off', 'disabled'], ['Bad Id!', 'error'], ['stronger-wind', 'error'], ['no-export', 'error'],
    ]);
    assert.ok(!mods.list.some(mod => mod.id === 'parchment'), 'a visual mod is not the server’s business');
    const good = byId['stronger-wind@1.0.0']!;
    assert.ok(good.changes.some(change => /second-wind.*своя версия/.test(change)), good.changes.join('; '));
    assert.ok(good.changes.some(change => /Боевой клич.*новое/.test(change)), good.changes.join('; '));
    assert.ok(good.changes.some(change => /longstrider.*заменён/.test(change)));
    assert.match(byId['broken@0.1.0']!.error!, /я сломан/);
    assert.match(byId['stronger-wind@2.0.0']!.error!, /уже подключён/);
    assert.match(byId['no-export@1.0.0']!.error!, /export default/);
    assert.equal(FEATURE_ACTIONS['broken-move'], undefined, 'the broken mod left no action behind');
    assert.notEqual(SPELL_EFFECTS.fireball?.code, 'nonsense', 'nor a spell effect');
    assert.equal(SPELL_EFFECTS.longstrider?.rounds, 6000, 'the good mod’s effect wins over the built-in');
    assert.ok(logged.some(line => /подключён/.test(line)) && logged.some(line => /не подключён: я сломан/.test(line)));
  });

  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000, mods});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => { await pg.exec('SET ROLE ttrpg_app'); try { return await fn(); } finally { await pg.exec('RESET ROLE'); } };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {})}));
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_mods', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'С модами'})).json().id;
  const base = `/campaigns/${campaignId}`;
  const hero = (await request('POST', `${base}/characters`, gm.token, {kind: 'character', name: 'Гронд', hpMax: 44, hpCurrent: 10, level: 5})).json();
  const current = (await request('GET', `${base}/characters/${hero.id}`, gm.token)).json();
  assert.equal((await request('PATCH', `${base}/characters/${hero.id}`, gm.token, {revision: current.revision, className: 'Воин', level: 5})).statusCode, 200);

  await t.test('the mod’s «Второе дыхание» wraps the built-in one', async () => {
    const wind = await request('POST', `${base}/characters/${hero.id}/features/second-wind`, gm.token, {});
    assert.equal(wind.statusCode, 200, wind.body);
    assert.match(wind.json().message, /второе дыхание — \+\d+ хит\. \(мод\)$/);
    assert.ok(wind.json().healed >= 6);
  });

  await t.test('a new class feature from a mod: in the list with its view, usable by id', async () => {
    const list = (await request('GET', `${base}/characters/${hero.id}/features`, gm.token)).json().features;
    const cry = list.find((feature: any) => feature.id === 'battle-cry');
    assert.ok(cry, JSON.stringify(list.map((feature: any) => feature.id)));
    assert.deepEqual([cry.name, cry.detail, cry.available], ['Боевой клич', 'громко', true]);
    const used = await request('POST', `${base}/characters/${hero.id}/features/battle-cry`, gm.token, {});
    assert.equal(used.statusCode, 200, used.body);
    assert.equal(used.json().message, 'Гронд: боевой клич!');
    assert.equal((await request('POST', `${base}/characters/${hero.id}/features/broken-move`, gm.token, {})).statusCode, 400);
  });

  await t.test('a mod route: with the table context, auth and membership', async () => {
    const pong = await request('GET', `${base}/mod-ping`, gm.token);
    assert.equal(pong.statusCode, 200, pong.body);
    assert.deepEqual(pong.json(), {pong: true, dice: 1});
    assert.equal((await request('GET', `${base}/mod-ping`)).statusCode, 401);
  });

  await t.test('GET /mods: everyone signed in sees the server’s mods; the folder only on the host', async () => {
    const seen = await request('GET', '/mods', gm.token);
    assert.equal(seen.statusCode, 200, seen.body);
    const list = seen.json().mods;
    assert.equal(list.length, 6);
    assert.equal(list[0].name, 'Второе дыхание сильнее');
    assert.ok(list[0].changes.length >= 4);
    assert.equal(seen.json().canInstall, true);
    assert.ok(String(list[0].folder).endsWith('a-stronger-wind'));
    assert.equal((await request('GET', '/mods')).statusCode, 401);
  });
});

test('mods: no folder — nothing loaded, nothing breaks', async () => {
  assert.deepEqual(await loadMods(undefined), {list: [], routes: []});
  assert.deepEqual(await loadMods(path.join(tmpdir(), 'ochag-no-such-mods-folder')), {list: [], routes: []});
});
