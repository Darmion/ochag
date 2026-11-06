import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('combat leftovers', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  let app = await buildApp(db, {rateMax: 100_000});
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

  const gm = await register('gm_left'), alice = await register('alice_left');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Leftovers'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Двор', widthCells: 12, heightCells: 12})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const initiative = `${scenePath}/initiative`;

  const hero = (await request('POST', `${base}/characters`, alice.token, {
    kind: 'character', name: 'Лира', dexterity: 14, constitution: 12, hpMax: 30, hpCurrent: 30, armorClass: 14, speedFeet: 30, level: 3,
  })).json();
  const ogre = (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name: 'Огр', disposition: 'hostile', strength: 18, dexterity: 8, hpMax: 60, hpCurrent: 60, armorClass: 1, speedFeet: 30,
  })).json();
  const placeAt = async (characterId: string, x: number, z: number) => {
    const existing = (await pg.query<any>('SELECT id FROM scene_objects WHERE character_id=$1', [characterId])).rows[0];
    if (existing) await pg.query('UPDATE scene_objects SET x=$2, z=$3 WHERE id=$1', [existing.id, x, z]);
    else assert.equal((await request('POST', `${scenePath}/objects`, gm.token, {characterId, x, z})).statusCode, 201);
  };
  const effects = async (id: string) => (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active', [id])).rows.map(row => row.effect_code);
  const dropWalls = () => pg.query('DELETE FROM scene_walls WHERE scene_id=$1', [sceneId]);
  const wall = async (x1: number, z1: number, x2: number, z2: number) =>
    assert.equal((await request('POST', `${scenePath}/walls`, gm.token, {x1, z1, x2, z2})).statusCode, 201);

  const fireball = async () => (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: 0.5, z: 0.5, sizeFeet: 20, label: 'Шар'})).json().id as string;
  const saves = async (templateId: string, ability = 'dexterity') => {
    const response = await request('POST', `${scenePath}/templates/${templateId}/saves`, gm.token, {ability, dc: 10});
    assert.equal(response.statusCode, 200, response.body);
    return response.json().results as any[];
  };
  const rollOf = async (id: string) => (await pg.query<any>('SELECT modifier, outcome FROM roll_log WHERE id=$1', [id])).rows[0];

  await t.test('area cover: a wall between the point of origin and the creature — +2 or +5 to DEX saves; total cover keeps it out', async () => {
    await placeAt(hero.id, 3.5, 1.5);
    await placeAt(ogre.id, -5.5, -5.5);
    const templateId = await fireball();

    let [lira] = await saves(templateId);
    assert.equal(lira.name, 'Лира');
    assert.equal(lira.cover, undefined, 'open field');
    assert.equal((await rollOf(lira.rollId)).modifier, 2, 'DEX 14');

    await wall(2, 1, 2, 3);
    [lira] = await saves(templateId);
    assert.equal(lira.cover, 'half');
    let roll = await rollOf(lira.rollId);
    assert.equal(roll.modifier, 4, 'DEX +2, half cover +2');
    assert.ok(roll.outcome.reasons.includes('укрытие от области: половинное (+2 к спасброску ЛОВ)'), JSON.stringify(roll.outcome));
    const [constitution] = await saves(templateId, 'constitution');
    assert.equal((await rollOf(constitution.rollId)).modifier, 1, 'cover helps DEX saves only');

    await dropWalls();
    await wall(3, 1, 3, 3);
    [lira] = await saves(templateId);
    assert.equal(lira.cover, 'three-quarters');
    assert.equal((await rollOf(lira.rollId)).modifier, 7);

    await dropWalls();
    await wall(2, -6, 2, 6);
    assert.deepEqual(await saves(templateId), [], 'no straight line from the point of origin — not in the area');

    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'cover','flag','Укрытие','false'::jsonb,$2)`, [campaignId, gm.user.id]);
    [lira] = await saves(templateId);
    assert.equal(lira?.cover, undefined, 'cover = false: walls do not matter');
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='cover'`, [campaignId]);
    await dropWalls();
  });

  await t.test('area cover: a creature in between gives half; the caster standing at the point of origin does not', async () => {
    const templateId = await fireball();
    const guard = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Стражник', disposition: 'neutral', hpMax: 10, hpCurrent: 10})).json();
    await placeAt(guard.id, 2.5, 1.5);
    const results = await saves(templateId);
    assert.equal(results.find(entry => entry.name === 'Лира').cover, 'half');
    await pg.query('DELETE FROM scene_objects WHERE character_id=$1', [guard.id]);

    await placeAt(ogre.id, 0.5, 0.5);
    await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,3,2,2)`, [campaignId, ogre.id]);
    const spellId = (await pg.query<any>(
      `INSERT INTO character_spells(campaign_id, character_id, source, srd_index) VALUES ($1,$2,'srd','fireball') RETURNING id`, [campaignId, ogre.id],
    )).rows[0].id;
    let cast = await request('POST', `${base}/characters/${ogre.id}/spells/${spellId}/cast`, gm.token, {templateId, sceneId});
    assert.equal(cast.statusCode, 201, cast.body);
    const lira = cast.json().targets.find((entry: any) => entry.name === 'Лира');
    assert.equal(lira.cover, undefined, 'the ogre at the origin is not in the way');

    await wall(2, 1, 2, 3);
    cast = await request('POST', `${base}/characters/${ogre.id}/spells/${spellId}/cast`, gm.token, {templateId, sceneId});
    assert.equal(cast.json().targets.find((entry: any) => entry.name === 'Лира').cover, 'half');
    await dropWalls();
    await pg.query('UPDATE characters SET hp_current=hp_max WHERE id = ANY($1::uuid[])', [[hero.id, ogre.id]]);
    await pg.query('DELETE FROM character_effects WHERE character_id = ANY($1::uuid[])', [[hero.id, ogre.id]]);
  });

  const grapple = (body: any = {}) => request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [hero.id], code: 'grappled', sourceCharacterId: ogre.id, ...body});
  const place = async (characterId: string) => (await request('GET', scenePath, gm.token)).json().objects.find((object: any) => object.character_id === characterId);
  const move = async (characterId: string, x: number, z: number) => {
    const current = await place(characterId);
    return request('PUT', `${scenePath}/objects/${current.id}`, gm.token, {
      x, y: current.y, z, rotationY: current.rotation_y, scale: current.scale, snapToGrid: current.snap_to_grid,
      parentObjectId: null, animationName: current.animation_name, revision: current.revision,
    });
  };

  await t.test('grapple ends by itself when the grappler is incapacitated', async () => {
    await placeAt(hero.id, 0.5, 0.5);
    await placeAt(ogre.id, 1.5, 0.5);
    assert.equal((await grapple()).statusCode, 200);
    assert.ok((await effects(hero.id)).includes('grappled'));

    const stunned = await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [ogre.id], code: 'stunned'});
    assert.equal(stunned.statusCode, 200, stunned.body);
    assert.ok(!(await effects(hero.id)).includes('grappled'), 'a stunned ogre lets go');
    assert.match((await grapple()).json().message, /не может схватить: /, 'nor can it grab anyone');
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [ogre.id]);

    assert.equal((await grapple()).statusCode, 200);
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: '1d1+99'})).json();
    const hit = await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId: ogre.id, mode: 'damage'});
    assert.equal(hit.statusCode, 200, hit.body);
    assert.ok(!(await effects(hero.id)).includes('grappled'), 'a fallen ogre holds nobody');
    assert.ok(hit.json().notices.some((notice: any) => notice.title === 'Лира больше не схвачен'), JSON.stringify(hit.json().notices));
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [ogre.id]);
    await pg.query('UPDATE characters SET hp_current=hp_max WHERE id=$1', [ogre.id]);
  });

  await t.test('grapple ends by itself when either of them ends up out of reach', async () => {
    assert.equal((await grapple()).statusCode, 200);
    const heroBefore = await place(hero.id);
    assert.equal((await move(ogre.id, 2.5, 0.5)).statusCode, 200);
    assert.ok((await effects(hero.id)).includes('grappled'), 'the ogre walks off dragging her along');
    assert.equal((await place(hero.id)).x, heroBefore.x + 1, 'she moved one cell with him');
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'gm_free_move','flag','Свободно','true'::jsonb,$2)`, [campaignId, gm.user.id]);
    assert.equal((await move(ogre.id, 4.5, 0.5)).statusCode, 200);
    assert.ok(!(await effects(hero.id)).includes('grappled'), 'teleported away — 10 feet, no longer held');
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='gm_free_move'`, [campaignId]);
    await placeAt(hero.id, heroBefore.x, heroBefore.z);

    assert.equal((await move(ogre.id, 1.5, 0.5)).statusCode, 200);
    assert.equal((await grapple()).statusCode, 200);
    assert.equal((await move(ogre.id, 1.5, 1.5)).statusCode, 200);
    assert.ok((await effects(hero.id)).includes('grappled'), 'still next to her (diagonal)');
    assert.equal((await move(hero.id, -1.5, 0.5)).statusCode, 200, 'the GM drags her away');
    assert.ok(!(await effects(hero.id)).includes('grappled'));

    await request('POST', `${base}/characters/${ogre.id}/weapons`, gm.token, {name: 'Щупальце', ability: 'strength', rangeFeet: 10, damageFormula: '1d1'});
    await placeAt(hero.id, 0.5, 0.5);
    await placeAt(ogre.id, 1.5, 0.5);
    assert.equal((await grapple()).statusCode, 200);
    assert.equal((await move(ogre.id, 2.5, 0.5)).statusCode, 200);
    assert.ok((await effects(hero.id)).includes('grappled'), '10-foot reach');
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [hero.id]);
    await placeAt(ogre.id, 1.5, 0.5);
  });

  await t.test('combat summary counts damage and healing applied with the log buttons — and hidden rolls', async () => {
    await request('POST', `${initiative}/start`, gm.token, {});
    const roll = (await request('POST', `${base}/rolls`, alice.token, {formula: '1d1+6', characterId: hero.id})).json();
    assert.equal((await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId: ogre.id, mode: 'damage'})).statusCode, 200);
    const heal = (await request('POST', `${base}/rolls`, alice.token, {formula: '1d1+2', characterId: hero.id})).json();
    await pg.query('UPDATE characters SET hp_current=20 WHERE id=$1', [hero.id]);
    assert.equal((await request('POST', `${base}/rolls/${heal.id}/apply`, gm.token, {characterId: hero.id, mode: 'heal'})).statusCode, 200);
    const secret = (await request('POST', `${base}/rolls`, gm.token, {formula: '1d1+40', characterId: ogre.id, hidden: true})).json();
    assert.equal((await request('POST', `${base}/rolls/${secret.id}/apply`, gm.token, {characterId: hero.id, mode: 'damage'})).statusCode, 200);
    const stored = (await pg.query<any>('SELECT mode, applied, dropped FROM roll_applications WHERE roll_id=$1', [roll.id])).rows[0];
    assert.deepEqual(stored, {mode: 'damage', applied: 7, dropped: false});

    assert.equal((await request('DELETE', initiative, gm.token)).statusCode, 204);
    const summary = (await request('GET', `${scenePath}/combat-summary`, alice.token)).json().summary;
    const lira = summary.participants.find((entry: any) => entry.name === 'Лира');
    const enemy = summary.participants.find((entry: any) => entry.name === 'Огр');
    assert.deepEqual([lira.damageDealt, lira.healing, enemy.damageTaken], [7, 3, 7]);
    assert.deepEqual([lira.damageTaken, enemy.damageDealt], [41, 41], 'the hidden roll counts too (numbers only)');
  });

  await t.test('an opportunity attack survives a server restart and is gone after the turn passes', async () => {
    await pg.query('UPDATE characters SET hp_current=hp_max, death_successes=0, death_failures=0 WHERE id = ANY($1::uuid[])', [[hero.id, ogre.id]]);
    await pg.query('DELETE FROM character_effects WHERE character_id = ANY($1::uuid[])', [[hero.id, ogre.id]]);
    await placeAt(hero.id, 0.5, 0.5);
    await placeAt(ogre.id, 1.5, 0.5);
    await request('POST', `${base}/rules`, gm.token, {key: 'npc_opportunity', kind: 'flag', label: 'НПС сами', value: false});
    await request('POST', `${initiative}/start`, gm.token, {});
    await pg.query(`UPDATE initiative_entries SET is_current = (character_id = $2), reaction_used=false WHERE scene_id=$1`, [sceneId, hero.id]);
    const current = await place(hero.id);
    const walked = await request('PUT', `${scenePath}/objects/${current.id}`, alice.token, {
      x: -1.5, y: current.y, z: 0.5, rotationY: current.rotation_y, scale: current.scale, snapToGrid: current.snap_to_grid,
      parentObjectId: null, animationName: current.animation_name, revision: current.revision,
    });
    assert.equal(walked.statusCode, 200, walked.body);
    assert.equal((await pg.query<any>('SELECT count(*)::int AS n FROM scene_opportunities WHERE scene_id=$1', [sceneId])).rows[0].n, 1);

    await app.close();
    app = await buildApp(db, {rateMax: 100_000});
    const club = (await request('POST', `${base}/characters/${ogre.id}/weapons`, gm.token, {name: 'Дубина', ability: 'strength', proficient: false, damageFormula: '1d1'})).json();
    const strike = () => request('POST', `${base}/rolls/check`, gm.token, {characterId: ogre.id, kind: 'attack', key: club.id, targetCharacterId: hero.id, sceneId, opportunity: true});
    const swing = await strike();
    assert.equal(swing.statusCode, 201, swing.body);
    assert.match((await strike()).json().message, /Атаки при уходе нет/, 'one per leaving');

    await pg.query(`UPDATE initiative_entries SET reaction_used=false WHERE scene_id=$1`, [sceneId]);
    await pg.query(`INSERT INTO scene_opportunities (campaign_id, scene_id, reactor_id, mover_id, reactor_name, mover_name) VALUES ($1,$2,$3,$4,'Огр','Лира')`, [campaignId, sceneId, ogre.id, hero.id]);
    await request('POST', `${initiative}/advance`, gm.token);
    assert.equal((await pg.query<any>('SELECT count(*)::int AS n FROM scene_opportunities WHERE scene_id=$1', [sceneId])).rows[0].n, 0);
    await request('DELETE', initiative, gm.token);
  });
});
