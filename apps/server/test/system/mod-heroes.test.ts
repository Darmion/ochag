import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildApp} from '../../src/app.ts';
import {loadMods} from '../../src/system/mods.ts';
import {createTestDatabase} from '../helpers.ts';
import {characterTraitEffects} from '../../../../packages/domain/character/hero-traits.ts';
import {traitSaveAdvantages} from '../../../../packages/domain/character/traits.ts';

const examples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../examples/mods');

async function writeMod(dir: string, folder: string, manifest: Record<string, unknown>, code: string) {
  const at = path.join(dir, folder);
  await mkdir(at, {recursive: true});
  await writeFile(path.join(at, 'mod.json'), JSON.stringify(manifest));
  await writeFile(path.join(at, 'index.js'), code);
}

test('races, subraces and feats from mods: the wizard builds them, the rules read their effects; a wrong effect refuses the mod', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ochag-mod-heroes-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await cp(path.join(examples, 'ash-folk'), path.join(dir, 'ash-folk'), {recursive: true});
  await writeMod(dir, 'bad-effect', {id: 'bad-effect', name: 'Плохой эффект', version: '1.0.0'}, `
export default function (api) {
  api.feats.define({ id: 'mod_fine', name: 'Хорошая', effects: [{ kind: 'speed', feet: 5 }] });
  api.feats.define({ id: 'mod_wings', name: 'Крылья', effects: [{ kind: 'fly', feet: 30 }] });
}`);
  await writeMod(dir, 'bad-race', {id: 'bad-race', name: 'Плохая подраса', version: '1.0.0'}, `
export default function (api) {
  api.races.subrace('goblin', { id: 'mod_cave', name: 'Пещерный' });
}`);

  const mods = await loadMods(dir, () => {});
  const byId = Object.fromEntries(mods.list.map(mod => [mod.id, mod]));
  await t.test('the loader: what the example adds and why the bad mods are refused', () => {
    assert.equal(byId['ash-folk']!.status, 'loaded', byId['ash-folk']!.error ?? '');
    assert.deepEqual(byId['ash-folk']!.changes, [
      'раса «Пеплорождённый»: новая, подрас: 2', 'подраса «Пепельный дварф» для «Дварф»', 'черта «Хладнокровный»: новая',
      'существо «Пепельная гончая» (опасность 1): новое', 'окно «Пепельный вихрь» (мастеру)', 'окно «Отряхнуть пепел» (всем)',
    ]);
    assert.equal(byId['bad-effect']!.status, 'error');
    assert.match(byId['bad-effect']!.error!, /^feats\.define: черта «Крылья»: эффект «fly»: kind — save-advantage/);
    assert.match(byId['bad-race']!.error!, /races\.subrace: расы «goblin» нет/);
  });

  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000, mods});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => { await pg.exec('SET ROLE ttrpg_app'); try { return await fn(); } finally { await pg.exec('RESET ROLE'); } };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {})}));
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_mod_heroes', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Пепельный народ'})).json().id;
  const base = `/campaigns/${campaignId}`;
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const sheet = async (id: string) => (await request('GET', `${base}/characters/${id}`, gm.token)).json();

  await t.test('the reference: the mod race before «своя раса», its subraces, the dwarf gets one more', async () => {
    const races = (await request('GET', '/srd/heroes', gm.token)).json().races;
    assert.deepEqual(races.slice(-2).map((race: any) => race.id), ['mod_ashborn', 'custom']);
    const ashborn = races.find((race: any) => race.id === 'mod_ashborn');
    assert.deepEqual([ashborn.modName, ashborn.icon, ashborn.speed, ashborn.darkvision, ashborn.resistances], ['Пепельный народ', 'flame', 30, 60, ['fire']]);
    assert.deepEqual(ashborn.subraces.map((entry: any) => [entry.id, entry.speed ?? null, entry.hpPerLevel ?? null]), [['mod_ashborn_coal', null, 1], ['mod_ashborn_spark', 35, null]]);
    assert.deepEqual(races.find((race: any) => race.id === 'dwarf').subraces.map((entry: any) => entry.id), ['hill', 'mod_ash_dwarf']);
  });

  await t.test('the wizard builds an ashborn: bonuses, speed of the subrace, fire resistance, the cantrip, hit points per level', async () => {
    const body = {
      name: 'Искрен', race: 'mod_ashborn', subrace: 'mod_ashborn_coal', className: 'fighter', method: 'standard',
      abilities: {strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8},
      background: 'acolyte', classSkills: ['athletics', 'perception'], kit: 'knight', fightingStyle: 'defense',
    };
    const built = await request('POST', `${base}/characters/build`, gm.token, body);
    assert.equal(built.statusCode, 201, built.body);
    const hero = await sheet(built.json().character.id);
    assert.deepEqual([hero.strength, hero.constitution, hero.charisma], [16, 16, 9]);
    assert.deepEqual([hero.speed_feet, hero.sheet_extra.darkvisionFeet, hero.damage_resistances, hero.hp_max], [30, 60, ['fire'], 10 + 3 + 1]);
    const spells = (await pg.query<any>('SELECT srd_index FROM character_spells WHERE character_id=$1', [hero.id])).rows.map(row => row.srd_index);
    assert.ok(spells.includes('produce-flame'), 'the race cantrip');
    assert.match(hero.sheet_extra.text.features.value, /Тлеющая решимость\. Спасброски против испуга/);
    assert.deepEqual(traitSaveAdvantages(characterTraitEffects(hero), 'wisdom', {condition: 'frightened'}), ['тлеющая решимость']);
    const features = (await request('GET', `${base}/characters/${hero.id}/features`, gm.token)).json().features;
    assert.ok(features.some((feature: any) => feature.name === 'Раса: Крепость угля'), 'the subrace trait is on the sheet');

    const spark = await request('POST', `${base}/characters/build`, gm.token, {...body, name: 'Варра', subrace: 'mod_ashborn_spark'});
    assert.equal((await sheet(spark.json().character.id)).speed_feet, 35);

    await request('POST', `${base}/experience`, gm.token, {characterIds: [hero.id], amount: 300});
    const raised = await request('POST', `${base}/characters/${hero.id}/level-up`, gm.token, {hp: 'average'});
    assert.equal(raised.statusCode, 201, raised.body);
    assert.equal(raised.json().hpGain, 6 + 3 + 1, 'd10 average 6 + CON 3 + «Крепость угля» 1');
  });

  await t.test('a subrace of an SRD race: fire is resisted by the trait, even with no resistance written on the sheet', async () => {
    const dwarf = (await request('POST', `${base}/characters`, gm.token, {kind: 'character', name: 'Бранна', hpMax: 30, hpCurrent: 30, level: 1})).json();
    await pg.query('UPDATE characters SET sheet_extra=$2::jsonb WHERE id=$1', [dwarf.id, JSON.stringify({builder: {race: 'dwarf', subrace: 'mod_ash_dwarf'}})]);
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: '1d1+9'})).json();
    const burned = (await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId: dwarf.id, mode: 'damage', damageType: 'fire'})).json();
    assert.deepEqual([burned.applied, burned.modified], [5, 'resisted']);
  });

  await t.test('a feat from a mod: in the level-up list with its mod, marked on the sheet, +2 to initiative', async () => {
    const scout = (await request('POST', `${base}/characters`, gm.token, {kind: 'character', name: 'Тлеон', hpMax: 28, hpCurrent: 28, level: 3, dexterity: 14, wisdom: 12})).json();
    await pg.query(`UPDATE characters SET class_name='Воин' WHERE id=$1`, [scout.id]);
    await request('POST', `${base}/experience`, gm.token, {characterIds: [scout.id], amount: 2700});
    const info = (await request('GET', `${base}/characters/${scout.id}/level-up`, gm.token)).json();
    const listed = info.feats.find((feat: any) => feat.id === 'mod_cool_headed');
    assert.deepEqual([listed?.modName, listed?.abilities], ['Пепельный народ', ['wisdom', 'charisma']]);
    const feat = (increase?: string) => ({hp: 'average', asi: {kind: 'feat', id: 'mod_cool_headed', name: 'Хладнокровный', ...(increase ? {increase} : {})}});
    assert.match((await request('POST', `${base}/characters/${scout.id}/level-up`, gm.token, feat('strength'))).json().message, /Мудрость или Харизма/);
    const done = await request('POST', `${base}/characters/${scout.id}/level-up`, gm.token, feat('wisdom'));
    assert.equal(done.statusCode, 201, done.body);
    const after = await sheet(scout.id);
    assert.equal(after.wisdom, 13);
    assert.match(after.sheet_extra.text.levels.value, /Черта: Хладнокровный \(Мудрость \+1\)/);
    const choices = (await request('GET', `${base}/characters/${scout.id}/features`, gm.token)).json().features.find((entry: any) => entry.id === 'feats');
    assert.equal(choices.detail, 'Хладнокровный');
    assert.equal(choices.choices.find((choice: any) => choice.value === 'mod_cool_headed').hint, 'мод «Пепельный народ»');
    assert.deepEqual((await request('PUT', `${base}/characters/${scout.id}/feats`, gm.token, {mod_cool_headed: false})).json(), {feats: []});
    assert.deepEqual((await request('PUT', `${base}/characters/${scout.id}/feats`, gm.token, {mod_cool_headed: true})).json(), {feats: ['mod_cool_headed']});

    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Пепелище', widthCells: 4, heightCells: 4})).json().id;
    await request('POST', `${base}/scenes/${sceneId}/objects`, gm.token, {characterId: scout.id, x: 0.5, z: 0.5});
    assert.equal((await request('POST', `${base}/scenes/${sceneId}/initiative/join`, gm.token, {characterId: scout.id})).statusCode, 201);
    const initiative = (await pg.query<any>(`SELECT modifier, outcome FROM roll_log WHERE character_id=$1 AND label LIKE 'Инициатива%'`, [scout.id])).rows[0];
    assert.equal(initiative.modifier, 4, 'DEX +2 and «Хладнокровный» +2');
    assert.ok(initiative.outcome.reasons.includes('хладнокровный +2'));
  });
});
