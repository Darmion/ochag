import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('legendary resistance, dark one\'s own luck, mindless rage, aura of devotion, wholeness of body, divine strike', async t => {
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
  const gm = await register('gm_twelve'), alice = await register('alice_twelve');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Twelve'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const hero = async (name: string, className: string, level: number, extra: any = {}) => {
    const made = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 60, hpCurrent: 60, level, speedFeet: 30, ...extra})).json();
    await pg.query('UPDATE characters SET class_name=$2 WHERE id=$1', [made.id, className]);
    return made;
  };
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 100, hpCurrent: 100, armorClass: 5, speedFeet: 30, ...extra,
  })).json();
  const resource = async (id: string, name: string) => (await pg.query<any>('SELECT current, max, recharge FROM character_resources WHERE character_id=$1 AND name=$2', [id, name])).rows[0] ?? null;
  const codes = async (id: string) => (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active', [id])).rows.map(row => row.effect_code as string);
  const lastSave = async (id: string) => (await pg.query<any>(`SELECT outcome, total FROM roll_log WHERE character_id=$1 AND outcome->>'kind'='save' ORDER BY created_at DESC LIMIT 1`, [id])).rows[0];
  const apply = async (targetId: string, condition: string, save?: {ability: string; dc: number}) => {
    const result = await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [targetId], code: condition, ...(save ? {save} : {})});
    assert.equal(result.statusCode, 200, result.body);
    return result.json().results[0];
  };
  const hp = async (id: string) => Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current);
  const feature = async (id: string, featureId: string, token = alice.token) => (await request('GET', `${base}/characters/${id}/features`, token)).json().features.find((entry: any) => entry.id === featureId);
  const scene = async (name: string, members: Array<[string, string, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 24, heightCells: 12})).json().id;
    for (const [token, characterId, x, z] of members) await request('POST', `${base}/scenes/${sceneId}/objects`, token, {characterId, x, z});
    return sceneId as string;
  };

  await t.test('legendary resistance: a failed save becomes a success, N times a day, back on a long rest; manual rule', async () => {
    const dragon = await npc('Древний дракон', {constitution: 1});
    const bossPath = `${base}/characters/${dragon.id}/boss`;
    assert.equal((await request('PUT', bossPath, gm.token, {legendaryActions: 0, options: [], phases: [], legendaryResistances: 6})).statusCode, 400);
    const saved = await request('PUT', bossPath, gm.token, {legendaryActions: 0, options: [], phases: [], legendaryResistances: 2});
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().legendaryResistances, 2);
    assert.equal((await request('GET', bossPath, gm.token)).json().legendaryResistances, 2);
    assert.deepEqual(await resource(dragon.id, 'Легендарное сопротивление'), {current: 2, max: 2, recharge: 'long'});
    await request('PUT', bossPath, gm.token, {legendaryActions: 0, options: [], phases: []});
    assert.equal((await request('GET', bossPath, gm.token)).json().legendaryResistances, 2);

    const first = await apply(dragon.id, 'poisoned', {ability: 'constitution', dc: 40});
    assert.equal(first.applied, false, 'CON −5 against DC 40 fails — legendary resistance turns it into a success');
    const roll = await lastSave(dragon.id);
    assert.equal(roll.outcome.success, true);
    assert.deepEqual(roll.outcome.legendaryResistance, {left: 1});
    assert.ok(roll.outcome.reasons.some((reason: string) => /легендарное сопротивление: провал → успех \(осталось 1\)/.test(reason)), roll.outcome.reasons.join('; '));
    assert.equal((await apply(dragon.id, 'poisoned', {ability: 'constitution', dc: 40})).applied, false);
    assert.equal((await resource(dragon.id, 'Легендарное сопротивление')).current, 0);
    assert.equal((await apply(dragon.id, 'poisoned', {ability: 'constitution', dc: 40})).applied, true, 'none left — the save fails');
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [dragon.id]);

    const rested = await request('POST', `${base}/characters/${dragon.id}/rest`, gm.token, {kind: 'long'});
    assert.equal(rested.statusCode, 200, rested.body);
    assert.equal((await resource(dragon.id, 'Легендарное сопротивление')).current, 2, 'a long rest brings them back');

    await request('PUT', bossPath, gm.token, {legendaryActions: 0, options: [], phases: [], legendaryResistances: 3});
    assert.deepEqual(await resource(dragon.id, 'Легендарное сопротивление'), {current: 3, max: 3, recharge: 'long'});

    await request('POST', `${base}/rules`, gm.token, {key: 'legendary_resistance', kind: 'text', label: 'Легендарное сопротивление', value: 'manual'});
    assert.equal((await apply(dragon.id, 'poisoned', {ability: 'constitution', dc: 40})).applied, true, 'manual — the GM decides');
    assert.equal((await resource(dragon.id, 'Легендарное сопротивление')).current, 3);
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='legendary_resistance'`, [campaignId]);

    await request('PUT', bossPath, gm.token, {legendaryActions: 0, options: [], phases: [], legendaryResistances: 0});
    assert.equal(await resource(dragon.id, 'Легендарное сопротивление'), null);
    assert.equal((await apply(dragon.id, 'blinded', {ability: 'constitution', dc: 40})).applied, true);
    const brute = await hero('Громила', 'Воин', 3, {constitution: 1});
    await pg.query('UPDATE characters SET legendary_resistances=3 WHERE id=$1', [brute.id]);
    assert.equal((await apply(brute.id, 'poisoned', {ability: 'constitution', dc: 40})).applied, true);
  });

  await t.test('dark one\'s own luck: a d10 to a failed save it can save, once per short rest', async () => {
    const warlock = await hero('Исчадие', 'Колдун', 6, {constitution: 10});
    assert.ok((await feature(warlock.id, 'dark-ones-own-luck'))?.resource, 'the feature with its resource');
    let lucky: any = null;
    for (let i = 0; i < 30 && !lucky; i++) {
      await pg.query(`DELETE FROM character_resources WHERE character_id=$1 AND name='Удача тёмного'`, [warlock.id]);
      await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [warlock.id]);
      await apply(warlock.id, 'poisoned', {ability: 'constitution', dc: 21});
      const roll = await lastSave(warlock.id);
      if ((roll.outcome.riders ?? []).some((rider: any) => rider.label === 'удача тёмного')) lucky = roll;
      else assert.ok(Number(roll.total) <= 10, `a d20 of ${roll.total} against DC 21 — the d10 could save it`);
    }
    assert.ok(lucky, 'half of the d20 rolls leave room for the d10');
    assert.ok(lucky.outcome.reasons.some((reason: string) => /удача тёмного \+к10/.test(reason)), lucky.outcome.reasons.join('; '));
    assert.equal((await resource(warlock.id, 'Удача тёмного')).current, 0);
    for (let i = 0; i < 6; i++) {
      await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [warlock.id]);
      await apply(warlock.id, 'poisoned', {ability: 'constitution', dc: 21});
      assert.ok(!((await lastSave(warlock.id)).outcome.riders ?? []).some((rider: any) => rider.label === 'удача тёмного'));
    }
    const fresh = await hero('Исчадие 5', 'Колдун', 5);
    assert.equal(await feature(fresh.id, 'dark-ones-own-luck'), undefined, 'from 6th level');
  });

  await t.test('mindless rage: frightened is suspended by the rage, charm does not land, both come back after', async () => {
    const berserker = await hero('Берсерк', 'Варвар', 6);
    assert.equal((await apply(berserker.id, 'frightened')).applied, true);
    const raged = await request('POST', `${base}/characters/${berserker.id}/features/rage`, alice.token, {});
    assert.equal(raged.statusCode, 200, raged.body);
    assert.match(raged.json().message, /«Бездумная ярость»: испуган — приостановлено до конца ярости/);
    assert.deepEqual((await codes(berserker.id)).sort(), ['raging']);
    const suspended = (await pg.query<any>(`SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code='frightened' AND NOT active`, [berserker.id])).rows[0];
    assert.equal(suspended?.parameters?.suspendedBy, 'rage');
    const charm = await apply(berserker.id, 'charmed', {ability: 'wisdom', dc: 40});
    assert.equal(charm.applied, false);
    assert.equal(charm.immune, 'бездумная ярость');
    assert.equal(charm.total, null, 'immune — no save rolled');
    assert.equal((await feature(berserker.id, 'mindless-rage')).active, true);
    const ended = await request('POST', `${base}/characters/${berserker.id}/features/end-rage`, alice.token, {});
    assert.equal(ended.statusCode, 200, ended.body);
    assert.match(ended.json().message, /ярость утихает\. Снова: испуган\./);
    assert.deepEqual((await codes(berserker.id)).sort(), ['frightened'], 'the fear is back');
    assert.equal((await pg.query<any>(`SELECT count(*)::int AS n FROM character_effects WHERE character_id=$1 AND NOT active`, [berserker.id])).rows[0].n, 0);
    await request('POST', `${base}/characters/${berserker.id}/rest`, alice.token, {kind: 'long'});
    await request('POST', `${base}/characters/${berserker.id}/features/rage`, alice.token, {});
    const rage = (await pg.query<any>(`SELECT id FROM character_effects WHERE character_id=$1 AND effect_code='raging'`, [berserker.id])).rows[0];
    assert.equal((await request('DELETE', `${base}/characters/${berserker.id}/effects/${rage.id}`, alice.token)).statusCode, 204);
    assert.ok((await codes(berserker.id)).includes('frightened'));
    const totem = await hero('Тотем', 'Варвар 6 (Путь тотемного воина)', 6);
    await request('POST', `${base}/characters/${totem.id}/features/rage`, alice.token, {});
    assert.equal((await apply(totem.id, 'charmed')).applied, true);
  });

  await t.test('aura of devotion: no charm for the paladin and allies within 10 feet while the paladin can act', async () => {
    const paladin = await hero('Преданный', 'Паладин', 7);
    const near = await hero('Рядом', 'Воин', 3);
    const far = await hero('Далеко', 'Воин', 3);
    await scene('Часовня', [[alice.token, paladin.id, 0.5, 0.5], [alice.token, near.id, 1.5, 0.5], [alice.token, far.id, 10.5, 0.5]]);
    const self = await apply(paladin.id, 'charmed', {ability: 'wisdom', dc: 40});
    assert.deepEqual([self.applied, self.immune], [false, 'аура преданности']);
    const ally = await apply(near.id, 'charmed', {ability: 'wisdom', dc: 40});
    assert.deepEqual([ally.applied, ally.immune], [false, 'аура преданности: Преданный']);
    assert.equal((await apply(far.id, 'charmed')).applied, true, '45 feet away — outside the aura');
    assert.equal((await apply(near.id, 'frightened')).applied, true, 'only charm');
    assert.match((await feature(paladin.id, 'aura-of-devotion')).detail, /в 10 фт\. нельзя очаровать/);
    await apply(paladin.id, 'stunned');
    assert.equal((await apply(near.id, 'charmed')).applied, true, 'a stunned paladin keeps no aura');
  });

  await t.test('wholeness of body: an action heals 3 × monk level once per long rest', async () => {
    const monk = await hero('Ладонь', 'Монах', 6, {hpCurrent: 10});
    assert.match((await feature(monk.id, 'wholeness-of-body')).detail, /\+18 хитов/);
    const healed = await request('POST', `${base}/characters/${monk.id}/features/wholeness-of-body`, alice.token, {});
    assert.equal(healed.statusCode, 200, healed.body);
    assert.match(healed.json().message, /«Цельность тела» — \+18 хит/);
    assert.equal(await hp(monk.id), 28);
    assert.deepEqual(await resource(monk.id, 'Цельность тела'), {current: 0, max: 1, recharge: 'long'});
    const again = await request('POST', `${base}/characters/${monk.id}/features/wholeness-of-body`, alice.token, {});
    assert.equal(again.statusCode, 400);
    assert.match(again.json().message, /потрачено/);
    const whole = await hero('Цельный', 'Монах', 6);
    assert.match((await request('POST', `${base}/characters/${whole.id}/features/wholeness-of-body`, alice.token, {})).json().message, /хиты и так полны/);
    const young = await hero('Ученик', 'Монах', 5, {hpCurrent: 10});
    assert.equal((await request('POST', `${base}/characters/${young.id}/features/wholeness-of-body`, alice.token, {})).statusCode, 400);
  });

  await t.test('divine strike: +1d8 radiant on a weapon hit, once on each of the cleric\'s turns', async () => {
    const cleric = await hero('Жрица', 'Жрец', 8, {strength: 10});
    const mace = (await request('POST', `${base}/characters/${cleric.id}/weapons`, alice.token, {name: 'Булава', ability: 'strength', proficient: false, attackBonus: 20, damageFormula: '1d1'})).json();
    const dummy = await npc('Чучело', {hpMax: 500, hpCurrent: 500, armorClass: 1});
    const holy = async () => (await pg.query<any>(`SELECT formula, outcome FROM roll_log WHERE character_id=$1 AND label LIKE '%божественный удар%' ORDER BY created_at`, [cleric.id])).rows;
    for (let i = 0; i < 4 && (await holy()).length < 2; i++) {
      await request('POST', `${base}/rolls/check`, alice.token, {characterId: cleric.id, kind: 'attack', key: mace.id, targetCharacterId: dummy.id});
    }
    const outside = await holy();
    assert.ok(outside.length >= 2, 'out of combat there are no turns to count');
    assert.equal(outside[0].formula, outside[0].outcome.critical ? '2d8' : '1d8', 'a critical hit doubles the dice');
    assert.equal(outside[0].outcome.damageType, 'radiant');

    const sceneId = await scene('Храм', [[alice.token, cleric.id, 0.5, 0.5], [gm.token, dummy.id, 1.5, 0.5]]);
    const scenePath = `${base}/scenes/${sceneId}`;
    for (const [characterId, score] of [[cleric.id, 30], [dummy.id, 5]] as const) {
      const id = (await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId})).json().id;
      await request('PATCH', `${scenePath}/initiative/${id}`, gm.token, {score});
    }
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    const before = (await holy()).length;
    let hits = 0;
    for (let i = 0; i < 6 && hits < 2; i++) {
      await pg.query('UPDATE initiative_entries SET action_used=false, attacks_made=0 WHERE character_id=$1', [cleric.id]);
      const attack = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: cleric.id, kind: 'attack', key: mace.id, targetCharacterId: dummy.id, sceneId})).json();
      if (attack.outcome?.hit) hits += 1;
    }
    assert.equal(hits, 2);
    assert.equal((await holy()).length, before + 1, 'twice hit in one turn — the strike once');
    assert.equal((await feature(cleric.id, 'divine-strike')).reason, 'в этот ход уже был');
    const flags = async () => (await pg.query<any>('SELECT turn_flags FROM initiative_entries WHERE character_id=$1', [cleric.id])).rows[0].turn_flags;
    assert.ok((await flags()).includes('divine-strike'), JSON.stringify(await flags()));
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    assert.deepEqual(await flags(), [], 'the next turn clears the marks');
    const young = await hero('Послушница', 'Жрец', 7);
    assert.equal(await feature(young.id, 'divine-strike'), undefined);
  });
});
