import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildApp} from '../../src/app.ts';
import {loadMods} from '../../src/system/mods.ts';
import {createTestDatabase} from '../helpers.ts';

const examples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../examples/mods');

async function writeMod(dir: string, folder: string, manifest: Record<string, unknown>, code: string) {
  const at = path.join(dir, folder);
  await mkdir(at, {recursive: true});
  await writeFile(path.join(at, 'mod.json'), JSON.stringify(manifest));
  await writeFile(path.join(at, 'index.js'), code);
}

test('windows from mods: listed by rights, values checked against the description, the mod runs inside the request', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ochag-mod-forms-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await cp(path.join(examples, 'ash-folk'), path.join(dir, 'ash-folk'), {recursive: true});
  await writeMod(dir, 'b-every-field', {id: 'every-field', name: 'Все поля', version: '1.0.0'}, `
export default function (api) {
  api.ui.form({
    id: 'echo', title: 'Эхо', who: 'everyone',
    fields: [
      { key: 'note', label: 'Заметка', type: 'text', maxLength: 10, default: 'привет' },
      { key: 'story', label: 'Рассказ', type: 'textarea' },
      { key: 'count', label: 'Сколько', type: 'number', min: 1, max: 5, default: 2 },
      { key: 'mood', label: 'Настрой', type: 'select', options: [{ value: 'calm', label: 'Спокойно' }, { value: 'wild', label: 'Буйно' }] },
      { key: 'loud', label: 'Громко', type: 'checkbox' },
      { key: 'hero', label: 'Герой', type: 'character', who: 'character' },
    ],
    run: ({ values }) => ({ message: JSON.stringify(values) }),
  });
  api.ui.form({ id: 'broken', title: 'Сломанное', who: 'everyone', run: () => { throw new Error('нет связи с небом'); } });
  api.ui.form({ id: 'refuses', title: 'Отказ', who: 'everyone', run: () => { const error = new Error('Не сегодня.'); error.statusCode = 409; throw error; } });
}`);
  await writeMod(dir, 'c-bad-form', {id: 'bad-form', name: 'Плохое окно', version: '1.0.0'}, `
export default function (api) {
  api.ui.form({ id: 'pick', title: 'Выбор', run: () => {}, fields: [{ key: 'one', label: 'Один', type: 'select', options: [{ value: 'a', label: 'А' }] }] });
}`);

  const mods = await loadMods(dir, () => {});
  const byId = Object.fromEntries(mods.list.map(mod => [mod.id, mod]));
  await t.test('the loader names the windows and refuses a wrong one with a reason', () => {
    assert.ok(byId['ash-folk']!.changes.includes('окно «Пепельный вихрь» (мастеру)'), byId['ash-folk']!.changes.join('; '));
    assert.ok(byId['ash-folk']!.changes.includes('окно «Отряхнуть пепел» (всем)'));
    assert.equal(byId['bad-form']!.status, 'error');
    assert.match(byId['bad-form']!.error!, /^ui\.form: окно «Выбор», поле 1: options — хотя бы два разных \{ value, label \}/);
  });

  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000, mods});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => { await pg.exec('SET ROLE ttrpg_app'); try { return await fn(); } finally { await pg.exec('RESET ROLE'); } };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {})}));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();
  const gm = await register('gm_mod_forms');
  const alice = await register('alice_mod_forms');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Окна модов'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Варра', hpMax: 20, hpCurrent: 5})).json();
  const npc = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Чучело', hpMax: 200, hpCurrent: 200})).json();
  const form = (modId: string, formId: string, body: any, token = gm.token) => request('POST', `${base}/mods/${modId}/forms/${formId}`, token, body);

  await t.test('the list: the GM sees every window, a player only those for everyone; no code goes out', async () => {
    const forGm = (await request('GET', `${base}/mod-forms`, gm.token)).json().forms;
    assert.deepEqual(forGm.map((entry: any) => `${entry.modId}/${entry.id}`), ['ash-folk/ash-whirl', 'ash-folk/shake-ash', 'every-field/echo', 'every-field/broken', 'every-field/refuses']);
    const whirl = forGm[0];
    assert.deepEqual([whirl.modName, whirl.who, whirl.scope, whirl.icon, whirl.submit, 'run' in whirl], ['Пепельный народ', 'gm', 'campaign', 'fog', 'Поднять вихрь', false]);
    assert.deepEqual(whirl.fields.map((field: any) => [field.key, field.type, field.required]), [['target', 'character', true], ['dice', 'select', false]]);
    const forAlice = (await request('GET', `${base}/mod-forms`, alice.token)).json().forms;
    assert.deepEqual(forAlice.map((entry: any) => entry.id), ['shake-ash', 'echo', 'broken', 'refuses']);
  });

  await t.test('a GM window: only the GM, the values are checked, the mod does the work', async () => {
    assert.equal((await form('ash-folk', 'ash-whirl', {target: npc.id, dice: '1d6'}, alice.token)).statusCode, 403);
    assert.match((await form('ash-folk', 'ash-whirl', {dice: '1d6'})).json().message, /Заполните «Кого обжечь»/);
    assert.match((await form('ash-folk', 'ash-whirl', {target: npc.id, dice: '9d6'})).json().message, /«Сила вихря» — один из вариантов: Слабый — 1d6, Средний — 2d6, Сильный — 4d6/);
    assert.match((await form('ash-folk', 'ash-whirl', {target: npc.id, power: 3})).json().message, /Лишние поля: power/);
    assert.match((await form('ash-folk', 'ash-whirl', {target: '00000000-0000-0000-0000-000000000000'})).json().message, /такого существа в кампании нет/);
    const done = await form('ash-folk', 'ash-whirl', {target: npc.id, dice: '4d6'});
    assert.equal(done.statusCode, 200, done.body);
    const left = (await request('GET', `${base}/characters/${npc.id}`, gm.token)).json().hp_current;
    assert.equal(done.json().message, `Вихрь обжёг «Чучело»: ${200 - left} урона огнём.`);
    assert.ok(200 - left >= 4 && 200 - left <= 24);
    const roll = (await pg.query<any>(`SELECT formula FROM roll_log WHERE character_id=$1 AND label='Пепельный вихрь'`, [npc.id])).rows[0];
    assert.equal(roll?.formula, '4d6', 'the roll is in the log');
  });

  await t.test('a window for a creature: the player for their own, the GM for anyone, nobody without a figure', async () => {
    const shaken = await form('ash-folk', 'shake-ash', {characterId: hero.id}, alice.token);
    assert.equal(shaken.statusCode, 200, shaken.body);
    assert.match(shaken.json().message, /^«Варра» отряхнулся: \+[1-4] хита\.$/);
    assert.equal((await form('ash-folk', 'shake-ash', {characterId: npc.id}, alice.token)).statusCode, 403);
    assert.match((await form('ash-folk', 'shake-ash', {}, alice.token)).json().message, /выберите существо на столе/);
    assert.equal((await form('ash-folk', 'shake-ash', {characterId: npc.id})).statusCode, 200);
    assert.match((await form('every-field', 'echo', {characterId: hero.id}, alice.token)).json().message, /Лишние поля: characterId/);
  });

  await t.test('every field kind: defaults fill the gaps, wrong values are refused', async () => {
    const echoed = await form('every-field', 'echo', {count: 4, mood: 'wild', loud: true, hero: hero.id}, alice.token);
    assert.equal(echoed.statusCode, 200, echoed.body);
    assert.deepEqual(JSON.parse(echoed.json().message), {note: 'привет', story: '', count: 4, mood: 'wild', loud: true, hero: hero.id});
    assert.deepEqual(JSON.parse((await form('every-field', 'echo', {}, alice.token)).json().message), {note: 'привет', story: '', count: 2, mood: 'calm', loud: false, hero: null});
    assert.match((await form('every-field', 'echo', {note: 'слишком длинная заметка'}, alice.token)).json().message, /не длиннее 10 знаков/);
    assert.match((await form('every-field', 'echo', {count: 9}, alice.token)).json().message, /«Сколько» — число от 1 до 5/);
    assert.match((await form('every-field', 'echo', {loud: 'да'}, alice.token)).json().message, /«Громко» — да или нет/);
    assert.match((await form('every-field', 'echo', {hero: npc.id}, alice.token)).json().message, /«Герой»: такого существа в кампании нет/);
  });

  await t.test('the mod failing: its own status passes through, anything else names the mod', async () => {
    const broken = await form('every-field', 'broken', {}, alice.token);
    assert.equal(broken.statusCode, 424);
    assert.equal(broken.json().message, 'Мод «Все поля» не справился: нет связи с небом');
    const refused = await form('every-field', 'refuses', {}, alice.token);
    assert.deepEqual([refused.statusCode, refused.json().message], [409, 'Не сегодня.']);
    assert.equal((await form('every-field', 'missing', {}, alice.token)).statusCode, 404);
    assert.equal((await form('bad-form', 'pick', {}, alice.token)).statusCode, 404, 'a refused mod has no windows');
  });

  await t.test('without mods the list is empty, not missing', async () => {
    const plain = await buildApp(db, {rateMax: 1_000_000});
    t.after(() => plain.close());
    const listed = await asApp(() => plain.inject({method: 'GET', url: `${base}/mod-forms`, headers: {authorization: `Bearer ${gm.token}`}}));
    assert.deepEqual(listed.json(), {forms: []});
  });
});
