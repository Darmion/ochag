import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('an area spell cannot be placed behind a closed door', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000});
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
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_door', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Дверь'})).json().id;
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Две комнаты', widthCells: 14, heightCells: 6})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const mage = (await request('POST', `${base}/characters`, gm.token, {kind: 'character', name: 'Волшебница', hpMax: 40, hpCurrent: 40, level: 5, intelligence: 18})).json();
  const goblin = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 500, hpCurrent: 500})).json();
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: mage.id, x: -6.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 3.5, z: 0.5});
  await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,3,9,9)`, [campaignId, mage.id]);
  const entry = (await request('POST', `${base}/characters/${mage.id}/spells`, gm.token, {source: 'srd', srdIndex: 'fireball'})).json().id as string;

  const door = await request('POST', `${scenePath}/walls`, gm.token, {x1: 0, z1: -3, x2: 0, z2: 3, kind: 'door'});
  assert.equal(door.statusCode, 201, door.body);
  const doorId = door.json().id as string;

  const fireball = async () => {
    const templateId = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: 3.5, z: 0.5, direction: 0, sizeFeet: 20, label: 'Огненный шар'})).json().id;
    const cast = await request('POST', `${base}/characters/${mage.id}/spells/${entry}/cast`, gm.token, {sceneId, templateId, slotLevel: 3});
    assert.ok(cast.statusCode < 300, cast.body);
    const template = (await pg.query<any>('SELECT x, z FROM scene_templates WHERE id=$1', [templateId])).rows[0];
    return {json: cast.json(), template};
  };

  await t.test('a closed door: the point comes into being on the near side; the goblin behind it is not hit', async () => {
    const {json, template} = await fireball();
    assert.ok(json.areaBlocked, 'the point was moved');
    assert.ok(template.x < 0 && template.x > -0.5, `the area moved to the door: x = ${template.x}`);
    assert.ok(!json.targets.some((entry: any) => entry.characterId === goblin.id), JSON.stringify(json.targets.map((entry: any) => entry.name)));
  });

  await t.test('the cover rule off does not open the door for an area', async () => {
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'cover','flag','Укрытие','false'::jsonb,$2)`, [campaignId, gm.user.id]);
    const {json} = await fireball();
    assert.ok(!json.targets.some((entry: any) => entry.characterId === goblin.id));
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='cover'`, [campaignId]);
  });

  await t.test('the door open: the point stays where it was put and the goblin is hit', async () => {
    assert.equal((await request('PATCH', `${scenePath}/walls/${doorId}`, gm.token, {open: true})).statusCode, 200);
    const {json, template} = await fireball();
    assert.equal(json.areaBlocked, undefined);
    assert.equal(Number(template.x), 3.5);
    assert.ok(json.targets.some((entry: any) => entry.characterId === goblin.id), JSON.stringify(json.targets.map((entry: any) => entry.name)));
  });
});
