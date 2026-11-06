import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('round 28: weapon spells, warding bond, beacon of hope, darkvision, raise dead, misty step', async t => {
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
  const gm = await register('gm_r28'), alice = await register('alice_r28');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Круг 28'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Поле', widthCells: 20, heightCells: 20})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const hero = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 30, hpCurrent: 30, level: 9, ...extra})).json();
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
  const cast = (characterId: string, entry: string, body: any) =>
    request('POST', `${base}/characters/${characterId}/spells/${entry}/cast`, alice.token, {sceneId, ...body});
  const hp = async (id: string) => Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current);
  const hurt = async (characterId: string, amount: number) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: `1d1+${amount - 1}`})).json();
    return (await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId, mode: 'damage', damageType: 'slashing'})).json();
  };
  const weapon = async (characterId: string, token: string, body: any) =>
    (await request('POST', `${base}/characters/${characterId}/weapons`, token, {ability: 'strength', proficient: false, ...body})).json().id as string;
  const swing = (attackerId: string, key: string, targetId: string, token = alice.token) =>
    request('POST', `${base}/rolls/check`, token, {characterId: attackerId, kind: 'attack', key, targetCharacterId: targetId, sceneId});

  const druid = await hero('Друид', {wisdom: 18, strength: 8});
  const cleric = await hero('Жрица', {wisdom: 18});
  const ally = await hero('Соратник', {strength: 10});
  const dummy = await npc('Чучело');
  await place(druid.id, 0.5, 0.5, alice.token);
  await place(cleric.id, 2.5, 0.5, alice.token);
  await place(ally.id, 1.5, 0.5, alice.token);
  await place(dummy.id, 0.5, 1.5);
  for (const caster of [druid.id, cleric.id]) {
    await pg.query(
      `INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,9,9), ($1,$2,2,9,9), ($1,$2,3,9,9), ($1,$2,4,9,9), ($1,$2,5,9,9)`,
      [campaignId, caster],
    );
  }

  await t.test('«Дубинка»: the quarterstaff hits with Wisdom and a d8', async () => {
    const shillelagh = await learn(druid.id, 'shillelagh');
    assert.match((await cast(druid.id, shillelagh, {})).json().message, /нужна дубинка или боевой посох/);
    const staff = await weapon(druid.id, alice.token, {name: 'Боевой посох', damageFormula: '1d6+@mod', damageType: 'bludgeoning'});
    const result = await cast(druid.id, shillelagh, {});
    assert.ok(result.statusCode < 300, result.body);
    const held = await effect(druid.id, 'shillelagh');
    assert.deepEqual([held.weaponId, held.ability], [staff, 'wisdom']);
    let hit: any = null;
    for (let i = 0; i < 40 && !hit; i++) {
      const done = (await swing(druid.id, staff, dummy.id)).json();
      assert.ok(done.outcome.reasons.some((reason: string) => /дубинка: Мудрость/.test(reason)), JSON.stringify(done.outcome));
      if (done.damage && !done.outcome.critical) hit = done;
    }
    assert.ok(hit, 'hit without a critical at least once');
    assert.equal(hit.damage.roll.formula, '1d8+4');
  });

  await t.test('«Магическое оружие»: +1 to hit and damage with the best plain weapon, +2 from a 4th-level slot', async () => {
    await weapon(ally.id, alice.token, {name: 'Кинжал', damageFormula: '1d4+@mod', damageType: 'piercing'});
    const sword = await weapon(ally.id, alice.token, {name: 'Длинный меч', damageFormula: '1d8+@mod', damageType: 'slashing'});
    const spell = await learn(cleric.id, 'magic-weapon');
    const result = await cast(cleric.id, spell, {targetIds: [ally.id]});
    assert.ok(result.statusCode < 300, result.body);
    assert.deepEqual([(await effect(ally.id, 'magic_weapon')).weaponId, (await effect(ally.id, 'magic_weapon')).bonus], [sword, 1]);
    assert.ok(JSON.stringify(result.json().targets).includes('«Длинный меч» +1'), JSON.stringify(result.json().targets));
    const done = (await swing(ally.id, sword, dummy.id)).json();
    assert.ok(done.outcome.reasons.includes('магическое оружие +1'), JSON.stringify(done.outcome));
    if (done.damage && !done.outcome.critical) assert.equal(done.damage.roll.formula, '1d8+1');
    await pg.query(`INSERT INTO character_effects(campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'stoneskin','{}')`, [campaignId, dummy.id]);
    let struck: any = null;
    for (let i = 0; i < 20 && !struck; i++) {
      const next = (await swing(ally.id, sword, dummy.id)).json();
      if (next.damage) struck = next;
    }
    assert.ok(struck);
    assert.equal(struck.damage.modified, null, 'a magical weapon is not resisted by stoneskin');
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code='stoneskin'`, [dummy.id]);
    assert.ok((await cast(cleric.id, spell, {targetIds: [ally.id], slotLevel: 4})).statusCode < 300);
    assert.equal((await effect(ally.id, 'magic_weapon')).bonus, 2);
  });

  await t.test('«Охраняющая связь»: +1 AC and saves, half damage — and the caster takes the same', async () => {
    const bond = await learn(cleric.id, 'warding-bond');
    assert.match((await cast(cleric.id, bond, {targetIds: [cleric.id]})).json().message, /связь не на себя/);
    await pg.query('UPDATE characters SET armor_class=11 WHERE id=$1', [ally.id]);
    const bite = await weapon(dummy.id, gm.token, {name: 'Укус', damageFormula: '1d1'});
    const preview = async () => Number((await request('GET', `${base}/rolls/attack-preview?characterId=${dummy.id}&key=${bite}&targetCharacterId=${ally.id}&sceneId=${sceneId}&advantage=none`, gm.token)).json().hitChance);
    const before = await preview();
    assert.ok((await cast(cleric.id, bond, {targetIds: [ally.id]})).statusCode < 300);
    assert.ok(Math.abs(before - await preview() - 0.05) < 0.026, 'AC +1');
    const save = await request('POST', `${base}/rolls/check`, alice.token, {characterId: ally.id, kind: 'save', key: 'constitution'});
    assert.ok(save.json().outcome.reasons.includes('охраняющая связь +1'), JSON.stringify(save.json().outcome));
    const [allyBefore, clericBefore] = [await hp(ally.id), await hp(cleric.id)];
    const applied = await hurt(ally.id, 10);
    assert.equal(applied.applied, 5, JSON.stringify(applied));
    assert.equal(allyBefore - await hp(ally.id), 5);
    assert.equal(clericBefore - await hp(cleric.id), 5, 'the caster takes the same damage');
    assert.ok(applied.notices.some((notice: any) => /Охраняющая связь/.test(notice.title)), JSON.stringify(applied.notices));
    await pg.query('UPDATE characters SET hp_current=3 WHERE id=$1', [cleric.id]);
    await hurt(ally.id, 10);
    assert.equal(await hp(cleric.id), 0);
    assert.equal(await effect(ally.id, 'warding_bond'), null, 'the bond breaks when the caster drops');
    await pg.query(`UPDATE characters SET hp_current=30 WHERE id IN ($1, $2)`, [cleric.id, ally.id]);
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code IN ('unconscious', 'prone')`, [cleric.id]);
  });

  await t.test('«Маяк надежды»: advantage on WIS and death saves, healing at its maximum', async () => {
    assert.ok((await cast(cleric.id, await learn(cleric.id, 'beacon-of-hope'), {targetIds: [ally.id]})).statusCode < 300);
    assert.ok(await effect(ally.id, 'beacon_of_hope'));
    const save = await request('POST', `${base}/rolls/check`, alice.token, {characterId: ally.id, kind: 'save', key: 'wisdom'});
    assert.ok(JSON.stringify(save.json().outcome).includes('маяк надежды'), JSON.stringify(save.json().outcome));
    const healer = await hero('Целительница', {wisdom: 16});
    await place(healer.id, 2.5, 1.5, alice.token);
    await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,9,9)`, [campaignId, healer.id]);
    await pg.query('UPDATE characters SET hp_current=5 WHERE id=$1', [ally.id]);
    const cure = await cast(healer.id, await learn(healer.id, 'cure-wounds'), {targetIds: [ally.id]});
    assert.ok(cure.statusCode < 300, cure.body);
    assert.equal(await hp(ally.id), 5 + 8 + 3, 'd8 at its maximum + WIS');
    await pg.query('UPDATE characters SET hp_current=5 WHERE id=$1', [ally.id]);
    const potion = (await request('POST', `${base}/rolls`, gm.token, {formula: '2d4+2'})).json();
    await request('POST', `${base}/rolls/${potion.id}/apply`, gm.token, {characterId: ally.id, mode: 'heal'});
    assert.equal(await hp(ally.id), 15);
    await pg.query('UPDATE characters SET hp_current=0 WHERE id=$1', [ally.id]);
    await pg.query(`INSERT INTO character_effects(campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'unconscious','{}')`, [campaignId, ally.id]);
    const death = await request('POST', `${base}/characters/${ally.id}/death-save`, alice.token);
    assert.equal(death.statusCode, 200, death.body);
    assert.equal(death.json().roll.dice_results.length, 2, 'two d20 — the higher one');
    await pg.query(`UPDATE characters SET hp_current=30, death_successes=0, death_failures=0 WHERE id=$1`, [ally.id]);
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code IN ('unconscious', 'stable', 'prone')`, [ally.id]);
  });

  await t.test('«Тёмное зрение»: at least 60 ft of darkvision', async () => {
    assert.ok((await cast(druid.id, await learn(druid.id, 'darkvision'), {targetIds: [ally.id]})).statusCode < 300);
    assert.ok(await effect(ally.id, 'darkvision_spell'));
    const scene = (await request('GET', scenePath, alice.token)).json();
    const mine = (scene.objects ?? scene.placements).find((entry: any) => entry.character_id === ally.id);
    assert.equal(Number(mine.darkvision_feet), 60, JSON.stringify(mine));
  });

  await t.test('«Оживление»: the dead back with 1 hit point', async () => {
    await pg.query('UPDATE characters SET hp_current=0 WHERE id=$1', [dummy.id]);
    await pg.query(`INSERT INTO character_effects(campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'dead','{}')`, [campaignId, dummy.id]);
    const result = await cast(druid.id, await learn(druid.id, 'raise-dead'), {targetIds: [dummy.id]});
    assert.ok(result.statusCode < 300, result.body);
    assert.equal(await hp(dummy.id), 1);
    assert.equal(await effect(dummy.id, 'dead'), null);
  });

  await t.test('«Туманный шаг»: 30 ft to a free cell in sight, not further, not onto someone', async () => {
    const step = await learn(druid.id, 'misty-step');
    const list = (await request('GET', `${base}/characters/${druid.id}/spells`, alice.token)).json().spells;
    assert.deepEqual(list.find((entry: any) => entry.id === step).spell.teleport, {rangeFeet: 30});
    assert.match((await cast(druid.id, step, {})).json().message, /щелчок по карте/);
    assert.match((await cast(druid.id, step, {place: {x: 7.5, z: 0.5}})).json().message, /дальше 30 фт/);
    assert.match((await cast(druid.id, step, {place: {x: 1.5, z: 0.5}})).json().message, /место занято/);
    const moved = await cast(druid.id, step, {place: {x: 4.5, z: 3.5}});
    assert.ok(moved.statusCode < 300, moved.body);
    const at = (await pg.query<any>('SELECT x, z FROM scene_objects WHERE character_id=$1', [druid.id])).rows[0];
    assert.deepEqual([Number(at.x), Number(at.z)], [4.5, 3.5]);
    assert.ok(JSON.stringify(moved.json().targets).includes('перенёсся на 20 фт.'), JSON.stringify(moved.json().targets));
    assert.equal((await request('POST', `${scenePath}/walls`, gm.token, {x1: 6, z1: 0, x2: 6, z2: 8})).statusCode, 201);
    assert.match((await cast(druid.id, step, {place: {x: 7.5, z: 3.5}})).json().message, /не видно/);
  });
});
