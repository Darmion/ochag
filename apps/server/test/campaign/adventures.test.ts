import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildApp} from '../../src/app.ts';
import {loadMods} from '../../src/system/mods.ts';
import {createTestDatabase} from '../helpers.ts';

const examples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../examples/mods');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function writeAdventure(dir: string, folder: string, manifest: Record<string, unknown>, content: unknown, files: Record<string, Buffer> = {}) {
  const at = path.join(dir, folder);
  await mkdir(at, {recursive: true});
  await writeFile(path.join(at, 'mod.json'), JSON.stringify({kind: 'adventure', version: '1.0.0', ...manifest}));
  if (content !== undefined) await writeFile(path.join(at, 'adventure.json'), JSON.stringify(content));
  for (const [name, data] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(at, name)), {recursive: true});
    await writeFile(path.join(at, name), data);
  }
}

test('ready-made adventures: listed from the mods folder, a new campaign gets scenes, notes, quests, handouts, tables and creatures', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ochag-adventures-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await cp(path.join(examples, 'ash-ford'), path.join(dir, 'ash-ford'), {recursive: true});
  await writeAdventure(dir, 'b-pictures', {id: 'pictures', name: 'С картинками'}, {
    format: 'ochag-adventure', formatVersion: 1, cover: 'cover.png',
    scenes: ['scenes/missing.ochag-scene', 'scenes/broken.ochag-scene', '../escape.ochag-scene'],
    handouts: [{title: 'Карта', image: 'pictures/map.png'}, {title: 'Пустая'}],
    rollTables: [{name: 'Дыра', formula: '1d4', entries: [{from: 1, to: 2, text: 'а'}]}],
    npcs: [{monster: 'goblin', count: 2}, {monster: 'dragon-of-nowhere'}],
  }, {'cover.png': PNG, 'pictures/map.png': PNG, 'scenes/broken.ochag-scene': Buffer.from('not a scene')});
  await writeAdventure(dir, 'c-bad', {id: 'bad', name: 'Без формата'}, {title: 'Что-то'});
  await writeAdventure(dir, 'd-empty', {id: 'empty', name: 'Пустое'}, {format: 'ochag-adventure', formatVersion: 1});

  const mods = await loadMods(dir, () => {});
  assert.deepEqual(mods.list, [], 'adventures are not mechanics mods: nothing to load or run');
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000, mods});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => { await pg.exec('SET ROLE ttrpg_app'); try { return await fn(); } finally { await pg.exec('RESET ROLE'); } };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {})}));
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_adventures', password: 'x'})).json();

  await t.test('the list: what each adventure brings, what was skipped and why a broken one cannot be used', async () => {
    assert.equal((await request('GET', '/adventures')).statusCode, 401);
    const listed = (await request('GET', '/adventures', gm.token)).json();
    assert.equal(listed.canCreate, true);
    const byId = Object.fromEntries(listed.adventures.map((entry: any) => [entry.id, entry]));
    const ford = byId['ash-ford'];
    assert.deepEqual([ford.title, ford.levels, ford.players, ford.duration, ford.error, ford.problems], ['Пепел над Кривым бродом', '1–2', '3–5', 'один вечер', null, []]);
    assert.deepEqual(ford.counts, {scenes: 2, notes: 4, quests: 2, handouts: 1, rollTables: 1, npcs: 1});
    assert.equal(ford.translations.en.name, 'Ash over Crooked Ford');
    assert.equal(ford.cover, null);
    const pictures = byId.pictures;
    assert.match(pictures.cover, /^data:image\/png;base64,/);
    assert.deepEqual(pictures.counts, {scenes: 1, notes: 0, quests: 0, handouts: 1, rollTables: 0, npcs: 2});
    assert.equal(pictures.problems.length, 5, pictures.problems.join('; '));
    for (const expected of [
      'scenes/missing.ochag-scene: файла нет',
      'scenes[2]: путь к файлу .ochag-scene внутри папки мода',
      'handouts[1]: нужны title и text или image',
      'npcs[1]: в бестиарии нет «dragon-of-nowhere»',
    ]) assert.ok(pictures.problems.includes(expected), expected);
    assert.ok(pictures.problems.some((problem: string) => problem.startsWith('rollTables[0]: ')), 'a table that does not cover its die is skipped');
    assert.match(byId.bad.error, /format «ochag-adventure»/);
    assert.match(byId.empty.error, /нет ни сцен, ни заметок/);
  });

  await t.test('a campaign from the example adventure: everything arrives, the GM owns it', async () => {
    const created = await request('POST', '/adventures/ash-ford/campaign', gm.token, {});
    assert.equal(created.statusCode, 201, created.body);
    const {campaignId, name, counts, problems} = created.json();
    assert.deepEqual([name, counts, problems], ['Пепел над Кривым бродом', {scenes: 2, notes: 4, quests: 2, handouts: 1, rollTables: 1, npcs: 1}, []]);
    const base = `/campaigns/${campaignId}`;
    assert.ok((await request('GET', '/campaigns', gm.token)).json().campaigns.some((campaign: any) => campaign.id === campaignId));
    const scenes = (await pg.query<any>('SELECT id, name FROM scenes WHERE campaign_id=$1 ORDER BY name', [campaignId])).rows;
    assert.deepEqual(scenes.map(scene => scene.name), ['Брод у старой мельницы', 'Таверна «Кривой брод»']);
    const placed = (await pg.query<any>(
      `SELECT c.name, c.disposition FROM scene_objects o JOIN characters c ON c.id=o.character_id WHERE o.scene_id=$1 ORDER BY c.name`, [scenes[1].id],
    )).rows;
    assert.deepEqual(placed.map(row => [row.name, row.disposition]), [['Рыжая Ольха', 'neutral'], ['Сиплый Ян', 'neutral'], ['Хозяйка Марта', 'friendly']]);
    const notes = (await pg.query<any>('SELECT title FROM campaign_notes WHERE campaign_id=$1 ORDER BY created_at, title', [campaignId])).rows.map(row => row.title);
    assert.ok(notes.includes('Как вести приключение') && notes.includes('Развязка'));
    const quests = (await request('GET', `${base}/quests`, gm.token)).json();
    const list = Array.isArray(quests) ? quests : quests.quests;
    const ford = list.find((quest: any) => quest.title === 'Освободить брод');
    assert.deepEqual([ford.xp_reward ?? ford.xpReward, (ford.objectives ?? []).map((goal: any) => goal.text)], [300, ['Расспросить хозяйку таверны', 'Дойти до брода', 'Прогнать гоблинов']]);
    assert.equal(list.find((quest: any) => quest.title === 'Откуда пепел?').hidden, true);
    assert.equal((await pg.query<any>('SELECT count(*)::int AS n FROM handouts WHERE campaign_id=$1', [campaignId])).rows[0].n, 1);
    assert.equal((await pg.query<any>(`SELECT formula FROM roll_tables WHERE campaign_id=$1`, [campaignId])).rows[0].formula, '1d6');
    const captain = (await pg.query<any>(`SELECT kind, disposition, hp_max FROM characters WHERE campaign_id=$1 AND name='Капитан Брам'`, [campaignId])).rows[0];
    assert.deepEqual([captain.kind, captain.disposition, captain.hp_max], ['npc', 'friendly', 58]);
  });

  await t.test('pictures become campaign files, a broken scene is skipped with a reason, a chosen name wins', async () => {
    const created = await request('POST', '/adventures/pictures/campaign', gm.token, {name: 'Своё название'});
    assert.equal(created.statusCode, 201, created.body);
    const {campaignId, name, counts, problems} = created.json();
    assert.deepEqual([name, counts], ['Своё название', {scenes: 0, notes: 0, quests: 0, handouts: 1, rollTables: 0, npcs: 2}]);
    assert.ok(problems.some((problem: string) => /^scenes\/broken\.ochag-scene: Это не файл сцены/.test(problem)), problems.join('; '));
    const campaign = (await pg.query<any>('SELECT banner_asset_id FROM campaigns WHERE id=$1', [campaignId])).rows[0];
    const kinds = (await pg.query<any>('SELECT kind FROM assets WHERE campaign_id=$1 ORDER BY kind', [campaignId])).rows.map(row => row.kind);
    assert.ok(campaign.banner_asset_id, 'the cover is the campaign banner');
    assert.deepEqual(kinds, ['campaign_banner', 'object_image']);
    const handout = (await pg.query<any>('SELECT title, body, asset_id FROM handouts WHERE campaign_id=$1', [campaignId])).rows[0];
    assert.deepEqual([handout.title, handout.body, Boolean(handout.asset_id)], ['Карта', null, true]);
    const goblins = (await pg.query<any>(`SELECT name FROM characters WHERE campaign_id=$1 AND kind='npc' ORDER BY name`, [campaignId])).rows.map(row => row.name);
    assert.deepEqual(goblins, ['Гоблин 1', 'Гоблин 2']);
  });

  await t.test('an unknown or broken adventure is refused', async () => {
    assert.equal((await request('POST', '/adventures/nowhere/campaign', gm.token, {})).statusCode, 404);
    const bad = await request('POST', '/adventures/bad/campaign', gm.token, {});
    assert.equal(bad.statusCode, 400);
    assert.match(bad.json().message, /^Приключение «Без формата» не готово: adventure\.json: нужен format/);
  });
});
