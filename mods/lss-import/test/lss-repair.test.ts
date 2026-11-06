import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../apps/server/src/app.ts';
import {repairLssWeapons} from '../repair.ts';
import {createTestDatabase} from '../../../apps/server/test/helpers.ts';
import '../../../apps/server/test/lssImporter.ts';

test('LSS repair: weapons of old imports get the right to-hit and damage once', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 100_000});
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
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_repair', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Repair'})).json().id;

  const weaponsList = [
    {name: {value: 'Атака Рапирой'}, mod: {value: '+0'}, dmg: {value: '1к8+3/колющий'}, ability: 'dex', isProf: true},
    {name: {value: 'Копьё'}, mod: {value: '+0'}, dmg: {value: '1к6 / колящий'}, modBonus: {value: 1}, isProf: true},
    {name: {value: 'Кинжал'}, mod: {value: '+0'}, dmg: {value: '1d4'}, isProf: true},
  ];
  const original = {
    edition: '2014', sheetEdition: '2014', spells: {mode: 'cards', prepared: [], book: []},
    data: JSON.stringify({
      jsonType: 'character', name: {value: 'Торвин'}, proficiency: 2, info: {charClass: {value: 'Плут'}, level: {value: 3}},
      stats: {str: {score: 10}, dex: {score: 18}, con: {score: 12}, int: {score: 10}, wis: {score: 10}, cha: {score: 14}},
      vitality: {'hp-current': {value: 20}, 'hp-max': {value: 20}, 'hp-temp': {value: 0}, ac: {value: 15}, speed: {value: 30}},
      saves: {}, skills: {}, weaponsList, coins: {}, resources: {}, conditions: [], text: {},
    }),
  };
  const draft = (await request('POST', `/campaigns/${campaignId}/imports`, gm.token, {importer: 'lss', original})).json();
  const confirmed = await request('POST', `/campaigns/${campaignId}/imports/${draft.id}/confirm`, gm.token, {draftRevision: draft.draft_revision});
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  const characterId = confirmed.json().characterId as string;
  const weapons = async () => (await pg.query<any>(
    'SELECT name, ability, attack_bonus, damage_formula, damage_type FROM character_weapons WHERE character_id=$1 ORDER BY name', [characterId],
  )).rows.map(w => [w.name, w.ability, w.attack_bonus, w.damage_formula, w.damage_type]);
  const fresh = await weapons();
  assert.deepEqual(fresh, [
    ['Атака Рапирой', 'dexterity', 0, '1d8+3', 'piercing'],
    ['Кинжал', 'finesse', 0, '1d4', null],
    ['Копьё', 'strength', 1, '1d6', 'piercing'],
  ]);

  await pg.query(`UPDATE character_weapons SET attack_bonus=-6, damage_formula=NULL, damage_type=NULL WHERE character_id=$1 AND name='Атака Рапирой'`, [characterId]);
  await pg.query(`UPDATE character_weapons SET attack_bonus=3, damage_formula=NULL, damage_type=NULL WHERE character_id=$1 AND name='Копьё'`, [characterId]);
  await pg.query(`UPDATE character_weapons SET ability='strength', attack_bonus=-2 WHERE character_id=$1 AND name='Кинжал'`, [characterId]);

  assert.equal(await repairLssWeapons(db), 3);
  assert.deepEqual(await weapons(), [
    ['Атака Рапирой', 'dexterity', 0, '1d8+3', 'piercing'],
    ['Кинжал', 'finesse', 0, '1d4', null],
    ['Копьё', 'strength', 3, '1d6', 'piercing'],
  ]);
  assert.equal(await repairLssWeapons(db), 0, 'a second run changes nothing');

  const plain = await request('POST', `/campaigns/${campaignId}/characters`, gm.token, {kind: 'character', name: 'Обычный'});
  assert.equal(plain.statusCode, 201, plain.body);
  await pg.query(`INSERT INTO character_weapons (campaign_id, character_id, name, ability, proficient, attack_bonus, damage_formula)
    VALUES ($1, $2, 'Атака Рапирой', 'strength', true, -6, NULL)`, [campaignId, plain.json().id]);
  assert.equal(await repairLssWeapons(db), 0);
});
