import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('subclasses, maneuvers, colossus slayer, Life domain, the rest of metamagic, NPC sorcerer and battle master', async t => {
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
  const gm = await register('gm_sub'), alice = await register('alice_sub');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Sub'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const classed = async (id: string, className: string) => pg.query('UPDATE characters SET class_name=$2 WHERE id=$1', [id, className]);
  const hero = async (name: string, className: string, level: number, extra: any = {}) => {
    const made = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 60, hpCurrent: 60, level, speedFeet: 30, ...extra})).json();
    await classed(made.id, className);
    return made;
  };
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 100, hpCurrent: 100, armorClass: 5, speedFeet: 30, ...extra,
  })).json();
  const weapon = async (id: string, body: any, token = gm.token) => (await request('POST', `${base}/characters/${id}/weapons`, token, {ability: 'strength', proficient: false, damageFormula: '1d1', ...body})).json();
  const learn = async (characterId: string, srdIndex: string) => {
    const made = await request('POST', `${base}/characters/${characterId}/spells`, gm.token, {source: 'srd', srdIndex});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const slots = (characterId: string, level: number, count: number) =>
    pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,$3,$4,$4)', [campaignId, characterId, level, count]);
  const effect = async (id: string, code: string) => (await pg.query<any>('SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code=$2 AND active', [id, code])).rows[0]?.parameters ?? null;
  const hp = async (id: string) => Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current);
  const resource = async (id: string, name: string) => (await pg.query<any>('SELECT current FROM character_resources WHERE character_id=$1 AND name=$2', [id, name])).rows[0]?.current;
  const features = async (id: string, token = alice.token, sceneId?: string) => (await request('GET', `${base}/characters/${id}/features${sceneId ? `?sceneId=${sceneId}` : ''}`, token)).json();
  const spot = async (id: string) => (await pg.query<any>('SELECT x::float8 AS x, z::float8 AS z FROM scene_objects WHERE character_id=$1', [id])).rows[0] as {x: number; z: number};
  const arena = async (name: string, members: Array<[string, string, number, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 24, heightCells: 12})).json().id;
    const scenePath = `${base}/scenes/${sceneId}`;
    for (const [token, characterId, x, z] of members) await request('POST', `${scenePath}/objects`, token, {characterId, x, z});
    for (const [, characterId, , , score] of members) {
      const id = (await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId})).json().id;
      await request('PATCH', `${scenePath}/initiative/${id}`, gm.token, {score});
    }
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    return {sceneId, scenePath, auto: async () => (await request('POST', `${scenePath}/initiative/auto`, gm.token, {advance: false})).json()};
  };
  const fresh = (id: string) => pg.query('UPDATE initiative_entries SET action_used=false, bonus_used=false, bonus_spell=false, attacks_made=0, colossus_used=false WHERE character_id=$1', [id]);

  await t.test('the subclass: SRD by default, from the class text, chosen in the features; champion crits only for champions', async () => {
    const fighter = await hero('Боец', 'Воин', 3);
    let list = await features(fighter.id);
    assert.deepEqual(list.subclasses.map((entry: any) => [entry.classId, entry.value]), [['fighter', 'champion']]);
    assert.ok(list.features.some((entry: any) => entry.id === 'improved-critical'));
    const set = await request('PUT', `${base}/characters/${fighter.id}/subclass`, alice.token, {classId: 'fighter', subclass: 'battle-master'});
    assert.equal(set.statusCode, 200, set.body);
    list = await features(fighter.id);
    assert.deepEqual(list.features.map((entry: any) => entry.id).filter((id: string) => ['improved-critical', 'combat-superiority'].includes(id)), ['combat-superiority']);
    const wall = await npc('Стена', {armorClass: 30});
    const sword = await weapon(fighter.id, {name: 'Меч'}, alice.token);
    const blow = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: fighter.id, kind: 'attack', key: sword.id, targetCharacterId: wall.id})).json();
    assert.equal(blow.outcome.critAt, undefined, 'a battle master crits on 20 only');

    const fromText = await hero('Мастер', 'Воин (Мастер боевых искусств) 3', 3);
    assert.equal((await features(fromText.id)).subclasses[0].value, 'battle-master');
    const young = await hero('Новобранец', 'Воин', 2);
    assert.deepEqual((await features(young.id)).subclasses, [], 'no subclass before 3rd level');
    assert.equal((await request('PUT', `${base}/characters/${young.id}/subclass`, alice.token, {classId: 'fighter', subclass: 'champion'})).statusCode, 400);
  });

  await t.test('maneuvers: after a weapon hit — a superiority die to damage and the effect; once per hit; the NPC battle master trips on its own', async () => {
    const master = await hero('Тактик', 'Воин (Мастер боевых искусств) 3', 3, {strength: 16});
    const blade = await weapon(master.id, {name: 'Клинок', attackBonus: 20, damageFormula: '1d6', damageType: 'slashing'}, alice.token);
    const dummy = await npc('Чучело-1', {strength: 1, wisdom: 1, hpMax: 300, hpCurrent: 300});
    const other = await npc('Чучело-2', {hpMax: 300, hpCurrent: 300});
    assert.deepEqual((await request('PUT', `${base}/characters/${master.id}/maneuvers`, alice.token, {trip: true, menacing: true, distracting: true, pushing: true})).json().maneuvers, ['trip', 'pushing', 'menacing', 'distracting']);
    const {sceneId} = await arena('Плац', [[alice.token, master.id, 0.5, 0.5, 30], [gm.token, dummy.id, 1.5, 0.5, 5], [gm.token, other.id, 0.5, 1.5, 4]]);
    const swing = async (targetId: string) => {
      for (let i = 0; i < 10; i++) {
        await fresh(master.id);
        const blow = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: master.id, kind: 'attack', key: blade.id, targetCharacterId: targetId, sceneId})).json();
        if (blow.maneuver) return blow;
      }
      throw new Error('never hit');
    };
    let blow = await swing(dummy.id);
    assert.deepEqual([blow.maneuver.dice, blow.maneuver.die, blow.maneuver.maneuvers.length], [4, 8, 4]);
    const before = await hp(dummy.id);
    let tripped = false;
    for (let i = 0; i < 12 && !tripped; i++) {
      if (i) blow = await swing(dummy.id);
      const used = await request('POST', `${base}/rolls/${blow.maneuver.rollId}/maneuver`, alice.token, {maneuver: 'trip'});
      assert.equal(used.statusCode, 201, used.body);
      assert.ok(used.json().value >= 1 && used.json().value <= 16);
      assert.match((await request('POST', `${base}/rolls/${blow.maneuver.rollId}/maneuver`, alice.token, {maneuver: 'trip'})).json().message, /уже был|потрачено/);
      tripped = Boolean(await effect(dummy.id, 'prone'));
      if (Number(await resource(master.id, 'Кости превосходства')) === 0) await pg.query(`UPDATE character_resources SET current=4 WHERE character_id=$1 AND name='Кости превосходства'`, [master.id]);
    }
    assert.ok(tripped, 'STR −5 against DC 13 — on the floor sooner or later');
    assert.ok(await hp(dummy.id) < before);

    await pg.query(`UPDATE character_resources SET current=4 WHERE character_id=$1 AND name='Кости превосходства'`, [master.id]);
    blow = await swing(other.id);
    const distract = (await request('POST', `${base}/rolls/${blow.maneuver.rollId}/maneuver`, alice.token, {maneuver: 'distracting'})).json();
    assert.match(distract.effect, /с преимуществом/);
    assert.equal((await effect(other.id, 'guided')).notBy, master.id);
    await fresh(master.id);
    const own = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: master.id, kind: 'attack', key: blade.id, targetCharacterId: other.id, sceneId})).json();
    assert.ok(!(own.outcome.reasons ?? []).includes('преимущество: цель отвлечена'), 'not for the one who distracted');
    const ally = await hero('Соратник', 'Воин', 2);
    const axe = await weapon(ally.id, {name: 'Топор'}, alice.token);
    const theirs = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: ally.id, kind: 'attack', key: axe.id, targetCharacterId: other.id})).json();
    assert.ok(theirs.outcome.reasons.includes('преимущество: цель отвлечена'), JSON.stringify(theirs.outcome));

    await pg.query(`UPDATE character_resources SET current=4 WHERE character_id=$1 AND name='Кости превосходства'`, [master.id]);
    const from = await spot(other.id);
    let pushed = false;
    for (let i = 0; i < 12 && !pushed; i++) {
      await pg.query('UPDATE scene_objects SET x=$2, z=$3 WHERE character_id=$1', [other.id, from.x, from.z]);
      blow = await swing(other.id);
      const push = (await request('POST', `${base}/rolls/${blow.maneuver.rollId}/maneuver`, alice.token, {maneuver: 'pushing'})).json();
      pushed = /отброшен на 15 фт\./.test(push.effect ?? '');
      if (Number(await resource(master.id, 'Кости превосходства')) === 0) await pg.query(`UPDATE character_resources SET current=4 WHERE character_id=$1 AND name='Кости превосходства'`, [master.id]);
    }
    assert.ok(pushed, 'pushed 15 feet sooner or later');

    const brute = await npc('Сержант', {strength: 16, level: 3});
    await classed(brute.id, 'Воин (Мастер боевых искусств) 3');
    await weapon(brute.id, {name: 'Алебарда', attackBonus: 20, damageFormula: '1d10'});
    await request('PUT', `${base}/characters/${brute.id}/maneuvers`, gm.token, {trip: true});
    const recruit = await hero('Рекрут', 'Воин', 3, {hpMax: 400, hpCurrent: 400, strength: 1});
    const fight = await arena('Учения', [[gm.token, brute.id, 0.5, 0.5, 30], [alice.token, recruit.id, 1.5, 0.5, 5]]);
    const turn = await fight.auto();
    assert.match(turn.summary, /«Атака с подсечкой» по «Рекрут»: \+\d+, /, turn.summary);
  });

  await t.test('colossus slayer: +1d8 against a wounded creature once per turn, not against an unhurt one', async () => {
    const ranger = await hero('Следопытка', 'Следопыт', 3, {dexterity: 16});
    const bow = await weapon(ranger.id, {name: 'Лук', ability: 'dexterity', attackBonus: 20, damageFormula: '1d1', weaponKind: 'ranged', rangeFeet: 80, longRangeFeet: 320}, alice.token);
    assert.deepEqual((await request('PUT', `${base}/characters/${ranger.id}/hunters-prey`, alice.token, {'giant-killer': true})).json().huntersPrey, ['giant-killer']);
    assert.deepEqual((await request('PUT', `${base}/characters/${ranger.id}/hunters-prey`, alice.token, {'colossus-slayer': true})).json().huntersPrey, ['colossus-slayer'], 'one choice — the new one replaces');
    const beast = await npc('Зверь', {hpMax: 300, hpCurrent: 300});
    const {sceneId} = await arena('Охота', [[alice.token, ranger.id, 0.5, 0.5, 30], [gm.token, beast.id, 4.5, 0.5, 5]]);
    const shoot = async () => {
      for (let i = 0; i < 10; i++) {
        await pg.query('UPDATE initiative_entries SET action_used=false, attacks_made=0 WHERE character_id=$1', [ranger.id]);
        const shot = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: ranger.id, kind: 'attack', key: bow.id, targetCharacterId: beast.id, sceneId})).json();
        if (shot.damage) return shot;
      }
      throw new Error('never hit');
    };
    const first = await shoot();
    assert.doesNotMatch(first.damage.roll.label, /убийца колоссов/, 'unhurt — no extra die');
    const second = await shoot();
    assert.match(second.damage.roll.label, /убийца колоссов/);
    const third = await shoot();
    assert.doesNotMatch(third.damage.roll.label, /убийца колоссов/, 'once per turn');
    await pg.query('UPDATE initiative_entries SET colossus_used=false WHERE character_id=$1', [ranger.id]);
    assert.match((await shoot()).damage.roll.label, /убийца колоссов/, 'a new turn — again');
  });

  await t.test('Life domain: +2 + slot level to healing spells, preserve life up to half the maximum; another domain — neither', async () => {
    const cleric = await hero('Целительница', 'Жрец', 2, {wisdom: 16});
    await slots(cleric.id, 1, 4);
    const cure = await learn(cleric.id, 'cure-wounds');
    const hurt1 = await hero('Раненый-1', 'Воин', 3, {hpMax: 40, hpCurrent: 5});
    const hurt2 = await hero('Раненый-2', 'Воин', 3, {hpMax: 40, hpCurrent: 10});
    const healedResponse = await request('POST', `${base}/characters/${cleric.id}/spells/${cure}/cast`, alice.token, {targetIds: [hurt1.id]});
    assert.equal(healedResponse.statusCode, 201, healedResponse.body);
    const healed = healedResponse.json();
    assert.equal(healed.healingRoll.outcome.bonus, 3, JSON.stringify(healed).slice(0, 400));
    assert.equal(healed.targets[0].healed, healed.healingRoll.total + 3);

    await pg.query('UPDATE characters SET hp_current=5 WHERE id=$1', [hurt1.id]);
    const {sceneId} = await arena('Лазарет', [[alice.token, cleric.id, 0.5, 0.5, 30], [alice.token, hurt1.id, 1.5, 0.5, 5], [alice.token, hurt2.id, 2.5, 0.5, 4]]);
    const listed = (await features(cleric.id, alice.token, sceneId)).features.find((entry: any) => entry.id === 'preserve-life');
    assert.equal(listed.limit, 10);
    assert.deepEqual(listed.choices.map((entry: any) => [entry.value, entry.count]).sort(), [[hurt1.id, 15], [hurt2.id, 10]].sort());
    const preserve = (heals: any) => request('POST', `${base}/characters/${cleric.id}/features/preserve-life`, alice.token, {sceneId, heals});
    assert.match((await preserve([{targetId: hurt1.id, amount: 11}])).json().message, /больше запаса 10/);
    const done = await preserve([{targetId: hurt1.id, amount: 6}, {targetId: hurt2.id, amount: 4}]);
    assert.equal(done.statusCode, 200, done.body);
    assert.deepEqual([await hp(hurt1.id), await hp(hurt2.id)], [11, 14]);
    assert.match((await preserve([{targetId: hurt1.id, amount: 1}])).json().message, /Божественный канал|действие/);

    await request('PUT', `${base}/characters/${cleric.id}/subclass`, alice.token, {classId: 'cleric', subclass: 'other'});
    await pg.query('UPDATE initiative_entries SET action_used=false WHERE character_id=$1', [cleric.id]);
    const plain = (await request('POST', `${base}/characters/${cleric.id}/spells/${cure}/cast`, alice.token, {targetIds: [hurt1.id], sceneId})).json();
    assert.equal(plain.healingRoll.outcome.bonus, undefined, 'another domain — no Disciple of Life');
    assert.ok(!(await features(cleric.id)).features.some((entry: any) => entry.id === 'preserve-life'));
  });

  await t.test('metamagic: careful, heightened, empowered, distant, extended, subtle', async () => {
    const sorcerer = await hero('Вспышка', 'Чародей', 7, {charisma: 18, hpMax: 300, hpCurrent: 300});
    await slots(sorcerer.id, 3, 9);
    await slots(sorcerer.id, 1, 9);
    const fireball = await learn(sorcerer.id, 'fireball');
    const cure = await learn(sorcerer.id, 'cure-wounds');
    const sanctuary = await learn(sorcerer.id, 'sanctuary');
    const missile = await learn(sorcerer.id, 'magic-missile');
    await request('PUT', `${base}/characters/${sorcerer.id}/metamagic`, alice.token, {careful: true, heightened: true, empowered: true, distant: true, extended: true, subtle: true});
    await pg.query(`INSERT INTO character_resources (campaign_id, character_id, name, current, max, recharge) VALUES ($1,$2,'Очки чародейства',30,30,'long')`, [campaignId, sorcerer.id]);
    const friend = await hero('Друг', 'Воин', 3, {hpMax: 300, hpCurrent: 300, dexterity: 1});
    const foe = await npc('Неприятель', {hpMax: 300, hpCurrent: 300, dexterity: 10});
    const cast = (spell: string, body: any) => request('POST', `${base}/characters/${sorcerer.id}/spells/${spell}/cast`, alice.token, body);

    const careful = (await cast(fireball, {targetIds: [friend.id, foe.id], metamagic: 'careful'})).json();
    const mine = careful.targets.find((entry: any) => entry.characterId === friend.id);
    assert.deepEqual([mine.careful, mine.save.success], [true, true]);
    assert.equal(careful.targets.find((entry: any) => entry.characterId === foe.id).careful, undefined);
    assert.equal(careful.metamagic.cost, 1);

    const heightened = (await cast(fireball, {targetIds: [friend.id, foe.id], metamagic: 'heightened'})).json();
    assert.equal(heightened.targets.find((entry: any) => entry.characterId === foe.id).heightened, true, 'the first foe');
    const foeSave = (await pg.query<any>(`SELECT outcome FROM roll_log WHERE character_id=$1 ORDER BY created_at DESC LIMIT 1`, [foe.id])).rows[0];
    assert.ok(foeSave.outcome.reasons.includes('помеха: «Повышенное заклинание»'), JSON.stringify(foeSave.outcome));
    assert.equal(heightened.metamagic.cost, 3);

    const empowered = (await cast(fireball, {targetIds: [foe.id], metamagic: 'careful', empowered: true})).json();
    assert.equal(empowered.metamagic.name, 'Осторожное заклинание + Усиленное заклинание');
    assert.equal(empowered.metamagic.cost, 2);
    assert.ok(empowered.metamagic.rerolled >= 0 && empowered.metamagic.rerolled <= 4);
    assert.equal(empowered.damageRoll.total, empowered.damageRoll.dice_results.reduce((sum: number, value: number) => sum + value, 0));

    const {sceneId} = await arena('Даль', [[alice.token, sorcerer.id, 0.5, 0.5, 30], [alice.token, friend.id, 4.5, 0.5, 10]]);
    await pg.query('UPDATE characters SET hp_current=100 WHERE id=$1', [friend.id]);
    assert.match((await cast(cure, {targetIds: [friend.id], sceneId})).json().message, /дальше|далеко|дистанц/i, 'touch — the friend is 20 ft away');
    await pg.query('UPDATE initiative_entries SET action_used=false, bonus_spell=false WHERE character_id=$1', [sorcerer.id]);
    const far = await cast(cure, {targetIds: [friend.id], sceneId, metamagic: 'distant'});
    assert.equal(far.statusCode, 201, far.body);

    await pg.query('UPDATE initiative_entries SET action_used=false, bonus_used=false, bonus_spell=false, leveled_action_spell=false WHERE character_id=$1', [sorcerer.id]);
    const long = await cast(sanctuary, {targetIds: [sorcerer.id], sceneId, metamagic: 'extended'});
    assert.equal(long.statusCode, 201, long.body);
    assert.equal((await effect(sorcerer.id, 'sanctuary')).remainingRounds, 20, 'a minute doubled');
    await pg.query('UPDATE initiative_entries SET action_used=false, bonus_used=false, bonus_spell=false, leveled_action_spell=false WHERE character_id=$1', [sorcerer.id]);
    assert.match((await cast(missile, {targetIds: [friend.id], metamagic: 'extended'})).json().message, /на минуту и дольше/);

    const mage = await npc('Контрмаг', {intelligence: 18, level: 9});
    await slots(mage.id, 3, 3);
    await learn(mage.id, 'counterspell');
    await pg.query(`UPDATE characters SET auto_reactions=ARRAY['counterspell'] WHERE id=$1`, [mage.id]);
    const duel = await arena('Дуэль', [[alice.token, sorcerer.id, 0.5, 2.5, 30], [gm.token, mage.id, 3.5, 2.5, 5]]);
    const loud = (await cast(missile, {targetIds: [mage.id], sceneId: duel.sceneId})).json();
    assert.ok(loud.countered || loud.pending || (loud.targets ?? []).length === 0, `ready counterspell answers: ${JSON.stringify(loud).slice(0, 200)}`);
    await pg.query('UPDATE initiative_entries SET action_used=false, bonus_spell=false, reaction_used=false WHERE character_id = ANY($1::uuid[])', [[sorcerer.id, mage.id]]);
    const quiet = await cast(missile, {targetIds: [mage.id], sceneId: duel.sceneId, metamagic: 'subtle'});
    assert.equal(quiet.statusCode, 201, quiet.body);
    assert.ok(!quiet.json().countered && quiet.json().damageRoll, 'subtle — no counterspell');
  });

  await t.test('the NPC sorcerer quickens a second cantrip', async () => {
    const npcSorcerer = await npc('Чародейка-НПС', {charisma: 16, level: 3});
    await classed(npcSorcerer.id, 'Чародей 3');
    await learn(npcSorcerer.id, 'fire-bolt');
    await request('PUT', `${base}/characters/${npcSorcerer.id}/metamagic`, gm.token, {quickened: true});
    const target = await hero('Мишень-2', 'Воин', 3, {hpMax: 400, hpCurrent: 400, armorClass: 1});
    const {auto} = await arena('Искры', [[gm.token, npcSorcerer.id, 0.5, 0.5, 30], [alice.token, target.id, 6.5, 0.5, 5]]);
    const turn = await auto();
    assert.match(turn.summary, /«Ускоренное заклинание»: ещё «[^»]+» по «Мишень-2»/, turn.summary);
    assert.equal(await resource(npcSorcerer.id, 'Очки чародейства'), 1);
  });
});
