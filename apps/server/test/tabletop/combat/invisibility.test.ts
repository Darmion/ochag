import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('invisibility on the table', async t => {
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
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();
  const gm = await register('gm_invis'), alice = await register('alice_invis'), bob = await register('bob_invis');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Invisible'})).json().id;
  for (const player of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', player.token, {code});
  }
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Зал', widthCells: 12, heightCells: 6})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const create = async (token: string, body: any) => (await request('POST', `${base}/characters`, token, body)).json();
  const place = async (token: string, characterId: string, x: number, z: number) =>
    (await request('POST', `${scenePath}/objects`, token, {characterId, x, z})).json().id as string;
  const learn = async (token: string, characterId: string, srdIndex: string) => {
    const made = await request('POST', `${base}/characters/${characterId}/spells`, token, {source: 'srd', srdIndex});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const slots = (characterId: string, level: number, count: number) =>
    pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,$3,$4,$4)', [campaignId, characterId, level, count]);
  const sees = async (token: string, characterId: string) =>
    (await request('GET', scenePath, token)).json().objects.some((o: any) => o.character_id === characterId);
  const effects = async (characterId: string) =>
    (await pg.query<any>(`SELECT effect_code FROM character_effects WHERE character_id=$1 AND active ORDER BY effect_code`, [characterId])).rows.map((row: any) => row.effect_code);

  const lira = await create(alice.token, {kind: 'character', name: 'Лира', hpMax: 100, hpCurrent: 100});
  const shade = await create(alice.token, {kind: 'character', name: 'Тень', hpMax: 20, hpCurrent: 20});
  const borin = await create(bob.token, {kind: 'character', name: 'Борин', hpMax: 30, hpCurrent: 30});
  const goblin = await create(gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 30, hpCurrent: 30});
  await place(alice.token, lira.id, -2.5, 0.5);
  await place(alice.token, shade.id, -4.5, 2.5);
  await place(bob.token, borin.id, -3.5, -1.5);
  await place(gm.token, goblin.id, 2.5, 0.5);
  const knife = (await request('POST', `${base}/characters/${goblin.id}/weapons`, gm.token, {name: 'Нож', ability: 'strength', proficient: false, damageFormula: '1d1', rangeFeet: 60})).json();
  const apply = (targetIds: string[], code: string) => request('POST', `${base}/conditions/apply`, gm.token, {targetIds, code});

  await t.test('an invisible enemy is gone for the players, not for the GM; an invisible ally is still seen by the party', async () => {
    assert.equal((await apply([goblin.id, shade.id], 'invisible')).statusCode, 200);
    assert.equal(await sees(alice.token, goblin.id), false, 'alice does not see the goblin');
    assert.equal(await sees(bob.token, goblin.id), false);
    assert.equal(await sees(gm.token, goblin.id), true, 'the GM sees everything');
    assert.equal(await sees(alice.token, shade.id), true, 'her own invisible character');
    assert.equal(await sees(bob.token, shade.id), true, 'an invisible ally is not hidden from the party');
  });

  await t.test('truesight and blindsight within range see it; a wall stops them', async () => {
    await pg.query(`UPDATE characters SET sheet_extra = sheet_extra || '{"truesightFeet": 20}'::jsonb WHERE id=$1`, [lira.id]);
    assert.equal(await sees(alice.token, goblin.id), false, 'truesight 20 ft — too short');
    await pg.query(`UPDATE characters SET sheet_extra = sheet_extra || '{"truesightFeet": 30}'::jsonb WHERE id=$1`, [lira.id]);
    assert.equal(await sees(alice.token, goblin.id), true, 'truesight 30 ft');
    assert.equal(await sees(bob.token, goblin.id), true, 'party vision: bob sees through her eyes');
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'party_vision','flag','Обзор отряда','false'::jsonb,$2)`, [campaignId, gm.user.id]);
    assert.equal(await sees(bob.token, goblin.id), false, 'without party vision bob looks with his own eyes');
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='party_vision'`, [campaignId]);
    const wall = (await request('POST', `${scenePath}/walls`, gm.token, {x1: 0, z1: -3, x2: 0, z2: 3})).json();
    assert.equal(await sees(alice.token, goblin.id), false, 'not through a wall');
    await request('DELETE', `${scenePath}/walls/${wall.id}`, gm.token);
    await pg.query(`UPDATE characters SET sheet_extra = (sheet_extra - 'truesightFeet') || '{"blindsightFeet": 30}'::jsonb WHERE id=$1`, [lira.id]);
    await apply([lira.id], 'blinded');
    assert.equal(await sees(alice.token, goblin.id), true, 'blindsight needs no eyes');
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code='blinded'`, [lira.id]);
    await pg.query(`UPDATE characters SET sheet_extra = sheet_extra - 'blindsightFeet' WHERE id=$1`, [lira.id]);
  });

  await t.test('See Invisibility: she sees it, and its attacks on her lose the advantage', async () => {
    const attack = async () => (await request('POST', `${base}/rolls/check`, gm.token, {characterId: goblin.id, kind: 'attack', key: knife.id, targetCharacterId: lira.id, sceneId})).json();
    assert.equal((await attack()).outcome.advantage, 'adv', 'unseen attacker');
    const seeInvisible = await learn(alice.token, lira.id, 'see-invisibility');
    await slots(lira.id, 2, 2);
    const cast = await request('POST', `${base}/characters/${lira.id}/spells/${seeInvisible}/cast`, alice.token, {sceneId});
    assert.equal(cast.statusCode, 201, cast.body);
    assert.ok((await effects(lira.id)).includes('see_invisibility'));
    assert.equal(await sees(alice.token, goblin.id), true);
    assert.equal((await attack()).outcome.advantage, 'none', 'she sees it coming');
  });

  await t.test('the Invisibility spell: on the target, ended by attacking, and by the end of concentration', async () => {
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code='invisible'`, [goblin.id]);
    const mage = await create(gm.token, {kind: 'npc', name: 'Маг', disposition: 'hostile', hpMax: 30, hpCurrent: 30});
    await place(gm.token, mage.id, 3.5, 1.5);
    const invisibility = await learn(gm.token, mage.id, 'invisibility');
    await slots(mage.id, 2, 4);
    const onGoblin = await request('POST', `${base}/characters/${mage.id}/spells/${invisibility}/cast`, gm.token, {targetIds: [goblin.id], sceneId});
    assert.equal(onGoblin.statusCode, 201, onGoblin.body);
    assert.ok((await effects(goblin.id)).includes('invisible'), 'the goblin is invisible');
    assert.ok((await effects(mage.id)).includes('concentration'));

    await request('POST', `${base}/characters/${mage.id}/spells/${invisibility}/cast`, gm.token, {sceneId});
    assert.equal((await effects(goblin.id)).includes('invisible'), false, 'concentration ended — so did the goblin’s invisibility');
    assert.ok((await effects(mage.id)).includes('invisible'), 'now the mage is invisible');

    const dagger = (await request('POST', `${base}/characters/${mage.id}/weapons`, gm.token, {name: 'Кинжал', ability: 'strength', proficient: false, damageFormula: '1d1', rangeFeet: 60})).json();
    const struck = await request('POST', `${base}/rolls/check`, gm.token, {characterId: mage.id, kind: 'attack', key: dagger.id, targetCharacterId: lira.id, sceneId});
    assert.equal(struck.statusCode, 201, struck.body);
    assert.equal((await effects(mage.id)).includes('invisible'), false, 'attacking ended it');
  });
});
