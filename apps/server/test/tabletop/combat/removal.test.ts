import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('removing placements and deleting campaign objects', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db);
  t.after(() => app.close());

  const request = (method: any, url: string, token?: string, payload?: any) => app.inject({
    method, url,
    ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}),
    ...(payload !== undefined ? {payload} : {}),
  });
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_removal'), owner = await register('owner_removal'), other = await register('other_removal');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Removal'})).json().id;
  for (const player of [owner, other]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', player.token, {code});
  }
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Зал'})).json().id;
  const characterId = (await db.query(`INSERT INTO characters(campaign_id, owner_user_id, name) VALUES($1,$2,'Лиэна') RETURNING id`, [campaignId, owner.user.id])).rows[0]!.id;
  const placementId = (await request('POST', `/campaigns/${campaignId}/scenes/${sceneId}/objects`, owner.token, {characterId})).json().id;
  await db.query(`INSERT INTO character_effects(campaign_id, character_id, effect_code) VALUES($1,$2,'blinded')`, [campaignId, characterId]);
  await db.query(`INSERT INTO character_saves(campaign_id, character_id, ability, proficient) VALUES($1,$2,'dexterity',true)`, [campaignId, characterId]);
  await db.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES($1,$2,1,2,2)`, [campaignId, characterId]);
  await db.query(`INSERT INTO character_weapons(campaign_id, character_id, name, ability) VALUES($1,$2,'Меч','strength')`, [campaignId, characterId]);
  await db.query(`INSERT INTO character_field_visibility(campaign_id, character_id, field_key, mode) VALUES($1,$2,'strength','hidden')`, [campaignId, characterId]);
  await db.query(`INSERT INTO roll_log(campaign_id, user_id, character_id, formula, dice_results, modifier, total) VALUES($1,$2,$3,'1d20','[12]',0,12)`, [campaignId, owner.user.id, characterId]);
  await db.query(`INSERT INTO initiative_entries(campaign_id, scene_id, character_id, name, score, created_by) VALUES($1,$2,$3,'Лиэна',14,$4)`, [campaignId, sceneId, characterId, gm.user.id]);

  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };

  await t.test('the character list says who may delete', async () => {
    const mine = (await request('GET', `/campaigns/${campaignId}/characters`, owner.token)).json().characters;
    const theirs = (await request('GET', `/campaigns/${campaignId}/characters`, other.token)).json().characters;
    assert.equal(mine.find((c: any) => c.id === characterId).can_delete, true);
    assert.equal(theirs.find((c: any) => c.id === characterId).can_delete, false);
  });

  await t.test('only the owner or a GM removes an object from the scene', async () => {
    assert.equal((await asApp(() => request('DELETE', `/campaigns/${campaignId}/scenes/${sceneId}/objects/${placementId}`, other.token))).statusCode, 403);
    assert.equal((await asApp(() => request('DELETE', `/campaigns/${campaignId}/scenes/${sceneId}/objects/${placementId}`, owner.token))).statusCode, 204);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM scene_objects WHERE id=$1', [placementId])).rows[0]!.n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM characters WHERE id=$1', [characterId])).rows[0]!.n, 1, 'the character stays');
  });

  await t.test('deleting a character removes everything but keeps roll history', async () => {
    await request('POST', `/campaigns/${campaignId}/scenes/${sceneId}/objects`, owner.token, {characterId});
    assert.equal((await asApp(() => request('DELETE', `/campaigns/${campaignId}/characters/${characterId}`, other.token))).statusCode, 403);
    const response = await asApp(() => request('DELETE', `/campaigns/${campaignId}/characters/${characterId}`, gm.token));
    assert.equal(response.statusCode, 204, response.body);

    for (const table of ['scene_objects', 'character_effects', 'character_saves', 'character_spell_slots', 'character_weapons', 'character_field_visibility', 'initiative_entries']) {
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE character_id=$1`, [characterId])).rows[0]!.n, 0, table);
    }
    assert.equal((await db.query('SELECT count(*)::int AS n FROM characters WHERE id=$1', [characterId])).rows[0]!.n, 0);
    assert.deepEqual((await db.query('SELECT character_id, total FROM roll_log WHERE campaign_id=$1', [campaignId])).rows, [{character_id: null, total: 12}]);
    assert.equal((await request('DELETE', `/campaigns/${campaignId}/characters/${characterId}`, gm.token)).statusCode, 404);
  });
});
