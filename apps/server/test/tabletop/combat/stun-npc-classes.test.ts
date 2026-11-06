import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('stunning strike, deflect missiles, aid, mage armor, NPC class features, druid, concentration', async t => {
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
  const gm = await register('gm_stun'), alice = await register('alice_stun');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Stun'})).json().id;
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
  const row = async (id: string) => (await pg.query<any>('SELECT hp_current, hp_max, armor_class FROM characters WHERE id=$1', [id])).rows[0];
  const effect = async (id: string, code: string) => (await pg.query<any>('SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code=$2 AND active', [id, code])).rows[0]?.parameters ?? null;
  const spot = async (id: string) => (await pg.query<any>('SELECT x::float8 AS x, z::float8 AS z FROM scene_objects WHERE character_id=$1', [id])).rows[0] as {x: number; z: number};
  const arena = async (name: string, members: Array<[string, string, number, number, number]>, size = {widthCells: 24, heightCells: 12}) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, ...size})).json().id;
    const scenePath = `${base}/scenes/${sceneId}`;
    for (const [token, characterId, x, z] of members) await request('POST', `${scenePath}/objects`, token, {characterId, x, z});
    for (const [, characterId, , , score] of members) {
      const id = (await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId})).json().id;
      await request('PATCH', `${scenePath}/initiative/${id}`, gm.token, {score});
    }
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    return {sceneId, scenePath, auto: async () => (await request('POST', `${scenePath}/initiative/auto`, gm.token, {advance: false})).json()};
  };
  const ki = async (id: string) => (await pg.query<any>(`SELECT current FROM character_resources WHERE character_id=$1 AND name='Ци'`, [id])).rows[0]?.current;

  await t.test('stunning strike: an offer after a melee hit, a CON save, stunned until the end of the monk’s next turn', async () => {
    const monk = await hero('Шэнь', 'Монах', 5, {dexterity: 16, wisdom: 16});
    const dummy = await npc('Манекен', {constitution: 1});
    const staff = await weapon(monk.id, {name: 'Посох', attackBonus: 20}, alice.token);
    const {sceneId} = await arena('Додзё', [[alice.token, monk.id, 0.5, 0.5, 30], [gm.token, dummy.id, 1.5, 0.5, 5]]);
    let stunned = false;
    for (let i = 0; i < 25 && !stunned; i++) {
      await pg.query(`UPDATE initiative_entries SET action_used=false, attacks_made=0 WHERE character_id=$1`, [monk.id]);
      const blow = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: monk.id, kind: 'attack', key: staff.id, targetCharacterId: dummy.id, sceneId})).json();
      if (!blow.stun) continue;
      assert.equal(blow.stun.dc, 14, '8 + 3 + WIS 3');
      const before = await ki(monk.id);
      const done = await request('POST', `${base}/rolls/${blow.stun.rollId}/stunning-strike`, alice.token);
      assert.equal(done.statusCode, 201, done.body);
      assert.equal(await ki(monk.id), (before ?? 5) - 1);
      assert.match((await request('POST', `${base}/rolls/${blow.stun.rollId}/stunning-strike`, alice.token)).json().message, /уже был/);
      stunned = done.json().stunned;
    }
    assert.ok(stunned, 'CON −5 against 14 — stunned sooner or later');
    assert.deepEqual((await effect(dummy.id, 'stunned')).expires, {at: 'end', of: monk.id, skip: 1});
    const again = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: monk.id, kind: 'attack', key: staff.id, targetCharacterId: dummy.id, sceneId})).json();
    assert.equal(again.stun, undefined, 'already stunned — no offer');
  });

  await t.test('deflect missiles ready: a ranged hit loses 1d10 + DEX + monk level', async () => {
    const monk = await hero('Ловец', 'Монах', 3, {dexterity: 16, hpMax: 80, hpCurrent: 80});
    const archer = await npc('Лучник');
    const bow = await weapon(archer.id, {name: 'Лук', ability: 'dexterity', attackBonus: 20, damageFormula: '1d1+29', weaponKind: 'ranged', rangeFeet: 80, longRangeFeet: 320});
    assert.equal((await request('PUT', `${base}/characters/${monk.id}/reactions`, alice.token, {'deflect-missiles': true})).statusCode, 200);
    const {sceneId} = await arena('Тир', [[gm.token, archer.id, -5.5, 0.5, 30], [alice.token, monk.id, 4.5, 0.5, 5]]);
    let shot: any = null;
    for (let i = 0; i < 20 && !shot?.deflected; i++) {
      await pg.query(`UPDATE initiative_entries SET action_used=false, attacks_made=0 WHERE character_id=$1`, [archer.id]);
      shot = (await request('POST', `${base}/rolls/check`, gm.token, {characterId: archer.id, kind: 'attack', key: bow.id, targetCharacterId: monk.id, sceneId})).json();
    }
    assert.ok(shot.deflected, JSON.stringify(shot).slice(0, 300));
    const value = shot.deflected.value;
    assert.ok(value >= 1 + 3 + 3 && value <= 10 + 3 + 3);
    assert.equal(shot.damage.applied, Math.max(0, (shot.damage.critical ? 31 : 30) - value), 'a crit doubles the 1d1');
    assert.match(shot.damage.roll.label, /отражено/);
    assert.equal((await pg.query<any>('SELECT reaction_used FROM initiative_entries WHERE character_id=$1', [monk.id])).rows[0].reaction_used, true);
  });

  await t.test('aid raises the maximum and current hit points (more with a higher slot, not stacking) until a long rest; mage armor sets AC 13 + DEX', async () => {
    const cleric = await hero('Жрец', 'Жрец', 5, {wisdom: 16});
    await slots(cleric.id, 2, 4);
    await slots(cleric.id, 3, 2);
    await slots(cleric.id, 1, 2);
    const one = await hero('Первый', 'Воин', 3, {hpMax: 30, hpCurrent: 20});
    const two = await hero('Второй', 'Воин', 3, {hpMax: 30, hpCurrent: 30});
    const aid = await learn(cleric.id, 'aid');
    assert.equal((await request('POST', `${base}/characters/${cleric.id}/spells/${aid}/cast`, alice.token, {targetIds: [one.id, two.id]})).statusCode, 201);
    assert.deepEqual([(await row(one.id)).hp_max, (await row(one.id)).hp_current], [35, 25]);
    assert.equal((await request('POST', `${base}/characters/${cleric.id}/spells/${aid}/cast`, alice.token, {targetIds: [one.id], slotLevel: 3})).statusCode, 201);
    assert.deepEqual([(await row(one.id)).hp_max, (await row(one.id)).hp_current], [40, 30], 'only the difference');
    const rest = await request('POST', `${base}/characters/${one.id}/rest`, alice.token, {kind: 'long'});
    assert.equal(rest.statusCode, 200, rest.body);
    assert.deepEqual([(await row(one.id)).hp_max, (await row(one.id)).hp_current], [30, 30], 'over after a long rest');
    assert.equal(await effect(one.id, 'aid'), null);

    const wizard = await hero('Маг', 'Волшебник', 3, {dexterity: 14, armorClass: 12});
    await slots(wizard.id, 1, 2);
    const armor = await learn(wizard.id, 'mage-armor');
    assert.equal((await request('POST', `${base}/characters/${wizard.id}/spells/${armor}/cast`, alice.token, {targetIds: [wizard.id]})).statusCode, 201);
    assert.equal((await effect(wizard.id, 'mage_armor')).base, 13);
    const thug = await npc('Головорез');
    const club = await weapon(thug.id, {name: 'Дубинка'});
    const preview = (await request('GET', `${base}/rolls/attack-preview?characterId=${thug.id}&key=${club.id}&targetCharacterId=${wizard.id}&advantage=none`, gm.token)).json();
    assert.equal(preview.hitChance, 0.3, 'AC 15 = 13 + DEX 2 for a +0 attack');
  });

  await t.test('NPC class features in the auto turn: rage before a melee swing; second wind at half and an action surge; flurry and stunning strike', async () => {
    const hero1 = await hero('Цель', 'Воин', 3, {hpMax: 400, hpCurrent: 400, armorClass: 1, constitution: 1});
    const berserk = await npc('Берсерк', {strength: 16, level: 3});
    await classed(berserk.id, 'Варвар 3');
    await weapon(berserk.id, {name: 'Секира', damageFormula: '1d12+3'});
    const a = await arena('Ярость', [[gm.token, berserk.id, 0.5, 0.5, 30], [alice.token, hero1.id, 1.5, 0.5, 5]]);
    const raged = await a.auto();
    assert.match(raged.summary, /впадает в ярость/, raged.summary);
    assert.ok(await effect(berserk.id, 'raging'));

    const veteran = await npc('Ветеран', {strength: 16, level: 2, hpMax: 40, hpCurrent: 15});
    await classed(veteran.id, 'Воин 2');
    await weapon(veteran.id, {name: 'Меч', damageFormula: '1d8'});
    const b = await arena('Всплеск', [[gm.token, veteran.id, 0.5, 0.5, 30], [alice.token, hero1.id, 1.5, 0.5, 5]]);
    const surged = await b.auto();
    assert.match(surged.summary, /второе дыхание: \+\d+ хит\./, surged.summary);
    assert.match(surged.summary, /всплеск действий/);
    assert.equal(surged.attacks.length, 2, 'one attack, then one more after the surge');

    const master = await npc('Мастер', {dexterity: 16, wisdom: 16, level: 5});
    await classed(master.id, 'Монах 5');
    await weapon(master.id, {name: 'Кулак', ability: 'finesse', proficient: true, attackBonus: 20, damageFormula: '1d6'});
    const c = await arena('Шквал', [[gm.token, master.id, 0.5, 0.5, 30], [alice.token, hero1.id, 1.5, 0.5, 5]]);
    const flurry = await c.auto();
    assert.equal(flurry.attacks.length, 2, 'Extra Attack at 5th level');
    assert.match(flurry.summary, /«Ошеломляющий удар» по «Цель»/, flurry.summary);
    assert.match(flurry.summary, /«Шквал ударов» по «Цель»/);
  });

  await t.test('an NPC druid takes the sturdiest beast first, then fights with its attacks', async () => {
    const druid = await npc('Друидесса', {wisdom: 16, level: 2, hpMax: 18, hpCurrent: 18});
    await classed(druid.id, 'Друид 2');
    const victim = await hero('Добыча', 'Воин', 3, {hpMax: 300, hpCurrent: 300, armorClass: 1});
    const {auto} = await arena('Лес', [[gm.token, druid.id, 0.5, 0.5, 30], [alice.token, victim.id, 4.5, 0.5, 5]]);
    const first = await auto();
    assert.match(first.summary, /оборачивается: Пантера/, first.summary);
    assert.equal((await row(druid.id)).hp_max, 13);
    await pg.query('UPDATE initiative_entries SET action_used=false, attacks_made=0, moved_feet=0 WHERE character_id=$1', [druid.id]);
    const second = await auto();
    assert.ok(second.attacks.length >= 1, second.summary);
    assert.match(second.attacks[0].weaponName, /\(Пантера\)/);
  });

  await t.test('while concentrating, an NPC caster stands as far from its foes as it can and still strike', async () => {
    const run = async (concentrating: boolean) => {
      const caster = await npc(concentrating ? 'Сосредоточенная' : 'Рассеянная', {intelligence: 16, speedFeet: 60});
      await learn(caster.id, 'ray-of-frost');
      const target = await hero(concentrating ? 'Цель-1' : 'Цель-2', 'Воин', 3, {hpMax: 300, hpCurrent: 10});
      const bystander = await hero(concentrating ? 'Рядом-1' : 'Рядом-2', 'Воин', 3, {hpMax: 300, hpCurrent: 300});
      if (concentrating) await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'concentration','{"spellName":"Паутина"}')`, [campaignId, caster.id]);
      const {scenePath} = await arena(concentrating ? 'Далеко-1' : 'Далеко-2', [
        [gm.token, caster.id, -9.5, 0.5, 30], [alice.token, target.id, 4.5, 0.5, 10], [alice.token, bystander.id, -5.5, 1.5, 5],
      ]);
      const result = (await request('POST', `${scenePath}/initiative/auto`, gm.token, {advance: false, target: 'weakest'})).json();
      assert.ok(result.moved, result.summary);
      return spot(caster.id);
    };
    const careless = await run(false);
    const careful = await run(true);
    const fromBystander = (at: {x: number; z: number}) => Math.max(Math.abs(at.x + 5.5), Math.abs(at.z - 1.5));
    assert.ok(fromBystander(careful) > fromBystander(careless), `kept away: ${JSON.stringify(careful)} vs ${JSON.stringify(careless)}`);
    assert.ok(Math.max(Math.abs(careful.x - 4.5), Math.abs(careful.z - 0.5)) <= 12, 'still in range of the target (60 feet)');
  });
});
