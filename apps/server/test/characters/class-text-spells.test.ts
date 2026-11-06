import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('class features by count and spell effects by text', async t => {
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
  const gm = await register('gm_text'), alice = await register('alice_text');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Text'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Поле', widthCells: 20, heightCells: 20})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const hero = async (name: string, className: string, level: number, extra: any = {}) => {
    const created = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 60, hpCurrent: 60, level, ...extra})).json();
    await pg.query('UPDATE characters SET class_name=$2 WHERE id=$1', [created.id, className]);
    return created;
  };
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 200, hpCurrent: 200, armorClass: 1, ...extra,
  })).json();
  const place = (characterId: string, x: number, z: number, token = gm.token) => request('POST', `${scenePath}/objects`, token, {characterId, x, z});
  const effect = async (characterId: string, effectCode: string) =>
    (await pg.query<any>('SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code=$2 AND active', [characterId, effectCode])).rows[0]?.parameters ?? null;
  const learn = async (characterId: string, srdIndex: string) => {
    const made = await request('POST', `${base}/characters/${characterId}/spells`, gm.token, {source: 'srd', srdIndex});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const slots = (characterId: string, level: number, count: number) =>
    pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,$3,$4,$4)', [campaignId, characterId, level, count]);
  const cast = (characterId: string, entry: string, body: any, token = alice.token) =>
    request('POST', `${base}/characters/${characterId}/spells/${entry}/cast`, token, {sceneId, ...body});
  const hp = async (id: string) => (await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current as number;

  const bard = await hero('Лира', 'Бард', 5, {charisma: 16});
  const friend = await hero('Друг', 'Воин', 3);
  const far = await hero('Даль', 'Воин', 3);
  await place(bard.id, 0.5, 0.5, alice.token);
  await place(friend.id, 1.5, 0.5, alice.token);
  await place(far.id, -9.5, 9.5, alice.token);

  await t.test('bardic inspiration: a die to another creature in 60 ft, one at a time, spent on a roll', async () => {
    const give = (targetId: string) => request('POST', `${base}/characters/${bard.id}/features/bardic-inspiration`, alice.token, {sceneId, targetId});
    assert.match((await give(bard.id)).json().message, /не себе/);
    const done = await give(friend.id);
    assert.equal(done.statusCode, 200, done.body);
    assert.match(done.json().message, /кость к8/);
    assert.equal((await effect(friend.id, 'bardic_inspiration')).die, 8);
    assert.match((await give(friend.id)).json().message, /уже есть кость/);
    const resource = (await pg.query<any>(`SELECT current, max FROM character_resources WHERE character_id=$1 AND name='Вдохновение барда'`, [bard.id])).rows[0];
    assert.deepEqual(resource, {current: 2, max: 3}, 'Charisma +3 uses');

    const roll = await request('POST', `${base}/rolls/check`, alice.token, {characterId: friend.id, kind: 'ability', key: 'strength', bardic: true});
    assert.equal(roll.statusCode, 201, roll.body);
    const rider = roll.json().outcome.riders[0];
    assert.equal(rider.die, '+к8');
    assert.equal(roll.json().total, roll.json().dice_results[0] + roll.json().modifier + rider.value);
    assert.equal(await effect(friend.id, 'bardic_inspiration'), null, 'spent');
    assert.equal((await request('POST', `${base}/rolls/check`, alice.token, {characterId: friend.id, kind: 'ability', key: 'strength', bardic: true})).statusCode, 400);
  });

  await t.test('channel divinity: turn undead (destroying weak ones), sacred weapon; cleric + paladin share uses', async () => {
    const cleric = await hero('Отец Ян', 'Жрец 6 / Паладин 3', 9, {wisdom: 18, charisma: 14});
    await place(cleric.id, 5.5, 0.5, alice.token);
    const zombie = await npc('Зомби');
    const ghoul = await npc('Упырь');
    const goblin = await npc('Гоблин');
    await pg.query(`UPDATE characters SET sheet_extra='{"srdMonster":"zombie"}'::jsonb, challenge_rating=0.25, hp_current=22, hp_max=22, wisdom=1 WHERE id=$1`, [zombie.id]);
    await pg.query(`UPDATE characters SET sheet_extra='{"creatureType":"нежить"}'::jsonb, challenge_rating=5, wisdom=1 WHERE id=$1`, [ghoul.id]);
    await place(zombie.id, 6.5, 0.5);
    await place(ghoul.id, 5.5, 1.5);
    await place(goblin.id, 4.5, 1.5);
    const features = (await request('GET', `${base}/characters/${cleric.id}/features?sceneId=${sceneId}`, alice.token)).json().features;
    assert.ok(features.find((entry: any) => entry.id === 'turn-undead'));
    assert.ok(features.find((entry: any) => entry.id === 'sacred-weapon'));
    const turn = await request('POST', `${base}/characters/${cleric.id}/features/turn-undead`, alice.token, {sceneId});
    assert.equal(turn.statusCode, 200, turn.body);
    assert.match(turn.json().message, /Зомби уничтожен/);
    assert.match(turn.json().message, /Упырь изгнан|Упырь устоял/);
    assert.doesNotMatch(turn.json().message, /Гоблин/, 'only the undead');
    assert.equal(await hp(zombie.id), 0);
    const left = (await pg.query<any>(`SELECT current, max FROM character_resources WHERE character_id=$1 AND name='Божественный канал'`, [cleric.id])).rows[0];
    assert.deepEqual(left, {current: 1, max: 2});
    const turned = await effect(ghoul.id, 'turned');
    if (turned) {
      assert.equal(turned.endsOnDamage, true);
      const claw = (await request('POST', `${base}/characters/${ghoul.id}/weapons`, gm.token, {name: 'Коготь', ability: 'strength', proficient: false, damageFormula: '1d1'})).json();
      const swing = await request('POST', `${base}/rolls/check`, gm.token, {characterId: ghoul.id, kind: 'attack', key: claw.id, targetCharacterId: cleric.id});
      assert.match(swing.json().message, /изгнан/);
      const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: '1d1'})).json();
      await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId: ghoul.id, mode: 'damage'});
      assert.equal(await effect(ghoul.id, 'turned'), null, 'damage ends it');
    }

    const sacred = await request('POST', `${base}/characters/${cleric.id}/features/sacred-weapon`, alice.token, {sceneId});
    assert.equal(sacred.statusCode, 200, sacred.body);
    assert.equal((await effect(cleric.id, 'sacred_weapon')).bonus, 2);
    const mace = (await request('POST', `${base}/characters/${cleric.id}/weapons`, alice.token, {name: 'Булава', ability: 'strength', proficient: false, damageFormula: '1d1'})).json();
    const blow = await request('POST', `${base}/rolls/check`, alice.token, {characterId: cleric.id, kind: 'attack', key: mace.id, targetCharacterId: goblin.id, sceneId});
    assert.ok(blow.json().outcome.reasons.includes('священное оружие +2'), JSON.stringify(blow.json().outcome));
    assert.match((await request('POST', `${base}/characters/${cleric.id}/features/sacred-weapon`, alice.token, {sceneId})).json().message, /уже действует/);
  });

  await t.test('unarmored defence: grows with the ability on level-up and is not taken twice when multiclassing', async () => {
    const brute = await hero('Ург', 'Варвар 3', 3, {dexterity: 14, constitution: 15, armorClass: 14});
    await pg.query('UPDATE characters SET experience=2700 WHERE id=$1', [brute.id]);
    const plan = (await request('GET', `${base}/characters/${brute.id}/level-up`, alice.token)).json().plan;
    assert.ok(plan, 'enough experience for the 4th level');
    const up = await request('POST', `${base}/characters/${brute.id}/level-up`, alice.token, {hp: 'average', asi: {kind: 'asi', increases: {constitution: 1, dexterity: 1}}});
    assert.equal(up.statusCode, 201, up.body);
    assert.equal(up.json().armorClass, 15, '10 + DEX 2 + CON 3');
    const armored = await hero('Латник', 'Варвар 3', 3, {dexterity: 14, constitution: 15, armorClass: 18});
    await pg.query('UPDATE characters SET experience=2700 WHERE id = ANY($1::uuid[])', [[brute.id, armored.id]]);
    const kept = await request('POST', `${base}/characters/${armored.id}/level-up`, alice.token, {hp: 'average', asi: {kind: 'asi', increases: {constitution: 2}}});
    assert.equal(kept.json().armorClass, undefined, 'in armour — left alone');
    assert.equal((await pg.query<any>('SELECT armor_class FROM characters WHERE id=$1', [armored.id])).rows[0].armor_class, 18);
    const list = (await request('GET', `${base}/characters/${brute.id}/features`, alice.token)).json().features;
    assert.match(list.find((entry: any) => entry.id === 'unarmored-defense').detail, /КД 15/);
    await pg.query(`UPDATE characters SET class_name='Варвар 4 / Монах 1', level=5, wisdom=16 WHERE id=$1`, [brute.id]);
    const both = (await request('GET', `${base}/characters/${brute.id}/features`, alice.token)).json().features;
    const monk = both.find((entry: any) => entry.id === 'unarmored-defense-monk');
    assert.equal(monk.available, false);
    assert.match(monk.detail, /второй раз не берётся — считается по классу «Варвар»/);
  });

  await t.test('projectiles: three rays at one target or split; magic missile darts', async () => {
    const mage = await hero('Ингвар', 'Волшебник', 5, {intelligence: 18});
    await place(mage.id, 0.5, 5.5, alice.token);
    const ray = await learn(mage.id, 'scorching-ray');
    const missile = await learn(mage.id, 'magic-missile');
    await slots(mage.id, 2, 9);
    await slots(mage.id, 1, 9);
    const a = await npc('Цель А');
    const b = await npc('Цель Б');
    await place(a.id, 3.5, 5.5);
    await place(b.id, 4.5, 6.5);
    const one = await cast(mage.id, ray, {targetIds: [a.id]});
    assert.equal(one.statusCode, 201, one.body);
    assert.equal(one.json().targets.length, 3, 'three rays, three rolls');
    assert.ok(one.json().targets.every((entry: any) => entry.characterId === a.id && entry.attack));
    const split = await cast(mage.id, ray, {targetIds: [a.id, b.id], shots: [b.id, b.id, a.id]});
    assert.deepEqual(split.json().targets.map((entry: any) => entry.name), ['Цель Б', 'Цель Б', 'Цель А']);
    const upcast = await cast(mage.id, ray, {targetIds: [a.id], slotLevel: 2});
    assert.equal(upcast.json().targets.length, 3);
    assert.match((await cast(mage.id, ray, {targetIds: [a.id], shots: [a.id, a.id, a.id, a.id]})).json().message, /Снарядов всего 3/);

    const before = await hp(b.id);
    const darts = await cast(mage.id, missile, {targetIds: [b.id]});
    assert.equal(darts.statusCode, 201, darts.body);
    const hitB = darts.json().targets.find((entry: any) => entry.characterId === b.id);
    assert.equal(hitB.shots, 3);
    const each = darts.json().damageRoll.total;
    assert.equal(before - await hp(b.id), each * 3, 'three darts of one roll');
  });

  await t.test('effects on the struck: slowed, no reactions, no healing, guided, mocked, bless and bane, hunter’s mark, push; expiry at turn boundaries', async () => {
    const caster = await hero('Мира', 'Жрец', 5, {wisdom: 18, intelligence: 18, charisma: 18});
    await place(caster.id, -5.5, -5.5, alice.token);
    const victim = await npc('Жертва', {hpMax: 400, hpCurrent: 400});
    await place(victim.id, -4.5, -5.5);
    await slots(caster.id, 1, 80);
    const mate = await hero('Соратник', 'Воин', 3);
    await place(mate.id, -6.5, -5.5, alice.token);
    const castUntilHit = async (entry: string) => {
      for (let i = 0; i < 40; i++) {
        const done = await cast(caster.id, entry, {targetIds: [victim.id]});
        assert.equal(done.statusCode, 201, done.body);
        const result = done.json().targets[0];
        if (result.attack?.hit || (result.save && !result.save.success)) return done.json();
      }
      throw new Error('never struck');
    };
    await castUntilHit(await learn(caster.id, 'ray-of-frost'));
    assert.deepEqual((await effect(victim.id, 'slowed')).expires, {at: 'start', of: caster.id, skip: 0});
    assert.equal((await effect(victim.id, 'slowed')).feet, 10);
    await castUntilHit(await learn(caster.id, 'shocking-grasp'));
    assert.ok(await effect(victim.id, 'no_reactions'));
    await castUntilHit(await learn(caster.id, 'chill-touch'));
    const heal = (await request('POST', `${base}/rolls`, gm.token, {formula: '1d1+9'})).json();
    const healed = (await request('POST', `${base}/rolls/${heal.id}/apply`, gm.token, {characterId: victim.id, mode: 'heal'})).json();
    assert.equal(healed.applied, 0, 'can’t regain hit points');
    await castUntilHit(await learn(caster.id, 'guiding-bolt'));
    assert.ok(await effect(victim.id, 'guided'));
    const club = (await request('POST', `${base}/characters/${caster.id}/weapons`, alice.token, {name: 'Палка', ability: 'strength', proficient: false, damageFormula: '1d1'})).json();
    const swing = await request('POST', `${base}/rolls/check`, alice.token, {characterId: caster.id, kind: 'attack', key: club.id, targetCharacterId: victim.id, sceneId});
    assert.ok(swing.json().outcome.reasons.includes('преимущество: цель подсвечена'), JSON.stringify(swing.json().outcome));
    assert.equal(await effect(victim.id, 'guided'), null);
    await castUntilHit(await learn(caster.id, 'vicious-mockery'));
    assert.ok(await effect(victim.id, 'mocked'));
    const bite = (await request('POST', `${base}/characters/${victim.id}/weapons`, gm.token, {name: 'Укус', ability: 'strength', proficient: false, damageFormula: '1d1'})).json();
    const mocked = await request('POST', `${base}/rolls/check`, gm.token, {characterId: victim.id, kind: 'attack', key: bite.id, targetCharacterId: caster.id, sceneId});
    assert.ok(mocked.json().outcome.reasons.includes('помеха: осмеян'));
    assert.equal(await effect(victim.id, 'mocked'), null);

    const bless = await learn(caster.id, 'bless');
    assert.match((await cast(caster.id, bless, {targetIds: [caster.id, mate.id, friend.id, far.id]})).json().message, /целей не больше 3/);
    const blessed = await cast(caster.id, bless, {targetIds: [caster.id, mate.id]});
    assert.equal(blessed.statusCode, 201, blessed.body);
    assert.equal((await effect(mate.id, 'blessed')).die, 4);
    const save = await request('POST', `${base}/rolls/check`, alice.token, {characterId: mate.id, kind: 'save', key: 'wisdom'});
    assert.equal(save.json().outcome.riders[0].label, 'благословение');
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code='concentration'`, [caster.id]);

    const mark = await learn(caster.id, 'hunters-mark');
    assert.equal((await cast(caster.id, mark, {targetIds: [victim.id]})).statusCode, 201);
    assert.equal((await effect(victim.id, 'marked')).sourceCharacterId, caster.id);
    for (let i = 0; i < 40; i++) {
      const blow = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: caster.id, kind: 'attack', key: club.id, targetCharacterId: victim.id, sceneId})).json();
      if (!blow.outcome.hit) continue;
      assert.match(blow.damage.roll.label, /метка охотника/);
      assert.match(blow.damage.roll.formula, /\+\d+d6$/);
      break;
    }
    assert.equal((await effect(victim.id, 'marked')).concentrationOf, caster.id, 'held by concentration');
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code='concentration'`, [caster.id]);

    const wave = await learn(caster.id, 'thunderwave');
    for (let i = 0; i < 40; i++) {
      await pg.query('UPDATE scene_objects SET x=-4.5, z=-5.5 WHERE character_id=$1', [victim.id]);
      const template = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'cube', x: -3.5, z: -5.5, direction: 0, sizeFeet: 15})).json();
      const done = await cast(caster.id, wave, {templateId: template.id});
      assert.equal(done.statusCode, 201, done.body);
      const struck = done.json().targets.find((entry: any) => entry.characterId === victim.id);
      if (struck && !struck.save.success) {
        assert.deepEqual(struck.effects, ['отброшен на 10 фт.']);
        const at = (await pg.query<any>('SELECT x FROM scene_objects WHERE character_id=$1', [victim.id])).rows[0];
        assert.equal(Number(at.x), -2.5);
        break;
      }
    }

    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code IN ('no_reactions','no_healing')`, [victim.id]);
    await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId: caster.id});
    await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId: victim.id});
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    const queue = (await request('GET', `${scenePath}/initiative`, gm.token)).json().entries;
    const casterFirst = queue.find((entry: any) => entry.is_current)?.character_id === caster.id;
    if (!casterFirst) await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    assert.equal(await effect(victim.id, 'slowed'), null, 'gone at the start of the caster’s turn');
  });

  await t.test('sleep: the pool from the lowest hit points; the undead are immune; damage wakes', async () => {
    const sleeper = await hero('Сонник', 'Волшебник', 3, {intelligence: 16});
    await place(sleeper.id, 9.5, 9.5, alice.token);
    const sleep = await learn(sleeper.id, 'sleep');
    await slots(sleeper.id, 1, 2);
    const kobold = await npc('Кобольд', {hpMax: 2, hpCurrent: 2});
    const ogre = await npc('Огр', {hpMax: 59, hpCurrent: 59});
    const skeleton = await npc('Скелет', {hpMax: 3, hpCurrent: 3});
    await pg.query(`UPDATE characters SET sheet_extra='{"srdMonster":"skeleton"}'::jsonb WHERE id=$1`, [skeleton.id]);
    await place(kobold.id, 5.5, 5.5);
    await place(ogre.id, 6.5, 5.5);
    await place(skeleton.id, 5.5, 6.5);
    const template = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: 6, z: 6, direction: 0, sizeFeet: 20})).json();
    const done = await cast(sleeper.id, sleep, {templateId: template.id});
    assert.equal(done.statusCode, 201, done.body);
    const byName = Object.fromEntries(done.json().targets.map((entry: any) => [entry.name, entry]));
    assert.equal(byName['Кобольд'].condition, true, '2 hit points always fit 5d8');
    assert.equal(byName['Огр'].condition, false, '59 never fits 40');
    assert.equal(byName['Скелет'].sleep.immune, true);
    assert.equal(byName['Скелет'].condition, false);
    assert.equal((await effect(kobold.id, 'unconscious')).endsOnDamage, true);
    assert.equal(await effect(ogre.id, 'unconscious'), null);
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: '1d1'})).json();
    await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId: kobold.id, mode: 'damage'});
    assert.equal(await effect(kobold.id, 'unconscious'), null, 'woken by damage');
  });
});
