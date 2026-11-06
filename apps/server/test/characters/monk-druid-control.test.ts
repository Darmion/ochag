import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('ki, lay on hands, wild shape, ready reactions, control spells, more spell text', async t => {
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
  const gm = await register('gm_ki'), alice = await register('alice_ki');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Ki'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const hero = async (name: string, className: string, level: number, extra: any = {}) => {
    const made = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 40, hpCurrent: 40, level, speedFeet: 30, ...extra})).json();
    await pg.query('UPDATE characters SET class_name=$2 WHERE id=$1', [made.id, className]);
    return made;
  };
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 200, hpCurrent: 200, armorClass: 5, speedFeet: 30, ...extra,
  })).json();
  const weapon = async (id: string, body: any, token = gm.token) => (await request('POST', `${base}/characters/${id}/weapons`, token, {ability: 'strength', proficient: false, damageFormula: '1d1', ...body})).json();
  const learn = async (characterId: string, srdIndex: string) => {
    const made = await request('POST', `${base}/characters/${characterId}/spells`, gm.token, {source: 'srd', srdIndex});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const slots = (characterId: string, level: number, count: number) =>
    pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,$3,$4,$4)', [campaignId, characterId, level, count]);
  const row = async (id: string) => (await pg.query<any>('SELECT hp_current, hp_max, hp_temp, armor_class, speed_feet::float8 AS speed, auto_reactions FROM characters WHERE id=$1', [id])).rows[0];
  const effect = async (id: string, code: string) => (await pg.query<any>('SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code=$2 AND active', [id, code])).rows[0]?.parameters ?? null;
  const resource = async (id: string, name: string) => (await pg.query<any>('SELECT current, max FROM character_resources WHERE character_id=$1 AND name=$2', [id, name])).rows[0];
  const entry = async (id: string) => (await pg.query<any>('SELECT * FROM initiative_entries WHERE character_id=$1', [id])).rows[0];
  const arena = async (name: string, members: Array<[string, string, number, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 24, heightCells: 12})).json().id;
    const scenePath = `${base}/scenes/${sceneId}`;
    for (const [token, characterId, x, z] of members) await request('POST', `${scenePath}/objects`, token, {characterId, x, z});
    for (const [, characterId, , , score] of members) {
      const id = (await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId})).json().id;
      await request('PATCH', `${scenePath}/initiative/${id}`, gm.token, {score});
    }
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    return {sceneId, scenePath};
  };
  const feature = (characterId: string, id: string, body: any = {}, token = alice.token) =>
    request('POST', `${base}/characters/${characterId}/features/${id}`, token, body);
  const damage = async (id: string, amount: number) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: amount === 1 ? '1d1' : `1d1+${amount - 1}`})).json();
    return (await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId: id, mode: 'damage'})).json();
  };

  await t.test('ki: flurry of blows after the Attack action, patient defense, step of the wind', async () => {
    const monk = await hero('Шэнь', 'Монах', 5, {dexterity: 16});
    const dummy = await npc('Манекен');
    const staff = await weapon(monk.id, {name: 'Посох'}, alice.token);
    const {sceneId} = await arena('Додзё', [[alice.token, monk.id, 0.5, 0.5, 30], [gm.token, dummy.id, 1.5, 0.5, 5]]);
    assert.match((await feature(monk.id, 'flurry-of-blows', {sceneId, targetId: dummy.id})).json().message, /сразу после действия «Атака»/);
    assert.equal((await request('POST', `${base}/rolls/check`, alice.token, {characterId: monk.id, kind: 'attack', key: staff.id, targetCharacterId: dummy.id, sceneId})).statusCode, 201);
    await pg.query('UPDATE initiative_entries SET attacks_made=2 WHERE character_id=$1', [monk.id]);
    const flurry = await feature(monk.id, 'flurry-of-blows', {sceneId, targetId: dummy.id});
    assert.equal(flurry.statusCode, 200, flurry.body);
    assert.equal(flurry.json().strikes.length, 2);
    assert.match(flurry.json().message, /«Шквал ударов» — два безоружных удара/);
    assert.deepEqual(await resource(monk.id, 'Ци'), {current: 4, max: 5});
    assert.equal((await entry(monk.id)).bonus_used, true);
    const fist = (await pg.query<any>(`SELECT damage_formula, ability FROM character_weapons WHERE character_id=$1 AND name='Безоружный удар'`, [monk.id])).rows[0];
    assert.deepEqual(fist, {damage_formula: '1d6+@mod', ability: 'finesse'}, 'martial arts d6 at 5th level');
    assert.match((await feature(monk.id, 'patient-defense', {sceneId})).json().message, /бонусное действие в этот ход уже потрачено/);
    await pg.query('UPDATE initiative_entries SET bonus_used=false WHERE character_id=$1', [monk.id]);
    assert.equal((await feature(monk.id, 'patient-defense', {sceneId})).statusCode, 200);
    assert.ok(await effect(monk.id, 'dodging'));
    await pg.query('UPDATE initiative_entries SET bonus_used=false WHERE character_id=$1', [monk.id]);
    assert.equal((await feature(monk.id, 'step-of-the-wind', {sceneId, mode: 'dash'})).statusCode, 200);
    assert.equal((await entry(monk.id)).dashes, 1);
    assert.deepEqual(await resource(monk.id, 'Ци'), {current: 2, max: 5});
  });

  await t.test('lay on hands: hit points from the pool by touch, 5 to cure poison, not on the undead', async () => {
    const paladin = await hero('Ала', 'Паладин', 3);
    const friend = await hero('Друг', 'Воин', 3, {hpMax: 30, hpCurrent: 10});
    const zombie = await npc('Зомби');
    await pg.query(`UPDATE characters SET sheet_extra='{"srdMonster":"zombie"}'::jsonb WHERE id=$1`, [zombie.id]);
    const {sceneId} = await arena('Часовня', [[alice.token, paladin.id, 0.5, 0.5, 20], [alice.token, friend.id, 1.5, 0.5, 15], [gm.token, zombie.id, 0.5, 1.5, 5]]);
    const healed = await feature(paladin.id, 'lay-on-hands', {sceneId, targetId: friend.id, amount: 7});
    assert.equal(healed.statusCode, 200, healed.body);
    assert.equal((await row(friend.id)).hp_current, 17);
    assert.deepEqual(await resource(paladin.id, 'Наложение рук'), {current: 8, max: 15});
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'poisoned','{}')`, [campaignId, friend.id]);
    await pg.query('UPDATE initiative_entries SET action_used=false WHERE character_id=$1', [paladin.id]);
    const cured = await feature(paladin.id, 'lay-on-hands', {sceneId, targetId: friend.id, amount: 1, cure: true});
    assert.match(cured.json().message, /яд снят/);
    assert.equal(await effect(friend.id, 'poisoned'), null);
    assert.equal((await resource(paladin.id, 'Наложение рук')).current, 2);
    await pg.query('UPDATE initiative_entries SET action_used=false WHERE character_id=$1', [paladin.id]);
    assert.match((await feature(paladin.id, 'lay-on-hands', {sceneId, targetId: zombie.id, amount: 1})).json().message, /не действует на нежить/);
  });

  await t.test('wild shape: the beast’s body and hit points; at 0 back to the druid with the excess; no spells; leave at will', async () => {
    const druid = await hero('Ива', 'Друид', 2, {hpMax: 18, hpCurrent: 18, armorClass: 12, wisdom: 16});
    const list = (await request('GET', `${base}/characters/${druid.id}/features`, alice.token)).json().features.find((entry: any) => entry.id === 'wild-shape');
    const beasts = list.choices.map((choice: any) => choice.value);
    assert.ok(beasts.includes('wolf'));
    assert.ok(!beasts.includes('crocodile'), 'no swimming at 2nd level');
    assert.ok(!beasts.includes('dire-wolf'), 'CR 1 is too much');
    const shaped = await feature(druid.id, 'wild-shape', {beast: 'wolf'});
    assert.equal(shaped.statusCode, 200, shaped.body);
    assert.deepEqual([(await row(druid.id)).hp_current, (await row(druid.id)).hp_max, (await row(druid.id)).armor_class, (await row(druid.id)).speed], [11, 11, 13, 40]);
    const bite = (await pg.query<any>(`SELECT name FROM character_weapons WHERE character_id=$1 AND properties ? 'wild_shape'`, [druid.id])).rows;
    assert.deepEqual(bite.map((entry: any) => entry.name), ['Укус (Волк)']);
    const spell = await learn(druid.id, 'produce-flame');
    assert.match((await request('POST', `${base}/characters/${druid.id}/spells/${spell}/cast`, alice.token, {})).json().message, /в зверином облике — колдовать нельзя/);
    await damage(druid.id, 15);
    const back = await row(druid.id);
    assert.deepEqual([back.hp_current, back.hp_max, back.armor_class, back.speed], [14, 18, 12, 30], '18 − (15 − 11)');
    assert.equal(await effect(druid.id, 'wild_shape'), null);
    assert.equal((await pg.query<any>(`SELECT count(*)::int AS n FROM character_weapons WHERE character_id=$1 AND properties ? 'wild_shape'`, [druid.id])).rows[0].n, 0);
    assert.equal((await feature(druid.id, 'wild-shape', {beast: 'boar'})).statusCode, 200);
    await damage(druid.id, 3);
    assert.equal((await feature(druid.id, 'end-wild-shape')).statusCode, 200);
    assert.equal((await row(druid.id)).hp_current, 14);
    assert.match((await feature(druid.id, 'wild-shape', {beast: 'wolf'})).json().message, /потрачено/, 'two uses');
  });

  await t.test('protection style ready: a reaction gives disadvantage to an attack on an ally next to you; hellish rebuke ready strikes back', async () => {
    const guard = await hero('Страж', 'Воин', 3);
    await pg.query(`UPDATE characters SET sheet_extra = jsonb_set(sheet_extra, '{builder}', '{"fightingStyle":"protection"}'::jsonb) WHERE id=$1`, [guard.id]);
    const ward = await hero('Подопечный', 'Волшебник', 3);
    const tiefling = await hero('Тифлинг', 'Колдун', 3, {charisma: 16});
    const brute = await npc('Громила');
    const club = await weapon(brute.id, {name: 'Дубина', attackBonus: 20, damageFormula: '1d1+1'});
    const features = (await request('GET', `${base}/characters/${guard.id}/features`, alice.token)).json().features;
    assert.equal(features.find((entry: any) => entry.id === 'protection-style').active, false);
    assert.equal((await request('PUT', `${base}/characters/${guard.id}/reactions`, alice.token, {protection: true})).statusCode, 200);
    const rebuke = await learn(tiefling.id, 'hellish-rebuke');
    void rebuke;
    await slots(tiefling.id, 1, 2);
    assert.equal((await request('PUT', `${base}/characters/${tiefling.id}/reactions`, alice.token, {'hellish-rebuke': true})).statusCode, 200);
    assert.deepEqual((await row(tiefling.id)).auto_reactions, ['hellish-rebuke']);
    const {sceneId} = await arena('Засада', [
      [gm.token, brute.id, 0.5, 0.5, 30], [alice.token, ward.id, 1.5, 0.5, 10], [alice.token, guard.id, 2.5, 0.5, 9], [alice.token, tiefling.id, 0.5, 1.5, 8],
    ]);
    const swing = (await request('POST', `${base}/rolls/check`, gm.token, {characterId: brute.id, kind: 'attack', key: club.id, targetCharacterId: ward.id, sceneId})).json();
    assert.ok(swing.outcome.reasons.includes('помеха: «Защита»: Страж'), JSON.stringify(swing.outcome));
    assert.equal((await entry(guard.id)).reaction_used, true);
    await pg.query('UPDATE initiative_entries SET attacks_made=0, action_used=false WHERE character_id=$1', [brute.id]);
    const second = (await request('POST', `${base}/rolls/check`, gm.token, {characterId: brute.id, kind: 'attack', key: club.id, targetCharacterId: ward.id, sceneId})).json();
    assert.ok(!second.outcome.reasons?.some((reason: string) => reason.includes('Защита')), 'the reaction is spent');

    for (let i = 0; i < 20 && Number((await pg.query<any>('SELECT current FROM character_spell_slots WHERE character_id=$1 AND level=1', [tiefling.id])).rows[0].current) === 2; i++) {
      await pg.query('UPDATE initiative_entries SET attacks_made=0, action_used=false WHERE character_id=$1', [brute.id]);
      await request('POST', `${base}/rolls/check`, gm.token, {characterId: brute.id, kind: 'attack', key: club.id, targetCharacterId: tiefling.id, sceneId});
      for (let wait = 0; wait < 20 && Number((await pg.query<any>('SELECT current FROM character_spell_slots WHERE character_id=$1 AND level=1', [tiefling.id])).rows[0].current) === 2; wait++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    assert.equal(Number((await pg.query<any>('SELECT current FROM character_spell_slots WHERE character_id=$1 AND level=1', [tiefling.id])).rows[0].current), 1, 'a slot went on the rebuke');
    assert.equal((await entry(tiefling.id)).reaction_used, true);
    const rebuked = (await pg.query<any>(`SELECT label FROM roll_log WHERE character_id=$1 AND label LIKE 'Спасбросок ЛОВ%' ORDER BY created_at DESC LIMIT 1`, [brute.id])).rows[0];
    assert.ok(rebuked, 'the brute had to save');
  });

  await t.test('auto turn with conditions: Hold Person on the most dangerous foe; nothing new while concentrating', async () => {
    const mage = await npc('Колдунья', {wisdom: 16, charisma: 16, intelligence: 16});
    await learn(mage.id, 'hold-person');
    await slots(mage.id, 2, 3);
    await weapon(mage.id, {name: 'Кинжал', damageFormula: '1d4', rangeFeet: 5});
    const weakling = await hero('Слабый', 'Волшебник', 3);
    const champion = await hero('Чемпион', 'Воин', 3);
    await weapon(champion.id, {name: 'Двуручник', damageFormula: '2d6+5'}, alice.token);
    const {scenePath} = await arena('Чары', [[gm.token, mage.id, -4.5, 0.5, 30], [alice.token, weakling.id, 0.5, 0.5, 10], [alice.token, champion.id, 2.5, 2.5, 9]]);
    const result = (await request('POST', `${scenePath}/initiative/auto`, gm.token, {advance: false})).json();
    assert.ok(result.control, result.summary);
    assert.equal(result.control.targetId, champion.id, 'the most dangerous one');
    assert.match(result.summary, /творит «Удержание личности»/);
    assert.ok(await effect(mage.id, 'concentration'));
    await pg.query('UPDATE initiative_entries SET action_used=false, leveled_action_spell=false WHERE character_id=$1', [mage.id]);
    const again = (await request('POST', `${scenePath}/initiative/auto`, gm.token, {advance: false})).json();
    assert.equal(again.control, null, 'already concentrating — no second hold');
  });

  await t.test('spell text: false life, shield of faith, heroism against fear, sanctuary loses the attack', async () => {
    const priest = await hero('Жрица', 'Жрец', 5, {wisdom: 18, intelligence: 14});
    await slots(priest.id, 1, 10);
    const ally = await hero('Соратница', 'Воин', 3);
    const ogre = await npc('Огр', {wisdom: 3});
    const club = await weapon(ogre.id, {name: 'Палица', attackBonus: 20});
    const {sceneId} = await arena('Храм', [[alice.token, priest.id, 0.5, 0.5, 20], [alice.token, ally.id, 1.5, 0.5, 15], [gm.token, ogre.id, 2.5, 0.5, 5]]);
    const cast = async (index: string, body: any) => {
      const id = await learn(priest.id, index);
      await pg.query('UPDATE initiative_entries SET action_used=false, bonus_used=false, leveled_action_spell=false, bonus_spell=false WHERE character_id=$1', [priest.id]);
      const done = await request('POST', `${base}/characters/${priest.id}/spells/${id}/cast`, alice.token, {sceneId, ...body});
      assert.equal(done.statusCode, 201, done.body);
      return done.json();
    };
    await cast('false-life', {});
    const temp = (await row(priest.id)).hp_temp;
    assert.ok(temp >= 5 && temp <= 8, `1d4 + 4 — ${temp}`);
    await cast('shield-of-faith', {targetIds: [ally.id]});
    assert.equal((await effect(ally.id, 'ac_bonus')).bonus, 2);
    await cast('heroism', {targetIds: [ally.id]});
    assert.equal((await effect(ally.id, 'heroism')).temp, 4, 'Wisdom +4');
    await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [ally.id], code: 'frightened'});
    assert.equal(await effect(ally.id, 'frightened'), null, 'immune to fear');
    await cast('sanctuary', {targetIds: [ally.id]});
    assert.ok(await effect(ally.id, 'sanctuary'));
    let lost = false;
    for (let i = 0; i < 30 && !lost; i++) {
      await pg.query('UPDATE initiative_entries SET attacks_made=0, action_used=false, reaction_used=false WHERE character_id=$1', [ogre.id]);
      await request('POST', `${base}/characters/${ogre.id}/effects`, gm.token, {effectCode: 'readied'});
      const swing = (await request('POST', `${base}/rolls/check`, gm.token, {characterId: ogre.id, kind: 'attack', key: club.id, targetCharacterId: ally.id, sceneId, using: 'reaction'})).json();
      lost = swing.outcome?.sanctuary === true;
    }
    assert.ok(lost, 'a failed Wisdom save lost the attack');
    const blade = await weapon(ally.id, {name: 'Меч'}, alice.token);
    await request('POST', `${base}/rolls/check`, alice.token, {characterId: ally.id, kind: 'attack', key: blade.id, targetCharacterId: ogre.id, sceneId});
    assert.equal(await effect(ally.id, 'sanctuary'), null, 'attacking ends it');
  });
});
