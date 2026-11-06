import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('polearms, luck, divine intervention, infernal legacy', async t => {
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
  const gm = await register('gm_legacy'), alice = await register('alice_legacy');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Legacy'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const hero = async (name: string, className: string, level: number, sheetExtra: any, extra: any = {}) => {
    const made = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 60, hpCurrent: 60, level, speedFeet: 30, ...extra})).json();
    await pg.query('UPDATE characters SET class_name=$2, sheet_extra=$3::jsonb WHERE id=$1', [made.id, className, JSON.stringify(sheetExtra)]);
    return made;
  };
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 100000, hpCurrent: 100000, armorClass: 1, speedFeet: 30, ...extra,
  })).json();
  const weapon = async (characterId: string, body: any, token = alice.token) => {
    const made = await request('POST', `${base}/characters/${characterId}/weapons`, token, {ability: 'strength', proficient: false, attackBonus: 20, ...body});
    assert.equal(made.statusCode, 201, made.body);
    return made.json();
  };
  const check = async (characterId: string, kind: string, key: string, extra: any = {}, token = alice.token) => {
    const response = await request('POST', `${base}/rolls/check`, token, {characterId, kind, key, ...extra});
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };
  const hit = async (characterId: string, key: string, targetId: string, extra: any = {}, token = alice.token) => {
    for (let i = 0; i < 30; i++) {
      const attack = await check(characterId, 'attack', key, {targetCharacterId: targetId, ...extra}, token);
      if (attack.outcome.hit) return attack;
    }
    throw new Error('no hit in 30 attacks');
  };
  const scene = async (name: string, members: Array<[string, string, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 24, heightCells: 12})).json().id;
    for (const [token, characterId, x, z] of members) {
      const placed = await request('POST', `${base}/scenes/${sceneId}/objects`, token, {characterId, x, z});
      assert.equal(placed.statusCode, 201, placed.body);
    }
    return sceneId as string;
  };
  const resource = async (id: string, name: string) => (await pg.query<any>('SELECT current, max, recharge FROM character_resources WHERE character_id=$1 AND name=$2', [id, name])).rows[0] ?? null;
  const fight = async (sceneId: string, order: Array<[string, number]>) => {
    const ids: Record<string, string> = {};
    for (const [id, score] of order) {
      ids[id] = (await request('POST', `${base}/scenes/${sceneId}/initiative/join`, gm.token, {characterId: id})).json().id;
      await request('PATCH', `${base}/scenes/${sceneId}/initiative/${ids[id]}`, gm.token, {score});
    }
    await request('POST', `${base}/scenes/${sceneId}/initiative/advance`, gm.token, {});
    return ids;
  };
  const walk = async (sceneId: string, characterId: string, x: number, z: number, token: string) => {
    const object = (await request('GET', `${base}/scenes/${sceneId}`, gm.token)).json().objects.find((entry: any) => entry.character_id === characterId);
    return request('PUT', `${base}/scenes/${sceneId}/objects/${object.id}`, token, {
      x, y: object.y, z, rotationY: object.rotation_y, scale: object.scale, snapToGrid: object.snap_to_grid, parentObjectId: null, animationName: object.animation_name, revision: object.revision,
    });
  };

  await t.test('polearm master: the butt end as a bonus attack; a foe entering the reach provokes', async () => {
    const spearman = await hero('Алебардщик', 'Воин', 4, {feats: ['polearm-master']}, {strength: 16});
    const dummy = await npc('Чучело');
    const glaive = await weapon(spearman.id, {name: 'Глефа', srdIndex: 'glaive', damageFormula: '1d10+@mod', damageType: 'slashing', rangeFeet: 10, properties: ['heavy', 'reach', 'two-handed']});
    const butt = await hit(spearman.id, glaive.id, dummy.id, {using: 'bonus'});
    assert.match(butt.damage.roll.formula, butt.damage.critical ? /^2d4\+3$/ : /^1d4\+3$/, 'the modifier stays — it is not a second weapon');
    assert.match(butt.damage.roll.label, /Глефа древком/);
    assert.ok(butt.outcome.reasons.includes('мастер древкового оружия: удар древком'));
    const plain = await hero('Копейщик', 'Воин', 4, {}, {strength: 16});
    const spear = await weapon(plain.id, {name: 'Глефа', srdIndex: 'glaive', damageFormula: '1d10+@mod', damageType: 'slashing', rangeFeet: 10});
    const second = await hit(plain.id, spear.id, dummy.id, {using: 'bonus'});
    assert.match(second.damage.roll.formula, /^\dd10$/, 'without the feat — the usual second-weapon rule: no STR +3');

    const goblin = await npc('Гоблин');
    const sceneId = await scene('Ворота', [[alice.token, spearman.id, 0.5, 0.5], [gm.token, goblin.id, 4.5, 0.5]]);
    await fight(sceneId, [[goblin.id, 30], [spearman.id, 10]]);
    assert.equal((await walk(sceneId, goblin.id, 2.5, 0.5, gm.token)).statusCode, 200);
    const rows = (await pg.query<any>('SELECT reactor_name, weapon_id FROM scene_opportunities WHERE scene_id=$1', [sceneId])).rows;
    assert.deepEqual(rows.map(row => [row.reactor_name, row.weapon_id]), [['Алебардщик', glaive.id]], 'entering 10-foot reach');
  });

  await t.test('crossbow expert: a hand crossbow bonus shot keeps the modifier; mobile: the struck foe does not provoke', async () => {
    const shooter = await hero('Стрелок', 'Плут', 4, {feats: ['crossbow-expert']}, {dexterity: 16});
    const dummy = await npc('Мишень');
    const hand = await weapon(shooter.id, {name: 'Ручной арбалет', srdIndex: 'crossbow-hand', ability: 'dexterity', damageFormula: '1d1+@mod', weaponKind: 'ranged', rangeFeet: 30, longRangeFeet: 120});
    const shot = await hit(shooter.id, hand.id, dummy.id, {using: 'bonus'});
    assert.equal(shot.damage.roll.total, shot.damage.critical ? 5 : 4);

    const runner = await hero('Бегун', 'Монах', 4, {feats: ['mobile']}, {strength: 10});
    const fist = await weapon(runner.id, {name: 'Кулак', damageFormula: '1d1'});
    const ogre = await npc('Огр');
    await weapon(ogre.id, {name: 'Дубина', damageFormula: '1d1'}, gm.token);
    const sceneId = await scene('Поляна', [[alice.token, runner.id, 0.5, 0.5], [gm.token, ogre.id, 1.5, 0.5]]);
    await fight(sceneId, [[runner.id, 30], [ogre.id, 10]]);
    await check(runner.id, 'attack', fist.id, {targetCharacterId: ogre.id, sceneId});
    assert.equal((await walk(sceneId, runner.id, -3.5, 0.5, alice.token)).statusCode, 200);
    assert.equal((await pg.query<any>('SELECT count(*)::int AS n FROM scene_opportunities WHERE scene_id=$1', [sceneId])).rows[0].n, 0, 'the ogre was struck — no opportunity');
  });

  await t.test('stroke of luck: a miss becomes a hit once per short rest', async () => {
    const rogue = await hero('Счастливица', 'Плут', 20, {}, {dexterity: 10});
    const wall = await npc('Стена', {armorClass: 30});
    const stick = await weapon(rogue.id, {name: 'Палка', damageFormula: '1d1', attackBonus: -10});
    const usedUp = (attack: any) => (attack.outcome.reasons ?? []).includes('удача: промах → попадание');
    let lucky = await check(rogue.id, 'attack', stick.id, {targetCharacterId: wall.id, strokeOfLuck: true});
    for (let i = 0; i < 5 && lucky.outcome.critical && !usedUp(lucky); i++) {
      lucky = await check(rogue.id, 'attack', stick.id, {targetCharacterId: wall.id, strokeOfLuck: true});
    }
    assert.equal(lucky.outcome.hit, true);
    assert.ok(usedUp(lucky));
    assert.ok(lucky.damage, 'the hit deals damage');
    assert.deepEqual(await resource(rogue.id, 'Удача'), {current: 0, max: 1, recharge: 'short'});
    assert.equal(usedUp(await check(rogue.id, 'attack', stick.id, {targetCharacterId: wall.id, strokeOfLuck: true})), false, 'spent');
    const young = await hero('Подмастерье', 'Плут', 19, {}, {dexterity: 10});
    const twig = await weapon(young.id, {name: 'Ветка', damageFormula: '1d1', attackBonus: -10});
    assert.equal(usedUp(await check(young.id, 'attack', twig.id, {targetCharacterId: wall.id, strokeOfLuck: true})), false, 'from 20th level');
  });

  await t.test('divine intervention: d100 against the cleric level; 7 days after an answer, a long rest after silence', async () => {
    const cleric = await hero('Молящийся', 'Жрец', 10, {});
    const call = () => request('POST', `${base}/characters/${cleric.id}/features/divine-intervention`, alice.token, {});
    const first = await call();
    assert.equal(first.statusCode, 200, first.body);
    const answered = /божество отвечает/.test(first.json().message);
    assert.match(first.json().message, answered ? /через 7 дней/ : /после долгого отдыха/);
    const again = await call();
    assert.equal(again.statusCode, 400);
    if (answered) {
      assert.match(again.json().message, /через 7 дн\./);
      await pg.query('UPDATE campaigns SET world_minutes = world_minutes + 10080 WHERE id=$1', [campaignId]);
    } else {
      assert.match(again.json().message, /после долгого отдыха/);
      await pg.query('UPDATE campaigns SET world_minutes = world_minutes + 1440 WHERE id=$1', [campaignId]);
      assert.equal((await request('POST', `${base}/characters/${cleric.id}/rest`, alice.token, {kind: 'long'})).statusCode, 200);
    }
    assert.equal((await call()).statusCode, 200, 'allowed again');
    const roll = (await pg.query<any>(`SELECT formula, outcome FROM roll_log WHERE character_id=$1 AND label LIKE 'Божественное вмешательство%' ORDER BY created_at DESC LIMIT 1`, [cleric.id])).rows[0];
    assert.deepEqual([roll.formula, roll.outcome.dc], ['1d100', 10]);
    const saint = await hero('Святой', 'Жрец', 20, {});
    assert.match((await request('POST', `${base}/characters/${saint.id}/features/divine-intervention`, alice.token, {})).json().message, /божество отвечает/, 'always at 20th');
    const novice = await hero('Послушник', 'Жрец', 9, {});
    assert.equal((await request('POST', `${base}/characters/${novice.id}/features/divine-intervention`, alice.token, {})).statusCode, 400);
  });

  await t.test('infernal legacy: hellish rebuke without a slot, by Charisma, once per long rest; ready as a reaction', async () => {
    const tiefling = await hero('Зефира', 'Волшебник', 5, {info: {race: 'Тифлинг'}}, {intelligence: 18, charisma: 14});
    await pg.query('UPDATE characters SET spell_save_dc_override=20 WHERE id=$1', [tiefling.id]);
    const brute = await npc('Разбойник', {dexterity: 10, hpMax: 200, hpCurrent: 200});
    const sceneId = await scene('Переулок', [[alice.token, tiefling.id, 0.5, 0.5], [gm.token, brute.id, 1.5, 0.5]]);
    const legacy = (await request('GET', `${base}/characters/${tiefling.id}/features`, alice.token)).json().features.find((entry: any) => entry.id === 'infernal-legacy');
    assert.deepEqual(legacy.legacy.map((spell: any) => [spell.index, spell.open, spell.entryId]), [['thaumaturgy', true, null], ['hellish-rebuke', true, null], ['darkness', true, null]]);
    const rebuke = (await request('POST', `${base}/characters/${tiefling.id}/spells`, alice.token, {source: 'srd', srdIndex: 'hellish-rebuke'})).json().id as string;
    const shield = (await request('POST', `${base}/characters/${tiefling.id}/spells`, alice.token, {source: 'srd', srdIndex: 'shield'})).json().id as string;
    const cast = (entry: string, body: any) => request('POST', `${base}/characters/${tiefling.id}/spells/${entry}/cast`, alice.token, {sceneId, targetIds: [brute.id], ...body});
    assert.match((await cast(rebuke, {})).json().message, /ячеек/, 'no slots — the usual way fails');
    const done = await cast(rebuke, {racial: true});
    assert.equal(done.statusCode, 201, done.body);
    const save = (await pg.query<any>(`SELECT label FROM roll_log WHERE character_id=$1 AND label LIKE 'Спасбросок%' ORDER BY created_at DESC LIMIT 1`, [brute.id])).rows[0];
    assert.match(save.label, /СЛ 13/, '8 + proficiency 3 + CHA 2 — not the wizard DC from the sheet');
    const damage = (await pg.query<any>(`SELECT formula FROM roll_log WHERE character_id=$1 AND outcome->>'kind'='damage' ORDER BY created_at DESC LIMIT 1`, [tiefling.id])).rows[0];
    assert.equal(damage?.formula, '3d10', 'cast as a 2nd-level spell');
    assert.deepEqual(await resource(tiefling.id, 'Наследие: Адское возмездие'), {current: 0, max: 1, recharge: 'long'});
    assert.match((await cast(rebuke, {racial: true})).json().message, /после долгого отдыха/);
    assert.equal((await cast(shield, {racial: true})).statusCode, 400, 'not a legacy spell');
    assert.equal((await cast(rebuke, {racial: true, slotLevel: 3})).statusCode, 400);

    await request('POST', `${base}/characters/${tiefling.id}/rest`, alice.token, {kind: 'long'});
    assert.equal((await resource(tiefling.id, 'Наследие: Адское возмездие')).current, 1);
    assert.equal((await request('PUT', `${base}/characters/${tiefling.id}/reactions`, alice.token, {'hellish-rebuke': true})).statusCode, 200);
    const club = await weapon(brute.id, {name: 'Дубина', damageFormula: '1d1'}, gm.token);
    const before = Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [brute.id])).rows[0].hp_current);
    await hit(brute.id, club.id, tiefling.id, {}, gm.token);
    for (let wait = 0; wait < 40 && Number((await resource(tiefling.id, 'Наследие: Адское возмездие')).current) === 1; wait++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal((await resource(tiefling.id, 'Наследие: Адское возмездие')).current, 0, 'the rebuke went by the legacy');
    assert.ok(Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [brute.id])).rows[0].hp_current) <= before);

    const young = await hero('Юный', 'Воин', 2, {info: {race: 'Тифлинг'}}, {charisma: 14});
    const entry = (await request('POST', `${base}/characters/${young.id}/spells`, alice.token, {source: 'srd', srdIndex: 'hellish-rebuke'})).json().id as string;
    assert.equal((await request('POST', `${base}/characters/${young.id}/spells/${entry}/cast`, alice.token, {targetIds: [brute.id], racial: true})).statusCode, 400, 'from 3rd level');
  });
});
