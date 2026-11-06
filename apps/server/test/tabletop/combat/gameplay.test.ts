import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('gameplay automation', async t => {
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
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_play'), alice = await register('alice_play');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Play'})).json().id;
  await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'hostile_blocks','flag','Сквозь врагов','false'::jsonb,$2)`, [campaignId, gm.user.id]);
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Арена', widthCells: 10, heightCells: 10})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const hero = (await request('POST', `${base}/characters`, alice.token, {
    kind: 'character', name: 'Лира', dexterity: 14, hpMax: 20, hpCurrent: 20, armorClass: 14, speedFeet: 30,
  })).json();
  const goblin = (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name: 'Гоблин', disposition: 'hostile', dexterity: 14, hpMax: 40, hpCurrent: 40, armorClass: 1, speedFeet: 30,
  })).json();
  const corpse = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Павший', disposition: 'hostile', hpMax: 5, hpCurrent: 0})).json();
  const chest = (await request('POST', `${base}/characters`, gm.token, {kind: 'object', name: 'Сундук'})).json();
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: 0.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 1.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: corpse.id, x: 3.5, z: 3.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: chest.id, x: -3.5, z: -3.5});
  await pg.query(`INSERT INTO character_effects(campaign_id, character_id, effect_code) VALUES ($1,$2,'dead')`, [campaignId, corpse.id]);

  const initiative = `${scenePath}/initiative`;
  await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'action_economy','flag','Экономия действий','false'::jsonb,$2)`, [campaignId, gm.user.id]);
  const hp = async (id: string) => (await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current;
  const setHp = (id: string, value: number) => pg.query('UPDATE characters SET hp_current=$2 WHERE id=$1', [id, value]);

  await t.test('6.1: the GM starts combat for every creature on the scene at once', async () => {
    assert.equal((await request('POST', `${initiative}/start`, alice.token, {})).statusCode, 403);
    const started = await request('POST', `${initiative}/start`, gm.token, {});
    assert.equal(started.statusCode, 201, started.body);
    assert.deepEqual(started.json().joined.map((entry: any) => entry.name).sort(), ['Гоблин', 'Лира'], 'not the dead, not the chest');
    assert.equal(started.json().started, true);
    const state = (await request('GET', initiative, gm.token)).json();
    assert.equal(state.combatRound, 1);
    const current = state.entries.find((entry: any) => entry.is_current);
    assert.equal(current.id, state.entries[0].id, 'the highest score acts first');
    const rolls = (await request('GET', `${base}/rolls`, gm.token)).json().rolls.filter((roll: any) => roll.label.startsWith('Инициатива'));
    assert.equal(rolls.length, 2);

    const again = (await request('POST', `${initiative}/start`, gm.token, {})).json();
    assert.deepEqual(again, {joined: [], started: false}, 'everyone is already in, the turn stays');
    await request('DELETE', initiative, gm.token);
  });

  const weapons = `${base}/characters/${hero.id}/weapons`;

  await t.test('6.2: weapons keep a damage formula, type and range; bad formulas are refused', async () => {
    const bad = await request('POST', weapons, alice.token, {name: 'Палка', ability: 'strength', damageFormula: 'много'});
    assert.equal(bad.statusCode, 400);
    assert.match(bad.json().message, /Формула урона/);
    const created = await request('POST', weapons, alice.token, {name: 'Кинжал', ability: 'dexterity', proficient: false, damageFormula: '1d1+@dex', damageType: 'piercing'});
    assert.equal(created.statusCode, 201, created.body);
    assert.deepEqual([created.json().damage_formula, created.json().damage_type, created.json().range_feet], ['1d1+@dex', 'piercing', 5]);
    const bow = (await request('POST', weapons, alice.token, {name: 'Лук', ability: 'dexterity', damageFormula: '1d6+@dex', damageType: 'piercing', rangeFeet: 80})).json();
    const patched = await request('PATCH', `${weapons}/${bow.id}`, alice.token, {damageFormula: null, rangeFeet: 150});
    assert.deepEqual([patched.json().damage_formula, patched.json().range_feet], [null, 150]);
  });

  const dagger = async () => (await pg.query<any>(`SELECT id FROM character_weapons WHERE character_id=$1 AND name='Кинжал'`, [hero.id])).rows[0].id;
  const hit = async () => {
    const key = await dagger();
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'attack', key, targetCharacterId: goblin.id, sceneId});
      assert.equal(response.statusCode, 201, response.body);
      if (response.json().outcome.hit) return response.json();
      assert.equal(response.json().damage, null, 'a miss deals no damage');
    }
    throw new Error('no hit in 12 attacks');
  };

  await t.test('6.2: a hit rolls and applies the weapon damage by itself', async () => {
    await setHp(goblin.id, 40);
    const result = await hit();
    const expected = result.outcome.critical ? 4 : 3;
    assert.equal(result.damage.applied, expected, '1d1 + DEX 2 (crit — 2d1 + 2)');
    assert.equal(await hp(goblin.id), 40 - expected);
    assert.equal(result.damage.roll.outcome.kind, 'damage');
    assert.equal(result.damage.roll.outcome.damageType, 'piercing');
    assert.match(result.damage.roll.label, /^Урон: Кинжал → Гоблин$/);
  });

  await t.test('6.2: resistances halve, vulnerabilities double, immunities block; petrified resists everything', async () => {
    const goblinSheet = (await request('GET', `${base}/characters/${goblin.id}`, gm.token)).json();
    const set = async (fields: any) => {
      const current = (await request('GET', `${base}/characters/${goblin.id}`, gm.token)).json();
      const response = await request('PATCH', `${base}/characters/${goblin.id}`, gm.token, {revision: current.revision, ...fields});
      assert.equal(response.statusCode, 200, response.body);
    };
    assert.deepEqual(goblinSheet.damage_resistances, []);
    const damageOf = async () => { const r = await hit(); return {applied: r.damage.applied, critical: r.outcome.critical, modified: r.damage.modified, blocked: r.damage.blocked}; };

    await set({damageResistances: ['piercing']});
    let dealt = await damageOf();
    assert.equal(dealt.applied, Math.floor((dealt.critical ? 4 : 3) / 2));
    assert.equal(dealt.modified, 'resisted');

    await set({damageResistances: [], damageVulnerabilities: ['piercing']});
    dealt = await damageOf();
    assert.equal(dealt.applied, (dealt.critical ? 4 : 3) * 2);
    assert.equal(dealt.modified, 'vulnerable');

    await set({damageVulnerabilities: [], damageImmunities: ['piercing']});
    dealt = await damageOf();
    assert.deepEqual([dealt.applied, dealt.blocked], [0, 'immune']);

    await set({damageImmunities: []});
    await pg.query(`INSERT INTO character_effects(campaign_id, character_id, effect_code) VALUES ($1,$2,'petrified')`, [campaignId, goblin.id]);
    dealt = await damageOf();
    assert.equal(dealt.modified, 'resisted', 'petrified: resistance to all damage');
    assert.equal(dealt.applied, Math.floor((dealt.critical ? 4 : 3) / 2));
  });

  await t.test('6.2: the manual damage button honours resistances too; auto_damage = false leaves damage to the GM', async () => {
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [goblin.id]);
    const current = (await request('GET', `${base}/characters/${goblin.id}`, gm.token)).json();
    await request('PATCH', `${base}/characters/${goblin.id}`, gm.token, {revision: current.revision, damageResistances: ['fire'], damageImmunities: [], damageVulnerabilities: []});
    await setHp(goblin.id, 40);
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: '1d1+9'})).json();
    const applied = await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId: goblin.id, mode: 'damage', damageType: 'fire'});
    assert.deepEqual([applied.json().applied, applied.json().modified, await hp(goblin.id)], [5, 'resisted', 35]);

    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'auto_damage','flag','Урон сам','false'::jsonb,$2)`, [campaignId, gm.user.id]);
    const result = await hit();
    assert.equal(result.damage, null);
    assert.equal(await hp(goblin.id), 35);
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='auto_damage'`, [campaignId]);
  });
  const learn = async (srdIndex: string) => (await pg.query<any>(
    `INSERT INTO character_spells(campaign_id, character_id, source, srd_index) VALUES ($1,$2,'srd',$3) RETURNING id`,
    [campaignId, hero.id, srdIndex],
  )).rows[0].id as string;
  const cast = (entryId: string, body: any) => request('POST', `${base}/characters/${hero.id}/spells/${entryId}/cast`, alice.token, body);

  await t.test('6.4: spell attacks hit by AC and deal their damage; cantrips grow with the caster level', async () => {
    await pg.query(`UPDATE characters SET level=5, intelligence=16, spellcasting_ability='intelligence' WHERE id=$1`, [hero.id]);
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [goblin.id]);
    await pg.query(`UPDATE characters SET hp_current=40, damage_resistances='[]', damage_immunities='[]', damage_vulnerabilities='[]' WHERE id=$1`, [goblin.id]);
    const boltId = await learn('fire-bolt');
    let result: any = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await cast(boltId, {targetIds: [goblin.id], sceneId});
      assert.equal(response.statusCode, 201, response.body);
      result = response.json();
      if (result.targets[0].attack.hit) break;
    }
    assert.equal(result.attackBonus, 3 + 3, 'proficiency 3 at level 5 + INT 3');
    assert.equal(result.mechanics.attack, 'ranged');
    assert.ok(result.targets[0].damage > 0);
    assert.match(result.damageRoll.formula, /^(2|4)d10$/, 'level 5: 2d10 (a crit doubles the dice)');
    assert.equal(result.damageRoll.outcome.damageType, 'fire');
  });

  await t.test('6.4: save spells — DEX auto-fail when paralyzed takes the full damage; Hold Person paralyzes on a failed save', async () => {
    const flameId = await learn('sacred-flame');
    await pg.query(`INSERT INTO character_effects(campaign_id, character_id, effect_code) VALUES ($1,$2,'paralyzed')`, [campaignId, goblin.id]);
    const before = await hp(goblin.id);
    const flame = (await cast(flameId, {targetIds: [goblin.id]})).json();
    assert.equal(flame.dc, 8 + 3 + 3);
    assert.deepEqual([flame.targets[0].save.autoFail, flame.targets[0].save.success], [true, false]);
    assert.equal(flame.targets[0].damage, flame.damageRoll.total);
    assert.equal(await hp(goblin.id), before - flame.damageRoll.total);
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [goblin.id]);

    await pg.query(`UPDATE characters SET intelligence=30, wisdom=1 WHERE id=ANY($1::uuid[])`, [[hero.id]]);
    await pg.query(`UPDATE characters SET wisdom=1 WHERE id=$1`, [goblin.id]);
    await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,2,2,2)`, [campaignId, hero.id]);
    const holdId = await learn('hold-person');
    const hold = (await cast(holdId, {targetIds: [goblin.id]})).json();
    assert.equal(hold.dc, 8 + 3 + 10, 'DC 21: WIS 1 cannot reach it');
    assert.equal(hold.targets[0].condition, true);
    const effect = (await pg.query<any>(`SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code='paralyzed'`, [goblin.id])).rows[0];
    assert.deepEqual([effect.parameters.remainingRounds, effect.parameters.repeatSave, effect.parameters.save], [10, 'end', {ability: 'wisdom', dc: 21}]);
    assert.ok(typeof effect.parameters.sourceName === 'string' && effect.parameters.sourceName.length > 0, 'the spell is the source');
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [goblin.id]);
    await pg.query(`UPDATE characters SET intelligence=16 WHERE id=$1`, [hero.id]);
  });

  await t.test('6.4: an area spell hits everyone in the template once — the full roll on a fail, half on a success', async () => {
    await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,3,1,1)`, [campaignId, hero.id]);
    await pg.query(`UPDATE characters SET hp_current=40 WHERE id=$1`, [goblin.id]);
    const templateId = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: 1, z: 1, direction: 0, sizeFeet: 10})).json().id;
    const fireballId = await learn('fireball');
    const response = await cast(fireballId, {templateId, sceneId});
    assert.equal(response.statusCode, 201, response.body);
    const fireball = response.json();
    assert.deepEqual(fireball.targets.map((entry: any) => entry.name).sort(), ['Гоблин', 'Лира']);
    for (const entry of fireball.targets) {
      assert.equal(entry.damage, entry.save.success ? Math.floor(fireball.damageRoll.total / 2) : fireball.damageRoll.total, entry.name);
    }
    assert.match(fireball.damageRoll.formula, /^8d6$/);
    assert.equal((await cast(fireballId, {templateId})).statusCode, 400, 'an area needs its scene');
  });

  await t.test('6.4: healing spells heal their targets with the casting modifier', async () => {
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [hero.id]);
    await pg.query(`UPDATE characters SET hp_current=1, death_successes=0, death_failures=0 WHERE id=$1`, [hero.id]);
    await pg.query(`UPDATE character_spell_slots SET current=2 WHERE character_id=$1 AND level=2`, [hero.id]);
    await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,2,2)`, [campaignId, hero.id]);
    const cureId = await learn('cure-wounds');
    const cureResponse = await cast(cureId, {targetIds: [hero.id]});
    assert.equal(cureResponse.statusCode, 201, cureResponse.body);
    const cure = cureResponse.json();
    assert.match(cure.healingRoll.formula, /^1d8\+3$/, '1d8 + INT 3');
    assert.equal(cure.targets[0].healed, cure.healingRoll.total);
    assert.equal(await hp(hero.id), 1 + cure.healingRoll.total);
  });

  await t.test('6.4: the derived mechanics can be corrected by hand and reset', async () => {
    const corrected = await request('POST', '/srd/spells/fire-bolt/mechanics', gm.token, {damageType: 'cold', conditionCode: 'prone'});
    assert.equal(corrected.statusCode, 200, corrected.body);
    assert.deepEqual([corrected.json().mechanics.damageType, corrected.json().mechanics.condition], ['cold', 'prone']);
    const listed = (await request('GET', '/srd/spells', gm.token)).json().spells.find((spell: any) => spell.index === 'fire-bolt');
    assert.equal(listed.mechanics.damageType, 'cold');
    assert.equal(listed.mechanicsOverrides.conditionCode, 'prone');
    const reset = await request('POST', '/srd/spells/fire-bolt/mechanics', gm.token, {damageType: null, conditionCode: null});
    assert.deepEqual([reset.json().mechanics.damageType, reset.json().mechanics.condition], ['fire', null]);
  });

  await t.test('10.8: a spell flagged createsZone spawns a persistent trigger matching its template — fires on entry, and disappears when concentration ends', async () => {
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [goblin.id]);
    await pg.query(`UPDATE characters SET hp_current=40 WHERE id=$1`, [goblin.id]);
    const mechanics = await request('POST', '/srd/spells/spike-growth/mechanics', gm.token, {
      damageFormula: '2d4', damageType: 'piercing', createsZone: true,
    });
    assert.equal(mechanics.statusCode, 200, mechanics.body);
    assert.equal(mechanics.json().mechanics.createsZone, true);

    await pg.query(
      `INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,2,3,3)
       ON CONFLICT (campaign_id, character_id, level) DO UPDATE SET current=3, max=3`,
      [campaignId, hero.id],
    );
    const spikeId = await learn('spike-growth');
    const templateId = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: 5, z: 5, direction: 0, sizeFeet: 15})).json().id;
    const castResponse = await cast(spikeId, {templateId, sceneId});
    assert.equal(castResponse.statusCode, 201, castResponse.body);

    const triggerOf = async () => (await pg.query<any>(
      `SELECT * FROM scene_triggers WHERE campaign_id=$1 AND scene_id=$2 ORDER BY created_at DESC LIMIT 1`, [campaignId, sceneId],
    )).rows[0];
    const first = await triggerOf();
    assert.ok(first, 'casting with a template spawned a zone trigger');
    assert.equal(first.caster_id, hero.id);
    assert.equal(first.shape, 'circle');
    assert.equal(Number(first.x), 5);
    assert.equal(first.damage_formula, '2d4');
    assert.equal(first.damage_type, 'piercing');
    assert.equal(first.once, false, 'fires every entry, not just the first');
    assert.equal(first.on_turn, true, 'no condition on the spell — bites standing creatures every turn too');
    assert.equal(first.secret, false);

    const goblinPlace = (await pg.query<any>('SELECT id, revision FROM scene_objects WHERE character_id=$1', [goblin.id])).rows[0];
    const before = await hp(goblin.id);
    const moved = await request('PUT', `${scenePath}/objects/${goblinPlace.id}`, gm.token, {
      x: 5, y: 0, z: 5, rotationY: 0, scale: 1, snapToGrid: false, parentObjectId: null, animationName: null, revision: goblinPlace.revision,
    });
    assert.equal(moved.statusCode, 200, moved.body);
    assert.ok(await hp(goblin.id) < before, 'walking into the zone triggered its damage automatically, same as any other scene trigger');

    const templateId2 = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: -5, z: -5, direction: 0, sizeFeet: 15})).json().id;
    const recast = await cast(spikeId, {templateId: templateId2, sceneId});
    assert.equal(recast.statusCode, 201, recast.body);
    assert.equal(recast.json().concentrating.replaced, 'Шипы', 'the Russian SRD name (packages/domain/srd/spells.ru.json)');

    const remaining = (await pg.query<any>('SELECT x, z FROM scene_triggers WHERE campaign_id=$1 AND scene_id=$2', [campaignId, sceneId])).rows;
    assert.equal(remaining.length, 1, 'the old zone is gone, only the new one from the recast is left');
    assert.equal(Number(remaining[0].x), -5);

    const web = await request('POST', '/srd/spells/web/mechanics', gm.token, { createsZone: true });
    assert.equal(web.statusCode, 200, web.body);
    const webId = await learn('web');
    const templateId3 = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: 8, z: 8, direction: 0, sizeFeet: 15})).json().id;
    const webCast = await cast(webId, {templateId: templateId3, sceneId});
    assert.equal(webCast.statusCode, 201, webCast.body);
    const webTrigger = await triggerOf();
    assert.equal(webTrigger.on_turn, false, 'restrained already has its own repeat save — re-triggering on_turn would be redundant');

    await pg.query('DELETE FROM scene_triggers WHERE campaign_id=$1 AND scene_id=$2', [campaignId, sceneId]);
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [hero.id]);
    await pg.query(`UPDATE scene_objects SET x=1.5, z=0.5 WHERE character_id=$1`, [goblin.id]);
    await pg.query(`UPDATE characters SET hp_current=40 WHERE id=$1`, [goblin.id]);
  });

  const heroPlacement = async () => (await pg.query<any>('SELECT id FROM scene_objects WHERE character_id=$1', [hero.id])).rows[0].id as string;
  const reachOf = async (token: string) => request('GET', `${scenePath}/objects/${await heroPlacement()}/reach`, token);
  const cellSet = (cells: number[][]) => new Set(cells.map(([col, row]) => `${col}:${row}`));

  await t.test('6.5: reach — the cells the remaining speed still gets to, past difficult terrain and walls', async () => {
    await pg.query('DELETE FROM character_effects WHERE character_id=ANY($1::uuid[])', [[hero.id, goblin.id]]);
    await setHp(hero.id, 20);
    let reach = (await reachOf(alice.token)).json();
    assert.deepEqual([reach.limited, reach.cells.length], [false, 0], 'no combat — no limit');

    await request('POST', `${initiative}/start`, gm.token, {});
    await pg.query('UPDATE initiative_entries SET is_current = (character_id = $2) WHERE scene_id=$1', [sceneId, goblin.id]);
    reach = (await reachOf(alice.token)).json();
    assert.deepEqual([reach.limited, reach.isTurn, reach.cells.length], [true, false, 0], 'not her turn');

    await pg.query('UPDATE initiative_entries SET is_current = (character_id = $2), moved_feet = CASE WHEN character_id = $2 THEN 20 ELSE 0 END WHERE scene_id=$1', [sceneId, hero.id]);
    reach = (await reachOf(alice.token)).json();
    assert.deepEqual([reach.isTurn, reach.feetLeft, reach.budget], [true, 10, 30]);
    assert.equal(reach.cells.length, 25);
    assert.ok(cellSet(reach.cells).has('7:7') && !cellSet(reach.cells).has('8:5'));

    await pg.query(`UPDATE scenes SET difficult_cells='[[7,5]]'::jsonb WHERE id=$1`, [sceneId]);
    const wall = await request('POST', `${scenePath}/walls`, gm.token, {x1: -1, z1: -5, x2: -1, z2: 5});
    assert.equal(wall.statusCode, 201, wall.body);
    const cells = cellSet((await reachOf(alice.token)).json().cells);
    assert.ok(!cells.has('7:5'), 'difficult terrain costs double');
    assert.ok(cells.has('7:4'), 'going around it diagonally is fine');
    assert.ok(!cells.has('3:5') && cells.has('4:5'), 'the wall cuts off the column behind it');
    assert.equal(cells.size, 25 - 1 - 5);

    assert.equal((await request('GET', `${scenePath}/objects/${(await pg.query<any>('SELECT id FROM scene_objects WHERE character_id=$1', [goblin.id])).rows[0].id}/reach`, alice.token)).statusCode, 403);
    await pg.query(`UPDATE scenes SET difficult_cells='[]'::jsonb WHERE id=$1`, [sceneId]);
  });

  await t.test('6.5: a weapon cannot hit past its range; reach_limit = false turns the check off', async () => {
    const goblinPlacement = (await pg.query<any>('SELECT id FROM scene_objects WHERE character_id=$1', [goblin.id])).rows[0].id;
    await pg.query('UPDATE scene_objects SET x=4.5 WHERE id=$1', [goblinPlacement]);
    const attack = async (name: string) => {
      const key = (await pg.query<any>('SELECT id FROM character_weapons WHERE character_id=$1 AND name=$2', [hero.id, name])).rows[0].id;
      return request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'attack', key, targetCharacterId: goblin.id, sceneId});
    };
    const far = await attack('Кинжал');
    assert.equal(far.statusCode, 400);
    assert.match(far.json().message, /вне досягаемости: Кинжал — 5 фут/);
    assert.equal((await attack('Лук')).statusCode, 201, '20 feet away is within the bow range');
    await pg.query('UPDATE scene_objects SET x=2.5 WHERE id=$1', [goblinPlacement]);
    assert.equal((await attack('Кинжал')).statusCode, 400, 'one empty cell between is 10 feet, not 5');

    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'reach_limit','flag','Дальность','false'::jsonb,$2)`, [campaignId, gm.user.id]);
    assert.equal((await attack('Кинжал')).statusCode, 201);
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='reach_limit'`, [campaignId]);
    await pg.query('UPDATE scene_objects SET x=1.5 WHERE id=$1', [goblinPlacement]);
  });

  const rest = (body: any, token = alice.token) => request('POST', `${base}/characters/${hero.id}/rest`, token, body);
  const heroRow = async () => (await pg.query<any>('SELECT hp_current, hit_dice_spent FROM characters WHERE id=$1', [hero.id])).rows[0];
  const resource = async (name: string) => (await pg.query<any>('SELECT current FROM character_resources WHERE character_id=$1 AND name=$2', [hero.id, name])).rows[0].current;

  await t.test('6.6: a short rest spends hit dice (roll + CON) and recharges short-rest resources; not in combat', async () => {
    const inCombat = await rest({kind: 'short', hitDice: 1});
    assert.equal(inCombat.statusCode, 400);
    assert.match(inCombat.json().message, /в бою/);
    await request('DELETE', initiative, gm.token);

    await pg.query('DELETE FROM character_effects WHERE character_id=$1', [hero.id]);
    await pg.query('UPDATE characters SET level=5, constitution=14, hp_current=5, hp_max=20, hit_dice_spent=0 WHERE id=$1', [hero.id]);
    await request('POST', `${base}/characters/${hero.id}/resources`, alice.token, {name: 'Ки', current: 0, max: 3, recharge: 'short'});
    const rage = await request('POST', `${base}/characters/${hero.id}/resources`, alice.token, {name: 'Ярость', current: 0, max: 2, recharge: 'long'});
    assert.equal(rage.json().recharge, 'long');

    assert.equal((await rest({kind: 'short', hitDice: 6})).statusCode, 400, 'level 5 — five hit dice');
    const response = await rest({kind: 'short', hitDice: 2});
    assert.equal(response.statusCode, 200, response.body);
    const {result} = response.json();
    assert.equal(result.hitDice.die, 8, 'no class in the sheet — d8');
    assert.equal(result.hitDice.rolls.length, 2);
    const healing = result.hitDice.rolls.reduce((sum: number, roll: number) => sum + roll + 2, 0);
    assert.equal(result.healed, Math.min(15, healing), 'each die + CON 2, up to the maximum');
    assert.deepEqual([(await heroRow()).hp_current, (await heroRow()).hit_dice_spent, result.hitDice.left], [5 + result.healed, 2, 3]);
    assert.deepEqual(result.resources, ['Ки']);
    assert.deepEqual([await resource('Ки'), await resource('Ярость')], [3, 0]);
    const roll = (await request('GET', `${base}/rolls`, gm.token)).json().rolls[0];
    assert.match(roll.label, /^Короткий отдых: кости хитов — Лира$/);
    assert.equal(roll.formula, '2d8+4');

    await pg.query('UPDATE characters SET hp_current=19 WHERE id=$1', [hero.id]);
    const auto = (await rest({kind: 'short', autoHitDice: true})).json().result;
    assert.equal(auto.hitDice.rolls.length, 1, 'as many as needed: one die tops 19/20 up');
    assert.equal((await heroRow()).hp_current, 20);
  });

  await t.test('6.6: a long rest — full hit points, half the hit dice back, slots, every resource, exhaustion −1', async () => {
    await pg.query('UPDATE characters SET hp_current=3, hit_dice_spent=4 WHERE id=$1', [hero.id]);
    await pg.query(`INSERT INTO character_effects(campaign_id, character_id, effect_code) VALUES ($1,$2,'exhaustion_2')`, [campaignId, hero.id]);
    await pg.query('UPDATE character_spell_slots SET current=0 WHERE character_id=$1', [hero.id]);
    await pg.query('UPDATE character_resources SET current=0 WHERE character_id=$1', [hero.id]);
    const response = await rest({kind: 'long'});
    assert.equal(response.statusCode, 200, response.body);
    const {result, summary} = response.json();
    assert.deepEqual(result.exhaustion, {before: 2, after: 1});
    assert.equal(result.healed, 17);
    assert.equal(result.hitDice.recovered, 2, 'half of five, rounded down');
    assert.ok(result.slots >= 1);
    assert.deepEqual(result.resources, ['Ки', 'Ярость']);
    assert.deepEqual([(await heroRow()).hp_current, (await heroRow()).hit_dice_spent], [20, 2]);
    const effects = (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active', [hero.id])).rows.map(row => row.effect_code);
    assert.deepEqual(effects, ['exhaustion_1']);
    assert.match(summary, /истощение 2 → 1/);

    await pg.query('UPDATE characters SET hp_current=0 WHERE id=$1', [hero.id]);
    const down = (await rest({kind: 'long'})).json().result;
    assert.equal(down.skipped, 'нужен хотя бы 1 хит');
    assert.equal((await heroRow()).hp_current, 0);
    await pg.query('DELETE FROM character_effects WHERE character_id=$1', [hero.id]);
    await pg.query('UPDATE characters SET hp_current=20 WHERE id=$1', [hero.id]);
  });

  await t.test('6.6: the GM rests the whole party on the scene — player characters and allies, not enemies', async () => {
    const ally = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Страж', disposition: 'friendly', hpMax: 10, hpCurrent: 4})).json();
    await request('POST', `${scenePath}/objects`, gm.token, {characterId: ally.id, x: -1.5, z: 0.5});
    await pg.query('UPDATE characters SET hp_current=1 WHERE id=$1', [goblin.id]);
    assert.equal((await request('POST', `${scenePath}/rest`, alice.token, {kind: 'long'})).statusCode, 403);
    const response = await request('POST', `${scenePath}/rest`, gm.token, {kind: 'long'});
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().results.map((entry: any) => entry.name), ['Лира', 'Страж']);
    assert.deepEqual([await hp(ally.id), await hp(goblin.id)], [10, 1]);
    await setHp(goblin.id, 40);
  });

  await t.test('6.6: one long rest a day by the campaign clock; long_rest_daily = false lifts it', async () => {
    await pg.query('UPDATE characters SET hp_current=5 WHERE id=$1', [hero.id]);
    const early = (await rest({kind: 'long'})).json().result;
    assert.equal(early.skipped, 'следующий долгий отдых через 16 ч (раз в сутки)');
    assert.equal((await heroRow()).hp_current, 5);

    assert.equal((await request('PUT', `${base}/time`, gm.token, {advanceMinutes: 16 * 60})).statusCode, 200);
    const next = (await rest({kind: 'long'})).json().result;
    assert.equal(next.skipped, null);
    assert.equal((await heroRow()).hp_current, 20);

    await pg.query('UPDATE characters SET hp_current=5 WHERE id=$1', [hero.id]);
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'long_rest_daily','flag','Раз в сутки','false'::jsonb,$2)`, [campaignId, gm.user.id]);
    assert.equal((await rest({kind: 'long'})).json().result.skipped, null, 'the table waived the rule');
    assert.equal((await heroRow()).hp_current, 20);
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='long_rest_daily'`, [campaignId]);
  });

  const heroXp = async () => (await pg.query<any>('SELECT experience, level, hp_max, hp_current FROM characters WHERE id=$1', [hero.id])).rows[0];

  await t.test('6.7: a defeated enemy gives its experience to the party on the scene — once — and a new level comes by itself', async () => {
    await pg.query('UPDATE characters SET level=1, experience=250, hp_max=20, hp_current=20, constitution=14 WHERE id=$1', [hero.id]);
    await pg.query('UPDATE characters SET challenge_rating=NULL, xp_award=NULL, xp_awarded=false WHERE id=$1', [goblin.id]);
    await pg.query('DELETE FROM character_effects WHERE character_id=$1', [goblin.id]);
    await setHp(goblin.id, 1);
    assert.equal((await hit()).damage.experience, null);
    assert.equal((await pg.query<any>('SELECT xp_awarded FROM characters WHERE id=$1', [goblin.id])).rows[0].xp_awarded, false);
    await pg.query('DELETE FROM character_effects WHERE character_id=$1', [goblin.id]);
    const goblinSheet = (await request('GET', `${base}/characters/${goblin.id}`, gm.token)).json();
    const patched = await request('PATCH', `${base}/characters/${goblin.id}`, gm.token, {revision: goblinSheet.revision, challengeRating: 0.25});
    assert.equal(patched.statusCode, 200, patched.body);
    assert.equal(patched.json().experience_info.reward, 50, 'CR 1/4 — 50 XP by the DMG table');
    const heroSheet = (await request('GET', `${base}/characters/${hero.id}`, alice.token)).json();
    assert.deepEqual(heroSheet.experience_info, {floor: 0, next: 300, reward: null}, 'the owner sees the way to level 2');
    assert.deepEqual(heroSheet.hit_dice, {die: 8, total: 1, left: 1, pools: [{die: 8, total: 1, left: 1}]});
    const asStranger = (await request('GET', `${base}/characters/${goblin.id}`, alice.token)).json();
    assert.equal(asStranger.experience_info.reward, 50, 'everyone sees what the enemy is worth');
    await setHp(goblin.id, 1);
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'level_choices','flag','Окно уровня','false'::jsonb,$2)`, [campaignId, gm.user.id]);

    const result = await hit();
    assert.equal(result.damage.experience.awards.length, 1, 'only Лира: the ally and the chest get nothing');
    const [award] = result.damage.experience.awards;
    assert.deepEqual([award.amount, award.experience, award.level, award.leveledUp, award.hpGain], [50, 300, 2, true, 7]);
    assert.deepEqual(await heroXp(), {experience: 300, level: 2, hp_max: 27, hp_current: 27}, 'd8 / 2 + 1 + CON 2');

    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [goblin.id]);
    await setHp(goblin.id, 1);
    assert.equal((await hit()).damage.experience, null, 'the same goblin does not pay twice');
    assert.equal((await heroXp()).experience, 300);
  });

  await t.test('6.7: the GM hands out experience by hand; auto_level = false only reports the level that is ready', async () => {
    const award = (body: any, token = gm.token) => request('POST', `${base}/experience`, token, body);
    assert.equal((await award({characterIds: [hero.id], amount: 100}, alice.token)).statusCode, 403);
    assert.equal((await award({characterIds: [chest.id], amount: 100})).statusCode, 404, 'objects earn nothing');

    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'auto_level','flag','Уровень сам','false'::jsonb,$2)`, [campaignId, gm.user.id]);
    const response = await award({characterIds: [hero.id], amount: 700, reason: 'Спасли деревню'});
    assert.equal(response.statusCode, 201, response.body);
    const [entry] = response.json().awards;
    assert.deepEqual([entry.experience, entry.level, entry.leveledUp, entry.readyLevel], [1000, 2, false, 3]);
    assert.equal(response.json().reason, 'Спасли деревню');
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='auto_level'`, [campaignId]);

    const ally = (await pg.query<any>(`SELECT id FROM characters WHERE name='Страж'`)).rows[0].id;
    const split = (await award({characterIds: [hero.id, ally], amount: 101, split: true})).json();
    assert.deepEqual(split.awards.map((entry: any) => entry.amount), [50, 50]);
    assert.equal((await heroXp()).level, 3, 'auto_level is back: the waiting level comes with the next award');
  });

  await t.test('6.8: the fallen enemy can be searched from next to it — one thing or everything', async () => {
    const item = async (name: string) => (await request('POST', `${base}/characters`, gm.token, {kind: 'object', name})).json();
    const knife = await item('Ржавый нож'), purse = await item('Кошель');
    await pg.query('UPDATE characters SET container_id=$2 WHERE id = ANY($1::uuid[])', [[knife.id, purse.id], goblin.id]);
    const ally = (await pg.query<any>(`SELECT id FROM characters WHERE name='Страж'`)).rows[0].id;
    const loot = `${scenePath}/loot`;

    const objects = (await request('GET', scenePath, alice.token)).json().objects;
    assert.equal(objects.find((object: any) => object.character_id === goblin.id).loot, 2, 'the fallen goblin shows loot');
    assert.equal(objects.find((object: any) => object.character_id === hero.id).loot, 0);

    const seen = await request('GET', `${loot}/${goblin.id}?looterId=${hero.id}`, alice.token);
    assert.equal(seen.statusCode, 200, seen.body);
    assert.deepEqual(seen.json().items.map((entry: any) => entry.name), ['Кошель', 'Ржавый нож']);

    assert.match((await request('GET', `${loot}/${ally}?looterId=${hero.id}`, alice.token)).json().message, /жив/);
    assert.equal((await request('POST', `${loot}/${goblin.id}`, alice.token, {looterId: ally})).statusCode, 403, 'not her creature');
    const heroPlace = await heroPlacement();
    await pg.query('UPDATE scene_objects SET x=-2.5 WHERE id=$1', [heroPlace]);
    assert.match((await request('POST', `${loot}/${goblin.id}`, alice.token, {looterId: hero.id})).json().message, /слишком далеко/);
    await pg.query('UPDATE scene_objects SET x=0.5 WHERE id=$1', [heroPlace]);

    const one = await request('POST', `${loot}/${goblin.id}`, alice.token, {looterId: hero.id, itemIds: [knife.id]});
    assert.equal(one.statusCode, 200, one.body);
    assert.deepEqual([one.json().taken.map((entry: any) => entry.name), one.json().left], [['Ржавый нож'], 1]);
    const owned = (await pg.query<any>('SELECT container_id, owner_user_id FROM characters WHERE id=$1', [knife.id])).rows[0];
    assert.deepEqual(owned, {container_id: hero.id, owner_user_id: alice.user.id}, 'it is in her pack and hers');

    const all = (await request('POST', `${loot}/${goblin.id}`, alice.token, {looterId: hero.id})).json();
    assert.deepEqual([all.taken.map((entry: any) => entry.name), all.left], [['Кошель'], 0]);
    assert.match((await request('POST', `${loot}/${goblin.id}`, alice.token, {looterId: hero.id})).json().message, /ничего нет/);
  });

  await t.test('6.8: the fallen enemy’s coins go into the looter’s purse as they are — on their own or with «Забрать всё»', async () => {
    const loot = `${scenePath}/loot`;
    const wallet = async (id: string) => (await pg.query<any>('SELECT cp, sp, ep, gp, pp FROM characters WHERE id=$1', [id])).rows[0];
    const lootMark = async () => (await request('GET', scenePath, alice.token)).json().objects.find((object: any) => object.character_id === goblin.id).loot;
    const stash = async (name: string) => {
      const thing = (await request('POST', `${base}/characters`, gm.token, {kind: 'object', name})).json();
      await pg.query('UPDATE characters SET container_id=$2 WHERE id=$1', [thing.id, goblin.id]);
      return thing;
    };
    const empty = {cp: 0, sp: 0, ep: 0, gp: 0, pp: 0};
    await pg.query('UPDATE characters SET gp=5, ep=3, cp=7 WHERE id=$1', [goblin.id]);
    const before = await wallet(hero.id);

    assert.equal(await lootMark(), 1, 'coins alone are loot too');
    const seen = (await request('GET', `${loot}/${goblin.id}?looterId=${hero.id}`, alice.token)).json();
    assert.deepEqual([seen.items, seen.coins], [[], {cp: 7, sp: 0, ep: 3, gp: 5, pp: 0}]);

    const ring = await stash('Медное кольцо');
    const one = (await request('POST', `${loot}/${goblin.id}`, alice.token, {looterId: hero.id, itemIds: [ring.id]})).json();
    assert.deepEqual(one.coins, empty, 'taking one thing leaves the coins');
    assert.equal(await lootMark(), 1);

    const coins = await request('POST', `${loot}/${goblin.id}`, alice.token, {looterId: hero.id, itemIds: [], coins: true});
    assert.equal(coins.statusCode, 200, coins.body);
    assert.deepEqual(coins.json().taken, []);
    assert.deepEqual(await wallet(hero.id), {...before, cp: before.cp + 7, ep: before.ep + 3, gp: before.gp + 5}, 'electrum stays electrum');
    assert.deepEqual(await wallet(goblin.id), empty);
    assert.equal(await lootMark(), 0);
    assert.match((await request('POST', `${loot}/${goblin.id}`, alice.token, {looterId: hero.id, itemIds: [], coins: true})).json().message, /Денег .* нет/);

    await stash('Кость');
    await pg.query('UPDATE characters SET gp=2 WHERE id=$1', [goblin.id]);
    const all = (await request('POST', `${loot}/${goblin.id}`, alice.token, {looterId: hero.id})).json();
    assert.deepEqual([all.taken.map((entry: any) => entry.name), all.coins.gp], [['Кость'], 2], '«Забрать всё» takes the money too');
  });

  await t.test('6.9: inspiration — the GM grants it, a roll spends it on advantage, a player can pass it on', async () => {
    const inspire = (id: string, body: any, token = gm.token) => request('POST', `${base}/characters/${id}/inspiration`, token, body);
    const inspired = async (id: string) => (await pg.query<any>('SELECT inspiration FROM characters WHERE id=$1', [id])).rows[0].inspiration;
    assert.equal((await inspire(hero.id, {inspired: true}, alice.token)).statusCode, 403, 'the GM grants it');
    assert.equal((await inspire(goblin.id, {inspired: true})).statusCode, 400, 'player characters only');
    assert.equal((await inspire(hero.id, {inspired: true})).statusCode, 200);
    assert.match((await inspire(hero.id, {inspired: true})).json().message, /уже есть/);
    const objects = (await request('GET', scenePath, alice.token)).json().objects;
    assert.equal(objects.find((object: any) => object.character_id === hero.id).inspired, true);

    const save = () => request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'save', key: 'wisdom', inspiration: true});
    const spent = await save();
    assert.equal(spent.statusCode, 201, spent.body);
    assert.equal(spent.json().outcome.advantage, 'adv');
    assert.ok(spent.json().outcome.reasons.includes('преимущество: вдохновение'));
    assert.equal(spent.json().dice_results.length, 2);
    assert.equal(await inspired(hero.id), false);
    assert.match((await save()).json().message, /нет вдохновения/);

    const borin = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Борин'})).json();
    await inspire(hero.id, {inspired: true});
    assert.equal((await inspire(hero.id, {giveTo: goblin.id}, alice.token)).statusCode, 404, 'not to an NPC');
    const passed = await inspire(hero.id, {giveTo: borin.id}, alice.token);
    assert.equal(passed.statusCode, 200, passed.body);
    assert.deepEqual([await inspired(hero.id), await inspired(borin.id)], [false, true]);
    assert.equal((await inspire(borin.id, {inspired: false})).statusCode, 200, 'the GM can take it back');
  });

  await t.test('6.10: the quest log — the GM keeps it, the party sees the open quests, completion pays experience once', async () => {
    const quests = `${base}/quests`;
    assert.equal((await request('POST', quests, alice.token, {title: 'Моё задание'})).statusCode, 403);
    const created = await request('POST', quests, gm.token, {title: 'Спасти мельника', xpReward: 100, objectives: ['Найти мельницу', 'Прогнать волков']});
    assert.equal(created.statusCode, 201, created.body);
    const quest = created.json();
    assert.deepEqual(quest.objectives.map((entry: any) => [entry.text, entry.done]), [['Найти мельницу', false], ['Прогнать волков', false]]);
    await request('POST', quests, gm.token, {title: 'Тайна склепа', hidden: true});

    const seen = (await request('GET', quests, alice.token)).json();
    assert.deepEqual([seen.canManage, seen.quests.map((entry: any) => entry.title)], [false, ['Спасти мельника']], 'the hidden one stays with the GM');
    assert.equal((await request('GET', quests, gm.token)).json().quests.length, 2);

    const ticked = await request('PATCH', `${quests}/${quest.id}/objectives/${quest.objectives[0].id}`, gm.token, {done: true});
    assert.equal(ticked.json().objectives[0].done, true);
    assert.equal((await request('PATCH', `${quests}/${quest.id}/objectives/${quest.objectives[1].id}`, alice.token, {done: true})).statusCode, 403);
    const added = await request('POST', `${quests}/${quest.id}/objectives`, gm.token, {text: 'Вернуться к мельнику'});
    assert.equal(added.json().objectives.at(-1).text, 'Вернуться к мельнику');

    const xpBefore = await pg.query<any>(`SELECT name, experience FROM characters WHERE kind='character' AND campaign_id=$1 ORDER BY name`, [campaignId]);
    const done = await request('PATCH', `${quests}/${quest.id}`, gm.token, {status: 'completed', sceneId});
    assert.equal(done.statusCode, 200, done.body);
    assert.deepEqual(done.json().awards.map((entry: any) => [entry.name, entry.amount]), [['Лира', 100]], 'only those on the scene');
    const xpAfter = await pg.query<any>(`SELECT name, experience FROM characters WHERE kind='character' AND campaign_id=$1 ORDER BY name`, [campaignId]);
    assert.deepEqual(
      xpAfter.rows.map((row: any, index: number) => [row.name, row.experience - xpBefore.rows[index].experience]),
      [['Борин', 0], ['Лира', 100]],
    );

    await request('PATCH', `${quests}/${quest.id}`, gm.token, {status: 'active'});
    const again = (await request('PATCH', `${quests}/${quest.id}`, gm.token, {status: 'completed'})).json();
    assert.deepEqual(again.awards, [], 'the reward is paid once');

    const secret = (await request('GET', quests, gm.token)).json().quests.find((entry: any) => entry.title === 'Тайна склепа');
    const everyone = (await request('PATCH', `${quests}/${secret.id}`, gm.token, {xpReward: 10, status: 'completed'})).json();
    assert.deepEqual(everyone.awards.map((entry: any) => entry.name).sort(), ['Борин', 'Лира'], 'without a scene — every living player character');
    assert.equal((await request('DELETE', `${quests}/${secret.id}`, gm.token)).statusCode, 204);
    assert.equal((await request('GET', quests, gm.token)).json().quests.length, 1);
  });
});
