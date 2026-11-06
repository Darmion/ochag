import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('combat rules', async t => {
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

  const gm = await register('gm_rules'), alice = await register('alice_rules');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Rules'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Арена', widthCells: 12, heightCells: 12})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const initiative = `${scenePath}/initiative`;

  const hero = (await request('POST', `${base}/characters`, alice.token, {
    kind: 'character', name: 'Лира', dexterity: 14, intelligence: 16, hpMax: 30, hpCurrent: 30, armorClass: 14, speedFeet: 30, level: 3,
  })).json();
  const goblin = (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name: 'Гоблин', disposition: 'hostile', dexterity: 14, hpMax: 200, hpCurrent: 200, armorClass: 1, speedFeet: 30,
  })).json();
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: 0.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 1.5, z: 0.5});
  const dagger = (await request('POST', `${base}/characters/${hero.id}/weapons`, alice.token, {name: 'Кинжал', ability: 'dexterity', damageFormula: '1d1+@dex', damageType: 'piercing', properties: ['finesse', 'light', 'thrown'], srdIndex: 'dagger'})).json();
  const shortsword = (await request('POST', `${base}/characters/${hero.id}/weapons`, alice.token, {name: 'Короткий меч', ability: 'dexterity', damageFormula: '1d1+@dex', damageType: 'piercing', properties: ['finesse', 'light'], srdIndex: 'shortsword'})).json();
  const longsword = (await request('POST', `${base}/characters/${hero.id}/weapons`, alice.token, {name: 'Длинный меч', ability: 'strength', damageFormula: '1d1', damageType: 'slashing', properties: ['versatile'], srdIndex: 'longsword'})).json();
  const scimitar = (await request('POST', `${base}/characters/${goblin.id}/weapons`, gm.token, {name: 'Скимитар', ability: 'dexterity', proficient: false, damageFormula: '1d1', damageType: 'slashing'})).json();

  const attack = (body: any = {}, token = alice.token) => request('POST', `${base}/rolls/check`, token, {
    characterId: hero.id, kind: 'attack', key: dagger.id, targetCharacterId: goblin.id, sceneId, ...body,
  });
  const goblinAttack = (body: any = {}) => request('POST', `${base}/rolls/check`, gm.token, {
    characterId: goblin.id, kind: 'attack', key: scimitar.id, targetCharacterId: hero.id, sceneId, ...body,
  });
  const entries = async () => (await request('GET', initiative, gm.token)).json().entries;
  const entryOf = async (id: string) => (await entries()).find((entry: any) => entry.character_id === id);
  const turnTo = (id: string) => pg.query(
    `UPDATE initiative_entries SET is_current = (character_id = $2), action_used=false, bonus_used=false, reaction_used=false, attacks_made=0, disengaged=false, moved_feet=0, dashes=0 WHERE scene_id=$1`,
    [sceneId, id],
  );

  await request('POST', `${initiative}/start`, gm.token, {});

  await t.test('7.1: an attack spends the action; a bonus-action attack only with a second light weapon (two-weapon fighting); then nothing is left', async () => {
    await turnTo(hero.id);
    assert.match((await attack({using: 'bonus'})).json().message, /сначала действие «Атака» другим лёгким рукопашным оружием/, 'no bonus attack before the Attack action');
    assert.equal((await attack()).statusCode, 201);
    const second = await attack();
    assert.equal(second.statusCode, 400);
    assert.match(second.json().message, /атаки действия «Атака» в этот ход сделаны \(1 из 1\)/);
    assert.match((await attack({using: 'bonus'})).json().message, /сначала атака другим лёгким рукопашным оружием/, 'the same dagger is not the other hand');
    assert.match((await attack({using: 'bonus', key: longsword.id})).json().message, /«Длинный меч» бонусным действием не ударить/, 'a longsword is not light');
    const options = (await request('GET', `${base}/characters/${hero.id}/attack-options?sceneId=${sceneId}`, alice.token)).json();
    assert.equal(options.enforced, true);
    assert.deepEqual(Object.fromEntries(options.weapons.map((weapon: any) => [weapon.id, weapon.bonus])), {[dagger.id]: null, [shortsword.id]: 'two-weapon', [longsword.id]: null});
    const offhand = await attack({using: 'bonus', key: shortsword.id});
    assert.equal(offhand.statusCode, 201, offhand.body);
    assert.ok(offhand.json().outcome.reasons.includes('бонусным: второе лёгкое оружие'), JSON.stringify(offhand.json().outcome.reasons));
    assert.match((await attack({using: 'bonus', key: shortsword.id})).json().message, /бонусное действие в этот ход уже потрачено/);
    const heroEntry = await entryOf(hero.id);
    assert.deepEqual([heroEntry.action_used, heroEntry.bonus_used, heroEntry.reaction_used, heroEntry.attacks_made], [true, true, false, 1]);
    assert.match((await request('POST', `${initiative}/${heroEntry.id}/dash`, alice.token, {})).json().message, /действие в этот ход уже потрачено|атаки действия/);
    assert.match((await request('POST', `${initiative}/${heroEntry.id}/dash`, alice.token, {using: 'bonus'})).json().message, /бонусное/);
    assert.equal((await request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'save', key: 'dexterity', using: 'action'})).statusCode, 400, 'only an attack spends an action here');
  });

  await t.test('7.1: off its turn a creature only reacts — with a readied attack, once; the GM too, unless «Свободно» (gm_free_move)', async () => {
    await turnTo(goblin.id);
    assert.match((await attack()).json().message, /вне своего хода — только реакция/);
    assert.match((await attack({using: 'reaction'})).json().message, /подготовленная действием «Подготовиться»/, 'no reaction attack out of nothing');
    await turnTo(hero.id);
    const ready = await request('POST', `${base}/characters/${hero.id}/combat-action`, alice.token, {action: 'ready', sceneId, trigger: 'гоблин подойдёт'});
    assert.equal(ready.statusCode, 201, ready.body);
    assert.match(ready.json().message, /готовит атаку — «гоблин подойдёт»/);
    assert.equal((await entryOf(hero.id)).action_used, true, 'readying takes the action');
    await turnTo(goblin.id);
    const options = (await request('GET', `${base}/characters/${hero.id}/attack-options?sceneId=${sceneId}`, alice.token)).json();
    assert.deepEqual(options.readied, {trigger: 'гоблин подойдёт'});
    const reaction = await attack({using: 'reaction'});
    assert.equal(reaction.statusCode, 201, reaction.body);
    assert.match((await attack({using: 'reaction'})).json().message, /подготовленная действием/, 'the readied attack is spent');
    assert.equal((await entryOf(hero.id)).reaction_used, true);
    assert.equal((await goblinAttack()).statusCode, 201);
    assert.match((await goblinAttack()).json().message, /атаки действия «Атака» в этот ход сделаны/, 'the GM obeys the action economy too');
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'gm_free_move','flag','Свободно','true'::jsonb,$2)`, [campaignId, gm.user.id]);
    assert.equal((await goblinAttack()).statusCode, 201, '«Свободно»: legendary actions, lair, whatever the server does not know');
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='gm_free_move'`, [campaignId]);
    assert.equal((await entryOf(goblin.id)).action_used, true, 'still recorded');
  });

  await t.test('7.1: a new turn gives everything back — the reaction too', async () => {
    const goblinEntry = await entryOf(goblin.id);
    for (let i = 0; i < 3 && !(await entryOf(hero.id)).is_current; i++) await request('POST', `${initiative}/advance`, gm.token);
    const heroEntry = await entryOf(hero.id);
    assert.equal(heroEntry.is_current, true);
    assert.deepEqual([heroEntry.action_used, heroEntry.bonus_used, heroEntry.reaction_used, heroEntry.attacks_made], [false, false, false, 0]);
    assert.ok(goblinEntry.action_used);
  });

  await t.test('7.1: Dodge — attacks against at disadvantage, DEX saves at advantage, until its next turn; Disengage as a bonus action', async () => {
    const heroEntry = await entryOf(hero.id);
    const dodge = await request('POST', `${initiative}/${heroEntry.id}/act`, alice.token, {action: 'dodge'});
    assert.equal(dodge.statusCode, 200, dodge.body);
    assert.equal((await entryOf(hero.id)).action_used, true);
    assert.equal((await attack()).statusCode, 400, 'the action went into dodging');
    const disengage = await request('POST', `${initiative}/${heroEntry.id}/act`, alice.token, {action: 'disengage', using: 'bonus'});
    assert.equal(disengage.statusCode, 200, disengage.body);
    assert.deepEqual([(await entryOf(hero.id)).bonus_used, (await entryOf(hero.id)).disengaged], [true, true]);

    const save = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'save', key: 'dexterity'})).json();
    assert.equal(save.outcome.advantage, 'adv');
    assert.ok(save.outcome.reasons.includes('преимущество: уклонение'));
    await turnTo(goblin.id);
    const swing = (await goblinAttack()).json();
    assert.ok(swing.outcome.reasons.includes('помеха: цель уклоняется'), JSON.stringify(swing.outcome));

    for (let i = 0; i < 3 && !(await entryOf(hero.id)).is_current; i++) await request('POST', `${initiative}/advance`, gm.token);
    const effects = (await pg.query<any>(`SELECT effect_code FROM character_effects WHERE character_id=$1`, [hero.id])).rows.map(row => row.effect_code);
    assert.ok(!effects.includes('dodging'), 'dodging ends at the start of its next turn');
    assert.equal((await entryOf(hero.id)).disengaged, false);
    assert.equal((await request('POST', `${initiative}/${heroEntry.id}/act`, gm.token, {action: 'dodge'})).statusCode, 200, 'the GM may act for her');
    await turnTo(goblin.id);
    assert.match((await request('POST', `${initiative}/${heroEntry.id}/act`, alice.token, {action: 'dodge'})).json().message, /только в свой ход/);
  });

  await t.test('7.1: a bonus-action spell leaves the action for a cantrip only (PHB, p. 202)', async () => {
    await turnTo(hero.id);
    await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,4,4)`, [campaignId, hero.id]);
    const learn = async (srdIndex: string) => (await pg.query<any>(
      `INSERT INTO character_spells(campaign_id, character_id, source, srd_index) VALUES ($1,$2,'srd',$3) RETURNING id`, [campaignId, hero.id, srdIndex],
    )).rows[0].id as string;
    const cast = (entryId: string, body: any = {}) => request('POST', `${base}/characters/${hero.id}/spells/${entryId}/cast`, alice.token, {sceneId, ...body});
    const word = await learn('healing-word'), missile = await learn('magic-missile'), bolt = await learn('fire-bolt');
    const healed = await cast(word, {targetIds: [hero.id]});
    assert.equal(healed.statusCode, 201, healed.body);
    assert.equal((await entryOf(hero.id)).bonus_used, true, 'Healing Word is a bonus action');
    assert.match((await cast(missile, {targetIds: [goblin.id]})).json().message, /только заговор/);
    assert.equal((await cast(bolt, {targetIds: [goblin.id]})).statusCode, 201, 'a cantrip with the action is fine');
    assert.equal((await entryOf(hero.id)).action_used, true);
  });

  await t.test('7.1: marking by hand — the player only spends, the GM can give back; action_economy = false turns it off', async () => {
    const heroEntry = await entryOf(hero.id);
    const economy = `${initiative}/${heroEntry.id}/economy`;
    assert.equal((await request('POST', economy, alice.token, {reaction: true})).json().reaction_used, true);
    assert.equal((await request('POST', economy, alice.token, {action: false})).statusCode, 403);
    const restored = (await request('POST', economy, gm.token, {action: false, bonus: false})).json();
    assert.deepEqual([restored.action_used, restored.bonus_used, restored.attacks_made], [false, false, 0]);

    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'action_economy','flag','Экономия действий','false'::jsonb,$2)`, [campaignId, gm.user.id]);
    assert.equal((await attack()).statusCode, 201);
    assert.equal((await attack()).statusCode, 201, 'no economy — no limit');
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='action_economy'`, [campaignId]);
  });

  const patch = async (id: string, fields: any, token = gm.token) => {
    const current = (await request('GET', `${base}/characters/${id}`, token)).json();
    const response = await request('PATCH', `${base}/characters/${id}`, token, {revision: current.revision, ...fields});
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };

  await t.test('7.2: Extra Attack by class and level — the second attack is the same action, a third is refused', async () => {
    const sheet = await patch(hero.id, {className: 'Воин', level: 5}, alice.token);
    assert.deepEqual([sheet.class_info.classId, sheet.class_info.attacksPerAction, sheet.class_info.multiclass], ['fighter', 2, false]);
    await turnTo(hero.id);
    assert.equal((await entryOf(hero.id)).attacks_per_action, 2);
    assert.equal((await attack()).statusCode, 201);
    assert.equal((await attack()).statusCode, 201, 'Extra Attack');
    assert.match((await attack()).json().message, /\(2 из 2\)/);
    assert.equal((await entryOf(hero.id)).attacks_made, 2);
    assert.equal((await patch(hero.id, {level: 11}, alice.token)).class_info.attacksPerAction, 3);
    assert.equal((await patch(hero.id, {className: 'Волшебник'}, alice.token)).class_info.attacksPerAction, 1);
  });

  await t.test('7.2: multiattack by hand wins over the class; null gives the class back', async () => {
    const goblinSheet = await patch(goblin.id, {attacksPerAction: 3});
    assert.equal(goblinSheet.class_info.attacksPerAction, 3);
    assert.equal(goblinSheet.attacks_per_action, 3);
    assert.equal((await entryOf(goblin.id)).attacks_per_action, 3);
    assert.equal((await patch(goblin.id, {attacksPerAction: null})).class_info.attacksPerAction, 1);
    const bad = await request('PATCH', `${base}/characters/${goblin.id}`, gm.token, {revision: (await request('GET', `${base}/characters/${goblin.id}`, gm.token)).json().revision, attacksPerAction: 11});
    assert.equal(bad.statusCode, 400);
  });

  const weapon = async (fields: any, owner = hero.id, token = alice.token) => {
    const response = await request('POST', `${base}/characters/${owner}/weapons`, token, fields);
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };
  const goblinPlace = async () => (await pg.query<any>('SELECT id FROM scene_objects WHERE character_id=$1', [goblin.id])).rows[0].id as string;
  const moveGoblin = async (x: number, z = 0.5) => pg.query('UPDATE scene_objects SET x=$2, z=$3 WHERE id=$1', [await goblinPlace(), x, z]);
  const strike = (key: string, body: any = {}) => request('POST', `${base}/rolls/check`, alice.token, {
    characterId: hero.id, kind: 'attack', key, targetCharacterId: goblin.id, sceneId, ...body,
  });
  const noEconomy = () => pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'action_economy','flag','Экономия действий','false'::jsonb,$2)`, [campaignId, gm.user.id]);

  await t.test('7.3: ranged weapons — long range at disadvantage, beyond it refused; a hostile next to you is a disadvantage too', async () => {
    await noEconomy();
    await turnTo(hero.id);
    const sling = await weapon({name: 'Праща', ability: 'dexterity', proficient: false, weaponKind: 'ranged', rangeFeet: 10, longRangeFeet: 20});
    assert.deepEqual([sling.weapon_kind, sling.range_feet, sling.long_range_feet], ['ranged', 10, 20]);
    let result = (await strike(sling.id)).json();
    assert.equal(result.outcome.ranged, true);
    assert.ok(result.outcome.reasons.includes('помеха: враг рядом: Гоблин'), JSON.stringify(result.outcome));
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code) VALUES ($1,$2,'blinded')`, [campaignId, goblin.id]);
    result = (await strike(sling.id)).json();
    assert.ok(!result.outcome.reasons.some((reason: string) => reason.includes('враг рядом')), JSON.stringify(result.outcome));
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code='blinded'`, [goblin.id]);
    await moveGoblin(2.5);
    result = (await strike(sling.id)).json();
    assert.equal(result.outcome.distance, 10);
    assert.equal(result.outcome.advantage, 'none', 'normal range, nobody close');
    await moveGoblin(3.5);
    result = (await strike(sling.id)).json();
    assert.ok(result.outcome.reasons.includes('помеха: дальняя дистанция'));
    await moveGoblin(5.5);
    assert.match((await strike(sling.id)).json().message, /вне досягаемости: Праща — 20 фут/);
  });

  await t.test('7.3: a thrown dagger is melee in reach and ranged beyond it; spells keep to their range', async () => {
    const thrown = await weapon({name: 'Метательный кинжал', ability: 'finesse', proficient: false, rangeFeet: 5, thrownRangeFeet: 20, longRangeFeet: 60, properties: ['finesse', 'light', 'thrown']});
    await moveGoblin(1.5);
    assert.equal((await strike(thrown.id)).json().outcome.ranged, false);
    await moveGoblin(2.5);
    assert.equal((await strike(thrown.id)).json().outcome.ranged, true);
    const cure = (await pg.query<any>(`INSERT INTO character_spells(campaign_id, character_id, source, srd_index) VALUES ($1,$2,'srd','cure-wounds') RETURNING id`, [campaignId, hero.id])).rows[0].id;
    await pg.query(`UPDATE character_spell_slots SET current=4 WHERE character_id=$1 AND level=1`, [hero.id]);
    const far = await request('POST', `${base}/characters/${hero.id}/spells/${cure}/cast`, alice.token, {targetIds: [goblin.id], sceneId});
    assert.match(far.json().message, /дальше дистанции заклинания .* 5 фут/);
    assert.equal((await request('POST', `${base}/characters/${hero.id}/spells/${cure}/cast`, alice.token, {targetIds: [hero.id], sceneId})).statusCode, 201, 'touching yourself');
  });

  await t.test('7.4: cover — walls give half or total, a creature in between gives half', async () => {
    const bow = await weapon({name: 'Длинный лук', ability: 'dexterity', proficient: false, weaponKind: 'ranged', rangeFeet: 150, longRangeFeet: 600});
    await moveGoblin(3.5, 1.5);
    assert.equal((await strike(bow.id)).json().outcome.cover, undefined, 'open field');
    const wall = await request('POST', `${scenePath}/walls`, gm.token, {x1: 2, z1: 1, x2: 2, z2: 3});
    assert.equal(wall.statusCode, 201, wall.body);
    let result = (await strike(bow.id)).json();
    assert.equal(result.outcome.cover, 'half');
    assert.ok(result.outcome.reasons.includes('укрытие цели: половинное (+2 КД)'));
    await pg.query('DELETE FROM scene_walls WHERE scene_id=$1', [sceneId]);
    await request('POST', `${scenePath}/walls`, gm.token, {x1: 3, z1: 1, x2: 3, z2: 3});
    result = (await strike(bow.id)).json();
    assert.equal(result.outcome.cover, 'three-quarters');
    assert.ok(result.outcome.reasons.includes('укрытие цели: на три четверти (+5 КД)'));
    await pg.query('DELETE FROM scene_walls WHERE scene_id=$1', [sceneId]);
    await request('POST', `${scenePath}/walls`, gm.token, {x1: 2, z1: -6, x2: 2, z2: 6});
    assert.match((await strike(bow.id)).json().message, /полным укрытием/);
    await pg.query('DELETE FROM scene_walls WHERE scene_id=$1', [sceneId]);

    const barrel = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Стражник', disposition: 'neutral'})).json();
    await request('POST', `${scenePath}/objects`, gm.token, {characterId: barrel.id, x: 2.5, z: 1.5});
    assert.equal((await strike(bow.id)).json().outcome.cover, 'half');
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'cover','flag','Укрытие','false'::jsonb,$2)`, [campaignId, gm.user.id]);
    assert.equal((await strike(bow.id)).json().outcome.cover, undefined, 'cover = false turns it off');
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='cover'`, [campaignId]);
    await pg.query('DELETE FROM scene_objects WHERE character_id=$1', [barrel.id]);
    await moveGoblin(1.5);
  });

  await t.test('flanking (off by default): an ally on the far side of the target gives advantage on melee attacks', async () => {
    await moveGoblin(1.5, 0.5);
    const ally = (await request('POST', `${base}/characters`, alice.token, {
      kind: 'character', name: 'Бран', dexterity: 10, hpMax: 10, hpCurrent: 10, armorClass: 10, speedFeet: 30,
    })).json();
    await request('POST', `${scenePath}/objects`, alice.token, {characterId: ally.id, x: 2.5, z: 0.5});
    const allyPlaceId = async () => (await pg.query<any>('SELECT id FROM scene_objects WHERE character_id=$1', [ally.id])).rows[0].id as string;

    assert.equal((await strike(dagger.id)).json().outcome.advantage, 'none', 'off by default, even though positioned to flank');

    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'flanking','flag','Фланкирование','true'::jsonb,$2)`, [campaignId, gm.user.id]);
    let result = (await strike(dagger.id)).json();
    assert.equal(result.outcome.advantage, 'adv');
    assert.ok(result.outcome.reasons.some((reason: string) => reason.includes('фланкирование')), JSON.stringify(result.outcome));

    await pg.query('UPDATE scene_objects SET x=$2, z=$3 WHERE id=$1', [await allyPlaceId(), 0.5, 1.5]);
    assert.equal((await strike(dagger.id)).json().outcome.advantage, 'none', 'ally on the same side of the target does not flank');

    await pg.query('UPDATE scene_objects SET x=$2, z=$3 WHERE id=$1', [await allyPlaceId(), 2.5, 0.5]);
    assert.equal((await strike(dagger.id)).json().outcome.advantage, 'adv', 'back on the far side, flanking again');

    await pg.query(`INSERT INTO character_effects(campaign_id, character_id, effect_code) VALUES ($1,$2,'unconscious')`, [campaignId, ally.id]);
    assert.equal((await strike(dagger.id)).json().outcome.advantage, 'none', 'an incapacitated ally does not flank');
    await pg.query('DELETE FROM character_effects WHERE character_id=$1', [ally.id]);

    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='flanking'`, [campaignId]);
    await pg.query('DELETE FROM scene_objects WHERE character_id=$1', [ally.id]);
  });

  await t.test('7.6: finesse takes the better of STR and DEX; versatile two-handed damage; ammunition runs out', async () => {
    const rapier = await weapon({name: 'Рапира', ability: 'finesse', damageFormula: '1d1+@mod', damageType: 'piercing'});
    let check = (await strike(rapier.id)).json();
    assert.equal(check.modifier, 2 + 4, 'DEX 14 + proficiency 4 at level 11');
    await patch(hero.id, {strength: 18}, alice.token);
    check = (await strike(rapier.id)).json();
    assert.equal(check.modifier, 4 + 4, 'now STR is better');

    const sword = await weapon({name: 'Длинный меч', ability: 'strength', proficient: false, damageFormula: '1d1+@mod', versatileFormula: '2d1+@mod', damageType: 'slashing', properties: ['versatile']});
    let hitResult: any = null;
    for (let i = 0; i < 12 && !hitResult?.damage; i++) hitResult = (await strike(sword.id, {twoHanded: true})).json();
    assert.match(hitResult.damage.roll.formula, /^(2|4)d1\+4$/, 'two hands: 2d1 + STR 4');
    assert.equal((await request('POST', `${base}/characters/${hero.id}/weapons`, alice.token, {name: 'Плохой', ability: 'strength', versatileFormula: 'много'})).statusCode, 400);

    const arrows = (await request('POST', `${base}/characters/${hero.id}/resources`, alice.token, {name: 'Стрелы', current: 2, max: 20})).json();
    const goblinArrows = (await request('POST', `${base}/characters/${goblin.id}/resources`, gm.token, {name: 'Чужие стрелы', current: 5, max: 5})).json();
    assert.equal((await request('POST', `${base}/characters/${hero.id}/weapons`, alice.token, {name: 'Лук', ability: 'dexterity', weaponKind: 'ranged', ammoResourceId: goblinArrows.id})).statusCode, 400, 'ammunition from this sheet only');
    const bow = await weapon({name: 'Короткий лук', ability: 'dexterity', proficient: false, weaponKind: 'ranged', rangeFeet: 80, longRangeFeet: 320, ammoResourceId: arrows.id, properties: ['ammunition', 'two-handed']});
    assert.equal((await strike(bow.id)).statusCode, 201);
    assert.equal((await strike(bow.id)).statusCode, 201);
    assert.match((await strike(bow.id)).json().message, /Нет боеприпасов: «Стрелы»/);
    assert.equal((await pg.query<any>('SELECT current FROM character_resources WHERE id=$1', [arrows.id])).rows[0].current, 0);
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='action_economy'`, [campaignId]);
  });

  await t.test('7.6: the SRD weapon list gives ready weapon fields — finesse, thrown, reach, versatile, ranged', async () => {
    const list = (await request('GET', '/srd/weapons', alice.token)).json().weapons;
    assert.equal(list.length, 37);
    const by = (index: string) => list.find((entry: any) => entry.index === index).fields;
    assert.deepEqual(
      [by('dagger').ability, by('dagger').thrownRangeFeet, by('dagger').longRangeFeet, by('dagger').damageFormula],
      ['finesse', 20, 60, '1d4+@mod'],
    );
    assert.deepEqual([by('glaive').rangeFeet, by('longsword').versatileFormula, by('longbow').weaponKind, by('longbow').rangeFeet], [10, '1d10+@mod', 'ranged', 150]);
    const created = await weapon(by('longbow'));
    assert.deepEqual([created.srd_index, created.name, created.long_range_feet, created.properties], ['longbow', 'Длинный лук', 600, ['ammunition', 'heavy', 'two-handed']]);
    assert.equal((await request('GET', '/srd/weapons')).statusCode, 401);
  });

  const heroPlace = async () => (await request('GET', scenePath, gm.token)).json().objects.find((object: any) => object.character_id === hero.id);
  const walk = async (x: number, z: number, token = alice.token) => {
    const place = await heroPlace();
    return request('PUT', `${scenePath}/objects/${place.id}`, token, {
      x, y: place.y, z, rotationY: place.rotation_y, scale: place.scale, snapToGrid: place.snap_to_grid,
      parentObjectId: null, animationName: place.animation_name, revision: place.revision,
    });
  };
  const opportunityAttack = () => goblinAttack({opportunity: true});

  await t.test('7.5: leaving an enemy’s reach on your turn gives it one opportunity attack — as its reaction', async () => {
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'npc_opportunity','flag','НПС сами','false'::jsonb,$2)`, [campaignId, gm.user.id]);
    await moveGoblin(1.5, 0.5);
    await pg.query('UPDATE scene_objects SET x=0.5, z=0.5 WHERE character_id=$1', [hero.id]);
    await turnTo(hero.id);
    assert.match((await opportunityAttack()).json().message, /Атаки при уходе нет/, 'nobody left yet');
    const moved = await walk(-1.5, 0.5);
    assert.equal(moved.statusCode, 200, moved.body);
    const swing = await opportunityAttack();
    assert.equal(swing.statusCode, 201, swing.body);
    assert.equal(swing.json().outcome.distance, 15, 'the target is already 15 feet away — the attack happened as it left');
    assert.equal((await entryOf(goblin.id)).reaction_used, true);
    assert.match((await opportunityAttack()).json().message, /Атаки при уходе нет/, 'one per leaving');
    assert.equal((await request('POST', `${base}/rolls/check`, gm.token, {characterId: goblin.id, kind: 'save', key: 'dexterity', opportunity: true})).statusCode, 400);
  });

  await t.test('7.5: Disengage, someone else’s turn and a spent reaction provoke nothing', async () => {
    await pg.query('UPDATE scene_objects SET x=0.5, z=0.5 WHERE character_id=$1', [hero.id]);
    await turnTo(hero.id);
    const heroEntry = await entryOf(hero.id);
    await request('POST', `${initiative}/${heroEntry.id}/act`, alice.token, {action: 'disengage'});
    assert.equal((await walk(-1.5, 0.5)).statusCode, 200);
    assert.match((await opportunityAttack()).json().message, /Атаки при уходе нет/, 'disengaged');

    await pg.query('UPDATE scene_objects SET x=0.5, z=0.5 WHERE character_id=$1', [hero.id]);
    await turnTo(goblin.id);
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'gm_free_move','flag','Свободно','true'::jsonb,$2)`, [campaignId, gm.user.id]);
    assert.equal((await walk(-1.5, 0.5, gm.token)).statusCode, 200, 'the GM («Свободно») puts her elsewhere out of her turn');
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='gm_free_move'`, [campaignId]);
    assert.match((await opportunityAttack()).json().message, /Атаки при уходе нет/, 'not her own movement');

    await pg.query('UPDATE scene_objects SET x=0.5, z=0.5 WHERE character_id=$1', [hero.id]);
    await turnTo(hero.id);
    await pg.query('UPDATE initiative_entries SET reaction_used=true WHERE character_id=$1', [goblin.id]);
    assert.equal((await walk(-1.5, 0.5)).statusCode, 200);
    assert.match((await opportunityAttack()).json().message, /Атаки при уходе нет/, 'its reaction is gone');

    await pg.query('UPDATE scene_objects SET x=0.5, z=0.5 WHERE character_id=$1', [hero.id]);
    await turnTo(hero.id);
    assert.equal((await walk(-1.5, 0.5)).statusCode, 200);
    await request('POST', `${initiative}/advance`, alice.token);
    assert.match((await opportunityAttack()).json().message, /Атаки при уходе нет/, 'a new turn takes the chance away');
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='npc_opportunity'`, [campaignId]);
  });

  const slotsOf = async (id: string) => (await pg.query<any>(
    'SELECT level, current, max FROM character_spell_slots WHERE character_id=$1 AND max > 0 ORDER BY level', [id],
  )).rows.map((row: any) => [row.level, row.current, row.max]);
  const newCharacter = async (fields: any) => (await request('POST', `${base}/characters`, alice.token, {kind: 'character', hpMax: 20, hpCurrent: 20, ...fields})).json();
  const byClass = (id: string) => request('POST', `${base}/characters/${id}/spell-slots/by-class`, alice.token);

  await t.test('7.7: slots by class and level — full and half casters; spent slots stay spent, new ones come ready', async () => {
    const cleric = await newCharacter({name: 'Сестра Ирма', className: 'Жрец', level: 5});
    let applied = await byClass(cleric.id);
    assert.equal(applied.statusCode, 200, applied.body);
    assert.deepEqual(await slotsOf(cleric.id), [[1, 4, 4], [2, 3, 3], [3, 2, 2]]);
    await pg.query('UPDATE character_spell_slots SET current=1 WHERE character_id=$1 AND level=1', [cleric.id]);
    await patch(cleric.id, {level: 7}, alice.token);
    applied = await byClass(cleric.id);
    assert.deepEqual(await slotsOf(cleric.id), [[1, 1, 4], [2, 3, 3], [3, 3, 3], [4, 1, 1]], 'level 1 stays spent, the new 3rd and 4th are ready');
    const paladin = await newCharacter({name: 'Брат Ульрих', className: 'Paladin', level: 5});
    await byClass(paladin.id);
    assert.deepEqual(await slotsOf(paladin.id), [[1, 4, 4], [2, 2, 2]]);
    const fighter = await newCharacter({name: 'Гронд', className: 'Воин', level: 5});
    assert.match((await byClass(fighter.id)).json().message, /не заклинатель/);
  });

  await t.test('7.7: a warlock’s pact slots come back on a short rest; a new level brings new slots by itself', async () => {
    const warlock = await newCharacter({name: 'Морвен', className: 'Колдун', level: 5});
    await byClass(warlock.id);
    assert.deepEqual(await slotsOf(warlock.id), [[3, 2, 2]], 'two 3rd-level pact slots');
    await pg.query('UPDATE character_spell_slots SET current=0 WHERE character_id=$1', [warlock.id]);
    const rested = (await request('POST', `${base}/characters/${warlock.id}/rest`, alice.token, {kind: 'short'})).json();
    assert.equal(rested.result.slots, 1);
    assert.deepEqual(await slotsOf(warlock.id), [[3, 2, 2]]);

    const apprentice = await newCharacter({name: 'Ученик', className: 'Волшебник', level: 1});
    await byClass(apprentice.id);
    await pg.query('UPDATE characters SET experience=250 WHERE id=$1', [apprentice.id]);
    const award = (await request('POST', `${base}/experience`, gm.token, {characterIds: [apprentice.id], amount: 50})).json().awards[0];
    assert.deepEqual([award.level, award.readyLevel], [1, 2]);
    const levelled = await request('POST', `${base}/characters/${apprentice.id}/level-up`, alice.token, {hp: 'average', subclass: 'evocation', spells: ['shield', 'magic-missile']});
    assert.equal(levelled.statusCode, 201, levelled.body);
    assert.deepEqual([levelled.json().level, levelled.json().slotsUpdated], [2, true]);
    assert.deepEqual(await slotsOf(apprentice.id), [[1, 3, 3]]);
  });

  await t.test('7.8: an NPC turn in one click — walks up to the nearest enemy, attacks, passes the turn', async () => {
    await pg.query('UPDATE scene_objects SET x=0.5, z=0.5 WHERE character_id=$1', [hero.id]);
    await moveGoblin(4.5, 0.5);
    await turnTo(goblin.id);
    const auto = `${initiative}/auto`;
    assert.equal((await request('POST', auto, alice.token, {})).statusCode, 403);
    const response = await request('POST', auto, gm.token, {});
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json();
    assert.equal(result.target.name, 'Лира');
    assert.deepEqual([result.moved.to.x, result.moved.to.z], [1.5, 0.5], 'next to her, the shortest way');
    assert.equal(result.weapon.name, 'Скимитар');
    assert.ok(result.attack?.outcome?.target, JSON.stringify(result));
    assert.equal(result.advanced, true);
    assert.equal((await pg.query<any>('SELECT x FROM scene_objects WHERE character_id=$1', [goblin.id])).rows[0].x, 1.5);
    const goblinEntry = await entryOf(goblin.id);
    assert.deepEqual([goblinEntry.is_current, goblinEntry.moved_feet], [false, 15]);

    assert.match((await request('POST', auto, gm.token, {})).json().message, /для НПС/, 'now it is a player character turn');
  });

  await t.test('7.8: no weapon — it still closes in and says why it does not attack; advance: false keeps the turn', async () => {
    const skeleton = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Скелет', disposition: 'hostile', hpMax: 13, hpCurrent: 13, speedFeet: 30})).json();
    await request('POST', `${scenePath}/objects`, gm.token, {characterId: skeleton.id, x: -4.5, z: 0.5});
    await request('POST', `${initiative}/join`, gm.token, {characterId: skeleton.id});
    await turnTo(skeleton.id);
    const result = (await request('POST', `${initiative}/auto`, gm.token, {advance: false})).json();
    assert.equal(result.attack, null);
    assert.match(result.reason, /нет оружия/);
    assert.deepEqual([result.moved.to.x, result.advanced], [-0.5, false]);
    assert.equal((await entryOf(skeleton.id)).is_current, true);
  });

  await t.test('7.10: ending a fight sums it up — hits, damage dealt and taken, kills, experience — and keeps it', async () => {
    assert.equal((await request('DELETE', initiative, gm.token)).statusCode, 204);
    await pg.query('DELETE FROM character_effects WHERE character_id=$1', [goblin.id]);
    await pg.query('UPDATE characters SET hp_current=1, challenge_rating=1, xp_award=NULL, xp_awarded=false WHERE id=$1', [goblin.id]);
    await pg.query('UPDATE scene_objects SET x=0.5, z=0.5 WHERE character_id=$1', [hero.id]);
    await moveGoblin(1.5, 0.5);
    const xpBefore = (await pg.query<any>('SELECT experience FROM characters WHERE id=$1', [hero.id])).rows[0].experience;
    await request('POST', `${initiative}/start`, gm.token, {});
    await noEconomy();
    let hits = 0;
    for (let i = 0; i < 12; i++) {
      const result = (await attack()).json();
      if (result.outcome.hit) hits += 1;
      if (result.damage) break;
    }
    assert.equal((await request('DELETE', initiative, gm.token)).statusCode, 204);
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='action_economy'`, [campaignId]);

    const summary = (await request('GET', `${scenePath}/combat-summary`, alice.token)).json().summary;
    assert.ok(summary.rounds >= 1);
    const lira = summary.participants.find((entry: any) => entry.name === 'Лира');
    const enemy = summary.participants.find((entry: any) => entry.name === 'Гоблин');
    assert.deepEqual([lira.side, enemy.side], ['party', 'enemy']);
    assert.deepEqual([lira.hits, lira.kills], [hits, 1]);
    assert.ok(lira.damageDealt >= 3);
    assert.equal(enemy.damageTaken, lira.damageDealt, 'only she hurt the goblin this fight');
    assert.equal(lira.experience, 200, 'CR 1 — 200 XP, she is the only player character on the scene');
    assert.equal((await pg.query<any>('SELECT experience FROM characters WHERE id=$1', [hero.id])).rows[0].experience, xpBefore + 200);
    assert.equal(enemy.experience, null);
    const scene = (await pg.query<any>('SELECT combat_started_at FROM scenes WHERE id=$1', [sceneId])).rows[0];
    assert.equal(scene.combat_started_at, null, 'the next fight starts its own count');
  });
});
