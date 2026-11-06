import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('potent cantrip, overchannel, supreme healing, fiendish resilience, draconic resilience, hunter tactics and multiattack', async t => {
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
  const gm = await register('gm_subcap'), alice = await register('alice_subcap');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Subclass capstones'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  await request('POST', `/campaigns/${campaignId}/rules`, gm.token, {key: 'npc_opportunity', kind: 'flag', label: 'НПС сами', value: false});
  const base = `/campaigns/${campaignId}`;
  const hero = async (name: string, className: string, level: number, extra: any = {}) => {
    const made = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 300, hpCurrent: 300, level, speedFeet: 30, ...extra})).json();
    await pg.query('UPDATE characters SET class_name=$2 WHERE id=$1', [made.id, className]);
    return made;
  };
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 1000, hpCurrent: 1000, armorClass: 10, speedFeet: 30, ...extra,
  })).json();
  const saveBonus = (id: string, ability: string, bonus: number) => pg.query(
    'INSERT INTO character_saves (campaign_id, character_id, ability, proficient, custom_bonus) VALUES ($1,$2,$3,false,$4)', [campaignId, id, ability, bonus],
  );
  const slots = (id: string, level: number, count: number) => pg.query(
    'INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,$3,$4,$4)', [campaignId, id, level, count],
  );
  const learn = async (characterId: string, name: string, level: number, mechanics: Record<string, unknown>, token = alice.token) => {
    const columns = Object.keys(mechanics);
    const spellId = (await pg.query<any>(
      `INSERT INTO campaign_spells (campaign_id, created_by, name, level, school, status, range${columns.map(column => `, ${column}`).join('')})
       VALUES ($1,$2,$3,$4,'Evocation','approved','60 feet'${columns.map((_, index) => `, $${index + 5}`).join('')}) RETURNING id`,
      [campaignId, alice.user.id, name, level, ...Object.values(mechanics)],
    )).rows[0].id;
    const entry = await request('POST', `${base}/characters/${characterId}/spells`, token, {source: 'custom', customSpellId: spellId});
    assert.equal(entry.statusCode, 201, entry.body);
    return entry.json().id as string;
  };
  const cast = (characterId: string, entry: string, body: any, token = alice.token) => request('POST', `${base}/characters/${characterId}/spells/${entry}/cast`, token, body);
  const hp = async (id: string) => Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current);
  const codes = async (id: string) => (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active', [id])).rows.map(row => row.effect_code as string);
  const effect = async (id: string, code: string) => (await pg.query<any>('SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code=$2 AND active', [id, code])).rows[0]?.parameters ?? null;
  const lastRoll = async (characterId: string, like: string) => (await pg.query<any>(
    `SELECT outcome, total FROM roll_log WHERE character_id=$1 AND label LIKE $2 ORDER BY created_at DESC LIMIT 1`, [characterId, like],
  )).rows[0];
  const feature = async (characterId: string, id: string) => (await request('GET', `${base}/characters/${characterId}/features`, alice.token)).json().features.find((entry: any) => entry.id === id);
  const hurt = async (characterId: string, amount: number, damageType: string) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: `1d1+${amount - 1}`})).json();
    const applied = await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId, mode: 'damage', damageType});
    assert.equal(applied.statusCode, 200, applied.body);
  };
  const weapon = async (characterId: string, body: any, token = alice.token) => {
    const made = await request('POST', `${base}/characters/${characterId}/weapons`, token, {ability: 'strength', proficient: false, attackBonus: 20, damageFormula: '1d1', ...body});
    assert.equal(made.statusCode, 201, made.body);
    return made.json();
  };
  const scene = async (name: string, members: Array<[string, string, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 30, heightCells: 12})).json().id as string;
    for (const [token, characterId, x, z] of members) {
      const placed = await request('POST', `${base}/scenes/${sceneId}/objects`, token, {characterId, x, z});
      assert.equal(placed.statusCode, 201, placed.body);
    }
    return sceneId;
  };
  const fight = async (sceneId: string, currentId: string) => {
    assert.equal((await request('POST', `${base}/scenes/${sceneId}/initiative/start`, gm.token, {})).statusCode, 201);
    await pg.query(`UPDATE initiative_entries SET is_current = (character_id = $2), action_used=false, attacks_made=0, reaction_used=false WHERE scene_id=$1`, [sceneId, currentId]);
  };

  await t.test('potent cantrip: a saved cantrip still deals half; wizard 5 — nothing', async () => {
    const mage = await hero('Воплотитель', 'Волшебник', 6, {intelligence: 16});
    const novice = await hero('Ученик', 'Волшебник', 5, {intelligence: 16});
    const dodger = await npc('Ловкач');
    await saveBonus(dodger.id, 'dexterity', 40);
    const spark = await learn(mage.id, 'Искра', 0, {save_ability: 'dexterity', damage_formula: '1d1+9', damage_type: 'fire'});
    const sceneId = await scene('Полигон', [[alice.token, mage.id, 0.5, 0.5], [alice.token, novice.id, 0.5, 1.5], [gm.token, dodger.id, 3.5, 0.5]]);
    const before = await hp(dodger.id);
    const done = await cast(mage.id, spark, {sceneId, targetIds: [dodger.id]});
    assert.equal(done.statusCode, 201, done.body);
    const entry = done.json().targets.find((item: any) => item.characterId === dodger.id);
    assert.equal(entry.save.success, true);
    assert.equal(entry.potent, true);
    assert.equal(before - await hp(dodger.id), 5, '10 fire, saved — half');
    const listed = await feature(mage.id, 'potent-cantrip');
    assert.ok(listed, 'evocation 6 lists potent cantrip');

    const plain = await learn(novice.id, 'Искра ученика', 0, {save_ability: 'dexterity', damage_formula: '1d1+9', damage_type: 'fire'});
    const again = await hp(dodger.id);
    assert.equal((await cast(novice.id, plain, {sceneId, targetIds: [dodger.id]})).statusCode, 201);
    assert.equal(await hp(dodger.id), again, 'without potent cantrip a saved cantrip does nothing');
  });

  await t.test('overchannel: maximum damage; the second use burns 2d12 per level, the third 3d12 — through immunity; a long rest resets it', async () => {
    const mage = await hero('Архимаг', 'Волшебник', 14, {intelligence: 18});
    await slots(mage.id, 3, 9);
    await slots(mage.id, 6, 1);
    const target = await npc('Голем', {hpMax: 5000, hpCurrent: 5000});
    await saveBonus(target.id, 'dexterity', -40);
    const blast = await learn(mage.id, 'Взрыв', 3, {save_ability: 'dexterity', half_on_save: true, damage_formula: '8d6', damage_type: 'fire'});
    const sceneId = await scene('Башня', [[alice.token, mage.id, 0.5, 0.5], [gm.token, target.id, 4.5, 0.5]]);

    let before = await hp(target.id);
    const first = await cast(mage.id, blast, {sceneId, targetIds: [target.id], overchannel: true});
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(before - await hp(target.id), 48 + 4, '8d6 at maximum, + INT from empowered evocation');
    assert.deepEqual(first.json().overchannel, {uses: 1, damage: 0}, 'the first time is free');
    assert.equal((await effect(mage.id, 'overchannel')).uses, 1);
    assert.match((await feature(mage.id, 'overchannel')).detail, /следующий: 2к12/);

    const mageBefore = await hp(mage.id);
    const second = await cast(mage.id, blast, {sceneId, targetIds: [target.id], overchannel: true});
    assert.equal(second.statusCode, 201, second.body);
    const burned = second.json().overchannel.damage;
    assert.ok(burned >= 6 && burned <= 72, `6d12 necrotic: ${burned}`);
    assert.equal(mageBefore - await hp(mage.id), burned);
    const selfRoll = await lastRoll(mage.id, 'Сверхзаряд%');
    assert.equal(selfRoll.outcome.damageType, 'necrotic');

    await pg.query(`UPDATE characters SET damage_immunities='["necrotic"]'::jsonb WHERE id=$1`, [mage.id]);
    const third = await cast(mage.id, blast, {sceneId, targetIds: [target.id], overchannel: true});
    assert.equal(third.statusCode, 201, third.body);
    assert.ok(third.json().overchannel.damage >= 9, 'immunity does not help: 9d12');

    before = await hp(target.id);
    const plain = await cast(mage.id, blast, {sceneId, targetIds: [target.id]});
    assert.equal(plain.statusCode, 201);
    assert.ok(before - await hp(target.id) <= 48 + 4, 'without the box — an ordinary roll');
    assert.equal((await effect(mage.id, 'overchannel')).uses, 3, 'an ordinary cast does not count');

    const big = await learn(mage.id, 'Буря', 6, {save_ability: 'dexterity', damage_formula: '10d6', damage_type: 'lightning'});
    const tooHigh = await cast(mage.id, big, {sceneId, targetIds: [target.id], overchannel: true});
    assert.equal(tooHigh.statusCode, 400);
    assert.match(tooHigh.body, /1–5 уровня/);
    const young = await hero('Подмастерье', 'Волшебник', 13, {intelligence: 18});
    await slots(young.id, 3, 2);
    const youngBlast = await learn(young.id, 'Взрыв ученика', 3, {save_ability: 'dexterity', damage_formula: '8d6', damage_type: 'fire'});
    assert.equal((await cast(young.id, youngBlast, {sceneId, targetIds: [target.id], overchannel: true})).statusCode, 400, 'wizard 13 — no overchannel');

    const rest = await request('POST', `${base}/characters/${mage.id}/rest`, alice.token, {kind: 'long'});
    assert.equal(rest.statusCode, 200, rest.body);
    assert.ok(!(await codes(mage.id)).includes('overchannel'), 'a long rest — the count starts over');
  });

  await t.test('supreme healing: healing dice are at maximum (life 17); cleric 16 rolls', async () => {
    const cleric = await hero('Святитель', 'Жрец', 17, {wisdom: 18});
    const patient = await hero('Раненый', 'Воин', 5, {hpMax: 300, hpCurrent: 10});
    await slots(cleric.id, 1, 4);
    const cure = await learn(cleric.id, 'Лечение', 1, {healing_formula: '2d8'});
    const sceneId = await scene('Храм', [[alice.token, cleric.id, 0.5, 0.5], [alice.token, patient.id, 1.5, 0.5]]);
    const done = await cast(cleric.id, cure, {sceneId, targetIds: [patient.id]});
    assert.equal(done.statusCode, 201, done.body);
    assert.equal(await hp(patient.id), 10 + 16 + 3, '2d8 at maximum + disciple of life (2 + 1)');
    const roll = await lastRoll(cleric.id, 'Заклинание: Лечение (лечение)%');
    assert.ok(roll.outcome.reasons.includes('высшее исцеление: кости наибольшие'), JSON.stringify(roll.outcome));

    const junior = await hero('Послушник', 'Жрец', 16, {wisdom: 18});
    await slots(junior.id, 1, 4);
    const juniorCure = await learn(junior.id, 'Лечение послушника', 1, {healing_formula: '2d8'});
    await scene('Часовня', [[alice.token, junior.id, 0.5, 0.5]]);
    assert.equal((await cast(junior.id, juniorCure, {targetIds: [patient.id]})).statusCode, 201);
    const juniorRoll = await lastRoll(junior.id, 'Заклинание: Лечение послушника (лечение)%');
    assert.ok(!(juniorRoll.outcome?.reasons ?? []).includes('высшее исцеление: кости наибольшие'));
  });

  await t.test('fiendish resilience: the chosen damage type is halved; changed out of combat only', async () => {
    const warlock = await hero('Исчадие', 'Колдун', 10, {charisma: 18});
    const listed = await feature(warlock.id, 'fiendish-resilience');
    assert.equal(listed.detail, 'вид урона не выбран');
    assert.equal(listed.choices.length, 13);
    const picked = await request('PUT', `${base}/characters/${warlock.id}/fiendish-resilience`, alice.token, {fire: true});
    assert.equal(picked.statusCode, 200, picked.body);
    assert.deepEqual(picked.json().fiendishResilience, ['fire']);
    let before = await hp(warlock.id);
    await hurt(warlock.id, 10, 'fire');
    assert.equal(before - await hp(warlock.id), 5, 'fire — resisted');
    before = await hp(warlock.id);
    await hurt(warlock.id, 10, 'cold');
    assert.equal(before - await hp(warlock.id), 10, 'cold — full');
    await request('PUT', `${base}/characters/${warlock.id}/fiendish-resilience`, alice.token, {cold: true});
    before = await hp(warlock.id);
    await hurt(warlock.id, 10, 'fire');
    assert.equal(before - await hp(warlock.id), 10, 'the new choice replaces the old');

    const foe = await npc('Ангел');
    const sceneId = await scene('Ад', [[alice.token, warlock.id, 0.5, 0.5], [gm.token, foe.id, 2.5, 0.5]]);
    await fight(sceneId, warlock.id);
    const inFight = await request('PUT', `${base}/characters/${warlock.id}/fiendish-resilience`, alice.token, {fire: true});
    assert.equal(inFight.statusCode, 400);
    assert.match(inFight.body, /в бою/);
  });

  await t.test('draconic resilience: listed with 13 + DEX, and the unarmored AC grows with DEX on a new level', async () => {
    const sorcerer = await hero('Драконья кровь', 'Чародей', 3, {dexterity: 14, armorClass: 15});
    await pg.query('UPDATE characters SET experience=2700 WHERE id=$1', [sorcerer.id]);
    const listed = await feature(sorcerer.id, 'draconic-resilience');
    assert.equal(listed.detail, 'без доспехов КД 15; +1 хит за уровень чародея');
    const up = await request('POST', `${base}/characters/${sorcerer.id}/level-up`, alice.token, {hp: 'average', asi: {kind: 'asi', increases: {dexterity: 2}}, cantrips: ['fire-bolt'], spells: ['shield']});
    assert.equal(up.statusCode, 201, up.body);
    const row = (await pg.query<any>('SELECT dexterity, armor_class FROM characters WHERE id=$1', [sorcerer.id])).rows[0];
    assert.deepEqual([row.dexterity, row.armor_class], [16, 16], 'DEX 16 — AC 13 + 3');
  });

  await t.test('defensive tactics: steel will against fear, escape the horde against opportunity attacks, multiattack defense after a hit', async () => {
    const ranger = await hero('Охотник', 'Следопыт', 7, {dexterity: 16, armorClass: 15});
    const tactics = await feature(ranger.id, 'defensive-tactics');
    assert.deepEqual(tactics.choices.map((choice: any) => choice.value), ['escape-the-horde', 'multiattack-defense', 'steel-will']);
    assert.equal((await request('PUT', `${base}/characters/${ranger.id}/defensive-tactics`, alice.token, {'steel-will': true})).statusCode, 200);

    const witch = await npc('Ведьма', {charisma: 18});
    const fear = await learn(witch.id, 'Жуть', 0, {save_ability: 'wisdom', condition_code: 'frightened', condition_rounds: 2}, gm.token);
    const sceneId = await scene('Лес', [[alice.token, ranger.id, 0.5, 0.5], [gm.token, witch.id, 1.5, 0.5]]);
    assert.equal((await cast(witch.id, fear, {sceneId, targetIds: [ranger.id]}, gm.token)).statusCode, 201);
    const save = (await lastRoll(ranger.id, 'Спасбросок%')).outcome;
    assert.equal(save.advantage, 'adv', JSON.stringify(save));
    assert.ok(save.reasons.some((reason: string) => /стальная воля/.test(reason)), JSON.stringify(save.reasons));

    assert.deepEqual((await request('PUT', `${base}/characters/${ranger.id}/defensive-tactics`, alice.token, {'escape-the-horde': true})).json().defensiveTactics, ['escape-the-horde']);
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [ranger.id]);
    const claws = await weapon(witch.id, {name: 'Когти'}, gm.token);
    await fight(sceneId, ranger.id);
    const placed = (await request('GET', `${base}/scenes/${sceneId}`, gm.token)).json().objects.find((entry: any) => entry.character_id === ranger.id);
    const walked = await request('PUT', `${base}/scenes/${sceneId}/objects/${placed.id}`, alice.token, {
      x: -2.5, y: placed.y, z: 0.5, rotationY: placed.rotation_y, scale: placed.scale, snapToGrid: placed.snap_to_grid, parentObjectId: null, animationName: placed.animation_name, revision: placed.revision,
    });
    assert.equal(walked.statusCode, 200, walked.body);
    const strike = await request('POST', `${base}/rolls/check`, gm.token, {characterId: witch.id, kind: 'attack', key: claws.id, targetCharacterId: ranger.id, sceneId, opportunity: true});
    assert.equal(strike.statusCode, 201, strike.body);
    const attack = (await lastRoll(witch.id, '%Когти%')).outcome;
    assert.equal(attack.advantage, 'disadv', JSON.stringify(attack));
    assert.ok(attack.reasons.some((reason: string) => /уйти от толпы/.test(reason)), JSON.stringify(attack.reasons));

    await request('PUT', `${base}/characters/${ranger.id}/defensive-tactics`, alice.token, {'multiattack-defense': true});
    const away = (await request('GET', `${base}/scenes/${sceneId}`, gm.token)).json().objects.find((entry: any) => entry.character_id === ranger.id);
    const back = await request('PUT', `${base}/scenes/${sceneId}/objects/${away.id}`, gm.token, {
      x: 0.5, y: away.y, z: 0.5, rotationY: away.rotation_y, scale: away.scale, snapToGrid: away.snap_to_grid, parentObjectId: null, animationName: away.animation_name, revision: away.revision,
    });
    assert.equal(back.statusCode, 200, back.body);
    await pg.query(`UPDATE initiative_entries SET is_current = (character_id = $2) WHERE scene_id=$1`, [sceneId, witch.id]);
    let guarded = false;
    for (let i = 0; i < 10 && !guarded; i++) {
      await pg.query('UPDATE initiative_entries SET action_used=false, attacks_made=0 WHERE character_id=$1', [witch.id]);
      const hit = await request('POST', `${base}/rolls/check`, gm.token, {characterId: witch.id, kind: 'attack', key: claws.id, targetCharacterId: ranger.id, sceneId});
      assert.equal(hit.statusCode, 201, hit.body);
      guarded = Boolean(await effect(ranger.id, 'multiattack_defense'));
    }
    assert.ok(guarded, 'a hit sooner or later');
    assert.equal((await effect(ranger.id, 'multiattack_defense')).from, witch.id);
    await pg.query('UPDATE initiative_entries SET action_used=false, attacks_made=0 WHERE character_id=$1', [witch.id]);
    await request('POST', `${base}/rolls/check`, gm.token, {characterId: witch.id, kind: 'attack', key: claws.id, targetCharacterId: ranger.id, sceneId});
    const next = (await lastRoll(witch.id, '%Когти%')).outcome;
    assert.ok(next.reasons.some((reason: string) => /защита от мультиатаки: КД \+4/.test(reason)), JSON.stringify(next.reasons));
    assert.equal((await request('POST', `${base}/scenes/${sceneId}/initiative/advance`, gm.token, {})).statusCode, 204);
    assert.ok(!(await codes(ranger.id)).includes('multiattack_defense'), 'gone when the turn ends');
  });

  await t.test('hunter multiattack: whirlwind hits every foe within 5 ft, volley the target and everyone within 10 ft of it', async () => {
    const ranger = await hero('Вихрь', 'Следопыт', 11, {dexterity: 18, strength: 16});
    await weapon(ranger.id, {name: 'Короткий меч'});
    const bow = await weapon(ranger.id, {name: 'Длинный лук', ability: 'dexterity', weaponKind: 'ranged', rangeFeet: 150, longRangeFeet: 600});
    const friend = await hero('Друг', 'Воин', 5);
    const [left, right, far, a, b, c] = await Promise.all(['Слева', 'Справа', 'Вдали', 'Стрелок А', 'Стрелок Б', 'Стрелок В'].map(name => npc(name)));
    const sceneId = await scene('Поле', [
      [alice.token, ranger.id, 0.5, 0.5], [alice.token, friend.id, 0.5, 1.5], [gm.token, left.id, -0.5, 0.5], [gm.token, right.id, 1.5, 0.5],
      [gm.token, far.id, 4.5, 3.5], [gm.token, a.id, 8.5, 0.5], [gm.token, b.id, 9.5, 0.5], [gm.token, c.id, 11.5, 0.5],
    ]);
    const unchosen = await request('POST', `${base}/characters/${ranger.id}/features/whirlwind`, alice.token, {sceneId});
    assert.equal(unchosen.statusCode, 400);
    assert.match(unchosen.body, /вариант не выбран/);
    assert.equal((await request('PUT', `${base}/characters/${ranger.id}/hunter-multiattack`, alice.token, {whirlwind: true})).statusCode, 200);
    await fight(sceneId, ranger.id);
    const spin = await request('POST', `${base}/characters/${ranger.id}/features/whirlwind`, alice.token, {sceneId});
    assert.equal(spin.statusCode, 200, spin.body);
    assert.equal(spin.json().attacks.length, 2, spin.body);
    assert.match(spin.json().message, /Слева/);
    assert.match(spin.json().message, /Справа/);
    assert.doesNotMatch(spin.json().message, /Друг|Вдали/);
    assert.equal((await pg.query<any>('SELECT action_used FROM initiative_entries WHERE character_id=$1', [ranger.id])).rows[0].action_used, true);

    await request('PUT', `${base}/characters/${ranger.id}/hunter-multiattack`, alice.token, {volley: true});
    await pg.query('UPDATE initiative_entries SET action_used=false, attacks_made=0 WHERE character_id=$1', [ranger.id]);
    const volley = await request('POST', `${base}/characters/${ranger.id}/features/volley`, alice.token, {sceneId, targetId: a.id, weaponId: bow.id});
    assert.equal(volley.statusCode, 200, volley.body);
    assert.equal(volley.json().attacks.length, 2, volley.body);
    assert.match(volley.json().message, /Стрелок А/);
    assert.match(volley.json().message, /Стрелок Б/);
    assert.doesNotMatch(volley.json().message, /Стрелок В/, '15 ft from the point — out');
  });
});
