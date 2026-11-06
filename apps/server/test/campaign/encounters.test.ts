import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('duplicating objects and saved encounters', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db);
  t.after(() => app.close());

  const request = async (method: any, url: string, token?: string, payload?: any) => {
    await pg.exec('SET ROLE ttrpg_app');
    try {
      return await app.inject({
        method, url,
        ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}),
        ...(payload !== undefined ? {payload} : {}),
      });
    } finally {
      await pg.exec('RESET ROLE');
    }
  };
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_copies'), player = await register('player_copies');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Copies'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', player.token, {code});

  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Лес', widthCells: 6, heightCells: 4})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const characters = `/campaigns/${campaignId}/characters`;

  const goblin = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 7, hpCurrent: 3, armorClass: 15})).json();
  const hero = (await request('POST', characters, player.token, {kind: 'character', name: 'Герой', hpMax: 20})).json();

  const params = [campaignId, goblin.id];
  const effectId = (await db.query(`INSERT INTO character_effects(campaign_id, character_id, effect_code) VALUES($1,$2,'darkvision') RETURNING id`, params)).rows[0]!.id;
  await db.query(`INSERT INTO character_resources(campaign_id, character_id, name, current, max) VALUES($1,$2,'Ярость',0,2)`, params);
  await db.query(`INSERT INTO character_skills(campaign_id, character_id, skill_index, proficient) VALUES($1,$2,'stealth',true)`, params);
  await db.query(`INSERT INTO character_saves(campaign_id, character_id, ability, proficient) VALUES($1,$2,'dexterity',true)`, params);
  await db.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES($1,$2,1,0,3)`, params);
  await db.query(`INSERT INTO character_weapons(campaign_id, character_id, name, ability) VALUES($1,$2,'Скимитар','dexterity')`, params);
  await db.query(`INSERT INTO character_field_visibility(campaign_id, character_id, field_key, mode) VALUES($1,$2,$3,'allowlist')`, [...params, `effect:${effectId}`]);
  await db.query(`INSERT INTO character_field_visibility_grants(campaign_id, character_id, field_key, user_id) VALUES($1,$2,$3,$4)`, [...params, `effect:${effectId}`, player.user.id]);
  await db.query(`INSERT INTO character_access_grants(campaign_id, character_id, user_id, level, granted_by) VALUES($1,$2,$3,'edit',$4)`, [...params, player.user.id, gm.user.id]);

  const goblinPlacement = (await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: -2.5, z: -1.5, rotationY: 90})).json().id;
  const heroPlacement = (await request('POST', `${scenePath}/objects`, player.token, {characterId: hero.id, x: 2.5, z: 1.5})).json().id;

  const sheetOf = async (characterId: string) => {
    const one = async (sql: string) => (await db.query(sql, [campaignId, characterId])).rows;
    const [character] = await one('SELECT name, kind, disposition, hp_current, hp_max, hp_temp, armor_class FROM characters WHERE campaign_id=$1 AND id=$2');
    return {
      character,
      effects: await one('SELECT id, effect_code FROM character_effects WHERE campaign_id=$1 AND character_id=$2'),
      resources: await one('SELECT name, current, max FROM character_resources WHERE campaign_id=$1 AND character_id=$2'),
      skills: await one('SELECT skill_index, proficient FROM character_skills WHERE campaign_id=$1 AND character_id=$2'),
      saves: await one('SELECT ability, proficient FROM character_saves WHERE campaign_id=$1 AND character_id=$2'),
      slots: await one('SELECT level, current, max FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2'),
      weapons: await one('SELECT name, ability FROM character_weapons WHERE campaign_id=$1 AND character_id=$2'),
      visibility: await one(`SELECT v.field_key, v.mode, g.user_id FROM character_field_visibility v
        LEFT JOIN character_field_visibility_grants g USING (campaign_id, character_id, field_key)
        WHERE v.campaign_id=$1 AND v.character_id=$2`),
      access: await one('SELECT user_id, level FROM character_access_grants WHERE campaign_id=$1 AND character_id=$2'),
    };
  };

  const sceneObjects = async () => (await request('GET', scenePath, gm.token)).json().objects as any[];

  await t.test('only a GM copies, and never a player character', async () => {
    assert.equal((await request('POST', `${characters}/${goblin.id}/duplicate`, player.token, {count: 1})).statusCode, 403);
    const pc = await request('POST', `${characters}/${hero.id}/duplicate`, gm.token, {count: 1});
    assert.equal(pc.statusCode, 400);
    assert.match(pc.json().message, /игрока/);
    assert.equal((await request('POST', `${characters}/${goblin.id}/duplicate`, gm.token, {count: 21})).statusCode, 400);
  });

  let copyPlacementId = '';

  await t.test('«Goblin ×3»: numbered copies with full hit points next to the original', async () => {
    const response = await request('POST', `${characters}/${goblin.id}/duplicate`, gm.token, {count: 3, sceneId});
    assert.equal(response.statusCode, 201, response.body);
    const result = response.json();
    assert.deepEqual(result.characters.map((c: any) => c.name), ['Гоблин 2', 'Гоблин 3', 'Гоблин 4']);

    const spots = result.placements.map((p: any) => `${p.x}:${p.z}`).sort();
    assert.deepEqual(spots, ['-1.5:-0.5', '-1.5:-1.5', '-2.5:-0.5']);
    copyPlacementId = result.placements.find((p: any) => p.x === -1.5 && p.z === -1.5).id;

    const placed = await sceneObjects();
    for (const copy of result.characters) {
      const object = placed.find(o => o.character_id === copy.id);
      assert.ok(object, `${copy.name} stands on the scene`);
      assert.equal(object.rotation_y, 90);
      assert.equal(object.disposition, 'hostile');
    }

    const original = await sheetOf(goblin.id);
    const copy = await sheetOf(result.characters[0].id);
    assert.deepEqual(copy.character, {name: 'Гоблин 2', kind: 'npc', disposition: 'hostile', hp_current: 7, hp_max: 7, hp_temp: 0, armor_class: 15});
    assert.equal(original.character.hp_current, 3, 'the original keeps its wounds');
    assert.deepEqual(copy.resources, [{name: 'Ярость', current: 2, max: 2}]);
    assert.deepEqual(copy.slots, [{level: 1, current: 3, max: 3}]);
    assert.deepEqual(copy.skills, original.skills);
    assert.deepEqual(copy.saves, original.saves);
    assert.deepEqual(copy.weapons, original.weapons);
    assert.deepEqual(copy.access, [{user_id: player.user.id, level: 'edit'}]);

    assert.equal(copy.effects.length, 1);
    assert.notEqual(copy.effects[0].id, effectId);
    assert.deepEqual(copy.visibility, [{field_key: `effect:${copy.effects[0].id}`, mode: 'allowlist', user_id: player.user.id}]);
  });

  await t.test('without a scene the copy only joins the campaign', async () => {
    const result = (await request('POST', `${characters}/${goblin.id}/duplicate`, gm.token, {count: 1})).json();
    assert.deepEqual(result.characters.map((c: any) => c.name), ['Гоблин 5']);
    assert.deepEqual(result.placements, []);
  });

  await t.test('copies need a free cell and the original on that scene', async () => {
    const otherScene = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Пусто'})).json().id;
    const response = await request('POST', `${characters}/${goblin.id}/duplicate`, gm.token, {count: 1, sceneId: otherScene});
    assert.equal(response.statusCode, 400);

    const crowded = await request('POST', `${characters}/${goblin.id}/duplicate`, gm.token, {count: 20, sceneId});
    assert.equal(crowded.statusCode, 400);
    assert.match(crowded.json().message, /свободных клеток/);
  });

  let encounterId = '';

  await t.test('a saved encounter keeps NPCs with their layout, not player characters', async () => {
    assert.equal((await request('GET', `/campaigns/${campaignId}/encounters`, player.token)).statusCode, 403);

    const withHero = await request('POST', `/campaigns/${campaignId}/encounters`, gm.token, {name: 'Засада', sceneId, objectIds: [goblinPlacement, heroPlacement]});
    assert.equal(withHero.statusCode, 400);

    const saved = await request('POST', `/campaigns/${campaignId}/encounters`, gm.token, {name: 'Засада', sceneId, objectIds: [goblinPlacement, copyPlacementId]});
    assert.equal(saved.statusCode, 201, saved.body);
    encounterId = saved.json().id;

    assert.deepEqual(saved.json().members.map((m: any) => [m.name, m.dx, m.dz]), [['Гоблин', -1, 0], ['Гоблин 2', 0, 0]]);
    assert.deepEqual((await request('GET', `/campaigns/${campaignId}/encounters`, gm.token)).json().map((e: any) => e.name), ['Засада']);
  });

  await t.test('the encounter outlives the objects it was saved from and deploys fresh copies', async () => {
    assert.equal((await request('DELETE', `${characters}/${goblin.id}`, gm.token)).statusCode, 204);

    const deployed = await request('POST', `/campaigns/${campaignId}/encounters/${encounterId}/deploy`, gm.token, {sceneId, x: 1.5, z: 0.5});
    assert.equal(deployed.statusCode, 201, deployed.body);
    const result = deployed.json();
    assert.deepEqual(result.characters.map((c: any) => c.name), ['Гоблин 6', 'Гоблин 7']);
    assert.deepEqual(result.placements.map((p: any) => [p.x, p.z]), [[0.5, 0.5], [1.5, 0.5]]);

    const fresh = await sheetOf(result.characters[0].id);
    assert.equal(fresh.character.hp_current, 7);
    assert.equal(fresh.effects.length, 1);

    const edge = (await request('POST', `/campaigns/${campaignId}/encounters/${encounterId}/deploy`, gm.token, {sceneId, x: -2.5, z: 1.5})).json();
    assert.deepEqual(edge.placements.map((p: any) => [p.x, p.z]), [[-2.5, 1.5], [-2.5, 1.5]]);
  });

  await t.test('deleting an encounter', async () => {
    assert.equal((await request('DELETE', `/campaigns/${campaignId}/encounters/${encounterId}`, player.token)).statusCode, 403);
    assert.equal((await request('DELETE', `/campaigns/${campaignId}/encounters/${encounterId}`, gm.token)).statusCode, 204);
    assert.deepEqual((await request('GET', `/campaigns/${campaignId}/encounters`, gm.token)).json(), []);
    assert.equal((await request('DELETE', `/campaigns/${campaignId}/encounters/${encounterId}`, gm.token)).statusCode, 404);
  });
});
