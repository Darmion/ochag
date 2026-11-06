import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('open hand technique, frenzy, turn the unholy, natural recovery, blessed healer, empowered evocation', async t => {
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
  const gm = await register('gm_more'), alice = await register('alice_more');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'More'})).json().id;
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
  const slots = (characterId: string, level: number, current: number, max = current) =>
    pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,$3,$4,$5)', [campaignId, characterId, level, current, max]);
  const effect = async (id: string, code: string) => (await pg.query<any>('SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code=$2 AND active', [id, code])).rows[0]?.parameters ?? null;
  const codes = async (id: string) => (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active', [id])).rows.map(row => row.effect_code as string);
  const hp = async (id: string) => Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current);
  const turn = (id: string) => pg.query('UPDATE initiative_entries SET action_used=false, bonus_used=false, reaction_used=false, attacks_made=0, bonus_spell=false, leveled_action_spell=false, moved_feet=0 WHERE character_id=$1', [id]);
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

  await t.test('open hand technique: a flurry hit knocks prone (DEX save), already prone — no reactions', async () => {
    const monk = await hero('Ладонь', 'Монах', 5, {dexterity: 16, wisdom: 16});
    const staff = await weapon(monk.id, {name: 'Посох', attackBonus: 20}, alice.token);
    const dummy = await npc('Чучело', {dexterity: 1, hpMax: 500, hpCurrent: 500, armorClass: 1});
    const {sceneId} = await arena('Двор', [[alice.token, monk.id, 0.5, 0.5, 30], [gm.token, dummy.id, 1.5, 0.5, 5]]);
    let prone = false;
    for (let i = 0; i < 8 && !prone; i++) {
      await turn(monk.id);
      await pg.query(`DELETE FROM character_resources WHERE character_id=$1 AND name='Ци'`, [monk.id]);
      await request('POST', `${base}/rolls/check`, alice.token, {characterId: monk.id, kind: 'attack', key: staff.id, targetCharacterId: dummy.id, sceneId});
      const flurry = await request('POST', `${base}/characters/${monk.id}/features/flurry-of-blows`, alice.token, {sceneId, targetId: dummy.id, technique: 'prone'});
      assert.equal(flurry.statusCode, 200, flurry.body);
      if (flurry.json().techniques) assert.match(flurry.json().message, /техника открытой ладони/);
      prone = (await codes(dummy.id)).includes('prone');
    }
    assert.ok(prone, 'DEX −5 against DC 14 — on the floor sooner or later');
    await turn(monk.id);
    await pg.query(`DELETE FROM character_resources WHERE character_id=$1 AND name='Ци'`, [monk.id]);
    await request('POST', `${base}/rolls/check`, alice.token, {characterId: monk.id, kind: 'attack', key: staff.id, targetCharacterId: dummy.id, sceneId});
    const again = (await request('POST', `${base}/characters/${monk.id}/features/flurry-of-blows`, alice.token, {sceneId, targetId: dummy.id, technique: 'prone'})).json();
    assert.match(again.techniques.join(), /без реакций/, 'already prone — no reactions instead');
    assert.equal((await effect(dummy.id, 'no_reactions')).expires.of, monk.id);
  });

  await t.test('frenzy: rage into a frenzy, a bonus-action attack on later turns, exhaustion when the rage ends; the NPC berserker frenzies', async () => {
    const barbarian = await hero('Берсерк', 'Варвар', 3, {strength: 16, hpMax: 300, hpCurrent: 300});
    await weapon(barbarian.id, {name: 'Секира', attackBonus: 20, damageFormula: '1d12'}, alice.token);
    const foe = await npc('Враг', {hpMax: 500, hpCurrent: 500});
    const {sceneId} = await arena('Бойня', [[alice.token, barbarian.id, 0.5, 0.5, 30], [gm.token, foe.id, 1.5, 0.5, 5]]);
    const rage = await request('POST', `${base}/characters/${barbarian.id}/features/rage`, alice.token, {sceneId, frenzy: true});
    assert.equal(rage.statusCode, 200, rage.body);
    assert.match(rage.json().message, /впадает в бешенство/);
    assert.equal((await effect(barbarian.id, 'raging')).frenzy, true);
    assert.match((await request('POST', `${base}/characters/${barbarian.id}/features/frenzy-attack`, alice.token, {sceneId, targetId: foe.id})).json().message, /бонусное действие/, 'the rage took this turn’s bonus action');
    await turn(barbarian.id);
    const strike = await request('POST', `${base}/characters/${barbarian.id}/features/frenzy-attack`, alice.token, {sceneId, targetId: foe.id});
    assert.equal(strike.statusCode, 200, strike.body);
    assert.equal(strike.json().attack.outcome.target.id, foe.id);
    assert.equal((await pg.query<any>('SELECT bonus_used FROM initiative_entries WHERE character_id=$1', [barbarian.id])).rows[0].bonus_used, true);
    assert.equal((await request('POST', `${base}/characters/${barbarian.id}/features/end-rage`, alice.token, {sceneId})).statusCode, 200);
    assert.ok((await codes(barbarian.id)).includes('exhaustion_1'), 'the frenzy costs a level of exhaustion');

    const plain = await hero('Ярый', 'Варвар', 3, {strength: 16});
    await request('POST', `${base}/characters/${plain.id}/features/rage`, alice.token, {});
    await request('POST', `${base}/characters/${plain.id}/features/end-rage`, alice.token, {});
    assert.ok(!(await codes(plain.id)).some(code => code.startsWith('exhaustion')), 'no frenzy — no exhaustion');

    const npcBerserk = await npc('Берсерк-НПС', {strength: 16, level: 3});
    await classed(npcBerserk.id, 'Варвар 3');
    await weapon(npcBerserk.id, {name: 'Топор', attackBonus: 20, damageFormula: '1d12+3'});
    const victim = await hero('Мишень', 'Воин', 3, {hpMax: 500, hpCurrent: 500});
    const fight = await arena('Ярость-3', [[gm.token, npcBerserk.id, 0.5, 0.5, 30], [alice.token, victim.id, 1.5, 0.5, 5]]);
    const first = await fight.auto();
    assert.match(first.summary, /впадает в ярость \(бешенство\)/, first.summary);
    await turn(npcBerserk.id);
    const second = await fight.auto();
    assert.match(second.summary, /бешенство — ещё удар по «Мишень»/, second.summary);
  });

  await t.test('turn the unholy: fiends and undead within 30 ft — WIS save or turned; another oath — no', async () => {
    const paladin = await hero('Паладин', 'Паладин', 3, {charisma: 16});
    const fiend = await npc('Бес', {wisdom: 1});
    const ghoul = await npc('Упырь', {wisdom: 1});
    const bandit = await npc('Разбойник', {wisdom: 1});
    await pg.query(`UPDATE characters SET sheet_extra = '{"creatureType":"fiend"}' WHERE id=$1`, [fiend.id]);
    await pg.query(`UPDATE characters SET sheet_extra = '{"creatureType":"undead"}' WHERE id=$1`, [ghoul.id]);
    const {sceneId} = await arena('Святыня', [[alice.token, paladin.id, 0.5, 0.5, 30], [gm.token, fiend.id, 2.5, 0.5, 5], [gm.token, ghoul.id, 3.5, 0.5, 4], [gm.token, bandit.id, 1.5, 0.5, 3]]);
    const done = await request('POST', `${base}/characters/${paladin.id}/features/turn-the-unholy`, alice.token, {sceneId});
    assert.equal(done.statusCode, 200, done.body);
    assert.match(done.json().message, /«Изгнание нечестивых» \(СЛ 13\)/);
    assert.match(done.json().message, /Бес/);
    assert.match(done.json().message, /Упырь/);
    assert.doesNotMatch(done.json().message, /Разбойник/);
    assert.ok((await codes(fiend.id)).includes('turned') || /Бес устоял/.test(done.json().message));
    await request('PUT', `${base}/characters/${paladin.id}/subclass`, alice.token, {classId: 'paladin', subclass: 'other'});
    const list = (await request('GET', `${base}/characters/${paladin.id}/features`, alice.token)).json().features.map((entry: any) => entry.id);
    assert.ok(!list.includes('turn-the-unholy') && !list.includes('sacred-weapon'));
  });

  await t.test('natural recovery: a Land druid gets spent slots back out of combat, once; the short rest says so', async () => {
    const druid = await hero('Друидесса', 'Друид', 3, {wisdom: 16});
    await slots(druid.id, 1, 1, 4);
    await slots(druid.id, 2, 0, 2);
    const rested = await request('POST', `${base}/characters/${druid.id}/rest`, alice.token, {kind: 'short'});
    assert.match(rested.json().summary, /можно «Природное восстановление»/, rested.body);
    const recover = (body: any) => request('POST', `${base}/characters/${druid.id}/features/natural-recovery`, alice.token, body);
    assert.match((await recover({slots: [2, 1]})).json().message, /больше 2/);
    const done = await recover({slots: [2]});
    assert.equal(done.statusCode, 200, done.body);
    assert.match(done.json().message, /«Природное восстановление» — вернулись ячейки 2 ур\./);
    assert.match((await recover({slots: [1]})).json().message, /потрачено/);
  });

  await t.test('blessed healer and empowered evocation', async () => {
    const cleric = await hero('Целительница', 'Жрец', 6, {wisdom: 16, hpMax: 60, hpCurrent: 10});
    await slots(cleric.id, 1, 4);
    const cure = await learn(cleric.id, 'cure-wounds');
    const friend = await hero('Раненый', 'Воин', 3, {hpMax: 60, hpCurrent: 5});
    const healed = (await request('POST', `${base}/characters/${cleric.id}/spells/${cure}/cast`, alice.token, {targetIds: [friend.id]})).json();
    assert.equal(healed.healingRoll.outcome.selfHeal, 3, '2 + 1st level');
    assert.equal(await hp(cleric.id), 13);
    const self = (await request('POST', `${base}/characters/${cleric.id}/spells/${cure}/cast`, alice.token, {targetIds: [cleric.id]})).json();
    assert.equal(self.healingRoll.outcome.selfHeal, undefined, 'healing yourself — no Blessed Healer');

    const wizard = await hero('Боевой маг', 'Волшебник', 10, {intelligence: 18});
    const bolt = await learn(wizard.id, 'fire-bolt');
    const target = await npc('Мишень-2', {armorClass: 1, hpMax: 500, hpCurrent: 500});
    let hit: any = null;
    for (let i = 0; i < 10 && !hit?.damageRoll; i++) hit = (await request('POST', `${base}/characters/${wizard.id}/spells/${bolt}/cast`, alice.token, {targetIds: [target.id]})).json();
    assert.equal(hit.empoweredEvocation, 4);
    assert.match(hit.damageRoll.formula, /\+4$/);
  });
});
