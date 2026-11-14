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

test('bestiary creatures from mods: listed with their mod, spawned with a full sheet, read by the rules; a wrong one refuses the mod', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ochag-mod-bestiary-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await cp(path.join(examples, 'ash-folk'), path.join(dir, 'ash-folk'), {recursive: true});
  await writeMod(dir, 'b-seer', {id: 'seer', name: 'Провидец', version: '1.0.0'}, `
export default function (api) {
  api.bestiary.define({
    id: 'mod_seer', name: 'Слепой провидец', type: 'гуманоид (человек)', ac: 11, hitDice: '6d8', cr: 2,
    abilities: [10, 12, 10, 14, 16, 13], saves: { wisdom: 6 },
    spellcasting: { ability: 'wisdom', slots: [3, 2], spells: ['guidance', 'bless', 'hold-person'], slotless: ['guidance'], text: 'Мудрость, СЛ 13.' },
    attacks: [{ name: 'Посох', damage: '1d6', type: 'bludgeoning' }],
  });
}`);
  await writeMod(dir, 'c-bad-attack', {id: 'bad-attack', name: 'Плохая атака', version: '1.0.0'}, `
export default function (api) {
  api.bestiary.define({ id: 'mod_rat', name: 'Крыса', type: 'зверь', ac: 10, hitDice: '1d4', cr: 0, abilities: [2, 11, 9, 2, 10, 4], attacks: [{ name: 'Укус', damage: '1d1' }] });
}`);
  await writeMod(dir, 'd-bad-spell', {id: 'bad-spell', name: 'Плохое заклинание', version: '1.0.0'}, `
export default function (api) {
  api.bestiary.define({ id: 'mod_hex', name: 'Ведьма', type: 'фея', ac: 12, hitDice: '4d8', cr: 1, abilities: [8, 12, 10, 12, 12, 15],
    spellcasting: { ability: 'charisma', spells: ['eldritch-doom'] } });
}`);

  const mods = await loadMods(dir, () => {});
  const byId = Object.fromEntries(mods.list.map(mod => [mod.id, mod]));
  await t.test('the loader names the creatures and refuses the wrong ones with a reason', () => {
    assert.ok(byId['ash-folk']!.changes.includes('существо «Пепельная гончая» (опасность 1): новое'), byId['ash-folk']!.changes.join('; '));
    assert.deepEqual([byId.seer!.status, byId.seer!.changes], ['loaded', ['существо «Слепой провидец» (опасность 2): новое']]);
    assert.match(byId['bad-attack']!.error!, /^bestiary\.define: Крыса, атака 1: damage — формула вроде 2d6\+3 и type — вид урона/);
    assert.match(byId['bad-spell']!.error!, /^bestiary\.define: «Ведьма» — заклинаний eldritch-doom нет в SRD/);
  });

  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000, mods});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => { await pg.exec('SET ROLE ttrpg_app'); try { return await fn(); } finally { await pg.exec('RESET ROLE'); } };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {})}));
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_mod_bestiary', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Пепелище'})).json().id;
  const base = `/campaigns/${campaignId}`;
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Пустошь', widthCells: 8, heightCells: 8})).json().id;
  const sheet = async (id: string) => (await request('GET', `${base}/characters/${id}`, gm.token)).json();

  await t.test('the bestiary lists the creature with its mod and a stat block worked out from the description', async () => {
    const monsters = (await request('GET', '/srd/monsters', gm.token)).json().monsters;
    const hound = monsters.find((monster: any) => monster.index === 'mod_ash_hound');
    assert.deepEqual([hound.modName, hound.name, hound.hp, hound.passive, hound.crText, hound.xp], ['Пепельный народ', 'Ash Hound', 27, 13, '1', 200]);
    assert.equal(hound.attackLines[0], 'Укус. Рукопашная атака оружием: +4 к попаданию, досягаемость 5 фт., одна цель. Попадание: 5 (1d6 + 2) колющего урона.');
    assert.match(hound.texts.about, /^чудовище, без мировоззрения\.\nКД 13 \(природный доспех\); хиты 27 \(5d8 \+ 5\); скорость 40 фт\./);
    assert.match(hound.texts.about, /Иммунитет к состояниям: испуг\./);
    assert.equal(monsters.filter((monster: any) => monster.modName).length, 2);
  });

  await t.test('spawned on a scene: the sheet, the source, the defenses and the condition immunity work', async () => {
    const spawned = await request('POST', `${base}/bestiary/spawn`, gm.token, {monsters: [{index: 'mod_ash_hound', count: 2}], sceneId, x: 0.5, z: 0.5});
    assert.equal(spawned.statusCode, 201, spawned.body);
    const [first] = spawned.json().characters;
    const hound = await sheet(first.id);
    assert.deepEqual([hound.hp_max, hound.armor_class, hound.speed_feet, hound.damage_resistances, hound.attacks_per_action], [27, 13, 40, ['fire'], 2]);
    assert.deepEqual([hound.sheet_extra.srdMonster, hound.sheet_extra.text.source.value], ['mod_ash_hound', 'мод «Пепельный народ»']);
    assert.deepEqual(hound.weapons.map((weapon: any) => [weapon.name, weapon.attack_bonus, weapon.damage_formula]), [['Укус', 0, '1d6+2']]);
    const scared = await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [first.id], code: 'frightened'});
    assert.equal(scared.statusCode, 200, scared.body);
    assert.equal((await pg.query(`SELECT 1 FROM character_effects WHERE character_id=$1 AND effect_code='frightened' AND active`, [first.id])).rows.length, 0, 'immune to fear');
    const examined = await request('GET', `${base}/characters/${first.id}/examine`, gm.token);
    assert.equal(examined.statusCode, 200, examined.body);
    const card = examined.json().card;
    assert.deepEqual([card.kind.creatureType, card.kind.cr, card.defenses.conditionImmunities], ['monstrosity', 1, 'испуг'], 'the examine card reads the type and the immunity');
  });

  await t.test('a save total in the description is kept, slotless spells stay slotless', async () => {
    const seer = (await request('POST', `${base}/bestiary/spawn`, gm.token, {monsters: [{index: 'mod_seer', count: 1}]})).json().characters[0];
    const save = await request('POST', `${base}/rolls/check`, gm.token, {characterId: seer.id, kind: 'save', key: 'wisdom'});
    assert.equal(save.statusCode, 201, save.body);
    assert.equal(save.json().modifier, 6, 'WIS +3, proficiency +2 and the rest from the description');
    const spells = (await pg.query<any>('SELECT srd_index, slotless FROM character_spells WHERE character_id=$1 ORDER BY srd_index', [seer.id])).rows;
    assert.deepEqual(spells.map(row => [row.srd_index, row.slotless]), [['bless', false], ['guidance', true], ['hold-person', false]]);
  });

  await t.test('the encounter difficulty counts the creature by its challenge', async () => {
    const rated = await request('POST', `${base}/difficulty`, gm.token, {monsters: [{index: 'mod_ash_hound', count: 2}]});
    assert.equal(rated.statusCode, 200, rated.body);
    assert.deepEqual(rated.json().foes, [{name: 'Пепельная гончая', xp: 200}, {name: 'Пепельная гончая', xp: 200}]);
  });
});
