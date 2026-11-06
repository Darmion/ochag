import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('sentinel and mage slayer reactions, lucky defense, luck on checks, camouflage, blindsense, beast spells', async t => {
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
  const gm = await register('gm_reactions'), alice = await register('alice_reactions');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Reactions'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const hero = async (name: string, className: string, level: number, sheetExtra: any, extra: any = {}) => {
    const made = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 60, hpCurrent: 60, level, speedFeet: 30, ...extra})).json();
    await pg.query('UPDATE characters SET class_name=$2, sheet_extra=$3::jsonb WHERE id=$1', [made.id, className, JSON.stringify(sheetExtra)]);
    return made;
  };
  const npc = async (name: string, extra: any = {}, sheetExtra: any = null) => {
    const made = (await request('POST', `${base}/characters`, gm.token, {
      kind: 'npc', name, disposition: 'hostile', hpMax: 100000, hpCurrent: 100000, armorClass: 1, speedFeet: 30, ...extra,
    })).json();
    if (sheetExtra) await pg.query('UPDATE characters SET sheet_extra=$2::jsonb WHERE id=$1', [made.id, JSON.stringify(sheetExtra)]);
    return made;
  };
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
  const scene = async (name: string, members: Array<[string, string, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 24, heightCells: 12})).json().id;
    for (const [token, characterId, x, z] of members) {
      const placed = await request('POST', `${base}/scenes/${sceneId}/objects`, token, {characterId, x, z});
      assert.equal(placed.statusCode, 201, placed.body);
    }
    return sceneId as string;
  };
  const fight = async (sceneId: string, order: Array<[string, number]>) => {
    for (const [id, score] of order) {
      const entry = (await request('POST', `${base}/scenes/${sceneId}/initiative/join`, gm.token, {characterId: id})).json().id;
      await request('PATCH', `${base}/scenes/${sceneId}/initiative/${entry}`, gm.token, {score});
    }
    await request('POST', `${base}/scenes/${sceneId}/initiative/advance`, gm.token, {});
  };
  const walk = async (sceneId: string, characterId: string, x: number, z: number, token: string) => {
    const object = (await request('GET', `${base}/scenes/${sceneId}`, gm.token)).json().objects.find((entry: any) => entry.character_id === characterId);
    return request('PUT', `${base}/scenes/${sceneId}/objects/${object.id}`, token, {
      x, y: object.y, z, rotationY: object.rotation_y, scale: object.scale, snapToGrid: object.snap_to_grid, parentObjectId: null, animationName: object.animation_name, revision: object.revision,
    });
  };
  const effect = (id: string, effectCode: string, parameters: any = {}) => pg.query(
    `INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,$3,$4::jsonb)`, [campaignId, id, effectCode, JSON.stringify(parameters)],
  );
  const opportunities = async (sceneId: string) => (await pg.query<any>('SELECT reactor_name, mover_name, reason FROM scene_opportunities WHERE scene_id=$1 ORDER BY reactor_name', [sceneId])).rows
    .map(row => [row.reactor_name, row.mover_name, row.reason]);
  const resource = async (id: string, name: string) => (await pg.query<any>('SELECT current, max FROM character_resources WHERE character_id=$1 AND name=$2', [id, name])).rows[0] ?? null;
  const effects = async (id: string) => (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active ORDER BY effect_code', [id])).rows.map(row => row.effect_code);
  const learn = async (characterId: string, name: string, level: number, mechanics: Record<string, unknown> = {}, token = alice.token) => {
    const columns = Object.keys(mechanics);
    const spellId = (await pg.query<any>(
      `INSERT INTO campaign_spells (campaign_id, created_by, name, level, school, status, range${columns.map(column => `, ${column}`).join('')})
       VALUES ($1,$2,$3,$4,'Conjuration','approved','60 feet'${columns.map((_, index) => `, $${index + 5}`).join('')}) RETURNING id`,
      [campaignId, alice.user.id, name, level, ...Object.values(mechanics)],
    )).rows[0].id;
    const entry = await request('POST', `${base}/characters/${characterId}/spells`, token, {source: 'custom', customSpellId: spellId});
    assert.equal(entry.statusCode, 201, entry.body);
    return entry.json().id as string;
  };

  await t.test('sentinel: a foe striking someone else nearby gives a reaction attack; not if the target is a sentinel too', async () => {
    const guard = await hero('Страж', 'Воин', 5, {feats: ['sentinel']});
    const ward = await hero('Подопечный', 'Волшебник', 5, {});
    const orc = await npc('Орк');
    const spear = await weapon(guard.id, {name: 'Копьё', damageFormula: '1d1'});
    const axe = await weapon(orc.id, {name: 'Топор', damageFormula: '1d1'}, gm.token);
    const sceneId = await scene('Мост', [[alice.token, guard.id, 0.5, 0.5], [alice.token, ward.id, 1.5, 1.5], [gm.token, orc.id, 1.5, 0.5]]);
    await fight(sceneId, [[orc.id, 30], [guard.id, 20], [ward.id, 10]]);
    await check(orc.id, 'attack', axe.id, {targetCharacterId: ward.id, sceneId}, gm.token);
    assert.deepEqual(await opportunities(sceneId), [['Страж', 'Орк', 'sentinel']]);
    const answer = await check(guard.id, 'attack', spear.id, {targetCharacterId: orc.id, sceneId, opportunity: true});
    assert.ok(!(answer.outcome.reasons ?? []).includes('часовой: скорость цели 0 до конца её хода'), 'not an opportunity attack — no speed 0');
    assert.deepEqual(await opportunities(sceneId), []);
    assert.equal((await request('POST', `${base}/rolls/check`, alice.token, {characterId: guard.id, kind: 'attack', key: spear.id, targetCharacterId: orc.id, sceneId, opportunity: true})).statusCode, 400, 'the reaction is spent');

    const twin = await hero('Второй страж', 'Воин', 5, {feats: ['sentinel']});
    const watcher = await hero('Дозорный', 'Воин', 5, {feats: ['sentinel']});
    await weapon(watcher.id, {name: 'Меч', damageFormula: '1d1'});
    const brute = await npc('Громила');
    const club = await weapon(brute.id, {name: 'Дубина', damageFormula: '1d1'}, gm.token);
    const second = await scene('Ворота', [[alice.token, twin.id, 0.5, 0.5], [alice.token, watcher.id, 2.5, 0.5], [gm.token, brute.id, 1.5, 0.5]]);
    await fight(second, [[brute.id, 30], [twin.id, 20], [watcher.id, 10]]);
    await check(brute.id, 'attack', club.id, {targetCharacterId: twin.id, sceneId: second}, gm.token);
    assert.deepEqual(await opportunities(second), [], 'the target has the feat itself');
  });

  await t.test('an NPC sentinel strikes by itself', async () => {
    const knight = await npc('Рыцарь-страж', {}, {feats: ['sentinel']});
    await weapon(knight.id, {name: 'Алебарда', damageFormula: '1d1'}, gm.token);
    const thief = await hero('Воришка', 'Плут', 5, {});
    const dagger = await weapon(thief.id, {name: 'Кинжал', damageFormula: '1d1'});
    const lord = await npc('Лорд');
    const sceneId = await scene('Зал', [[alice.token, thief.id, 0.5, 0.5], [gm.token, knight.id, 1.5, 0.5], [gm.token, lord.id, 0.5, 1.5]]);
    await fight(sceneId, [[thief.id, 30], [knight.id, 20], [lord.id, 10]]);
    await check(thief.id, 'attack', dagger.id, {targetCharacterId: lord.id, sceneId});
    const answer = (await pg.query<any>(`SELECT label FROM roll_log WHERE character_id=$1 AND label LIKE 'Атака: Алебарда%'`, [knight.id])).rows;
    assert.equal(answer.length, 1, 'the knight answered with the halberd');
    assert.deepEqual(await opportunities(sceneId), []);
  });

  await t.test('mage slayer: a caster nearby gives a reaction attack; its damage is disadvantage on concentration', async () => {
    const hunter = await hero('Охотница', 'Воин', 5, {feats: ['mage-slayer']});
    const sword = await weapon(hunter.id, {name: 'Меч', damageFormula: '1d1'});
    const witch = await npc('Ведьма');
    const spark = await learn(witch.id, 'Искра', 0, {attack_kind: 'ranged', damage_formula: '1d1', damage_type: 'fire'}, gm.token);
    const sceneId = await scene('Поляна', [[alice.token, hunter.id, 0.5, 0.5], [gm.token, witch.id, 1.5, 0.5]]);
    await fight(sceneId, [[witch.id, 30], [hunter.id, 10]]);
    const cast = await request('POST', `${base}/characters/${witch.id}/spells/${spark}/cast`, gm.token, {sceneId, targetIds: [hunter.id]});
    assert.equal(cast.statusCode, 201, cast.body);
    assert.deepEqual(await opportunities(sceneId), [['Охотница', 'Ведьма', 'mage-slayer']]);
    await effect(witch.id, 'concentration', {source: 'spell', spellName: 'Порча'});
    for (let i = 0; i < 30; i++) {
      if (i === 1) await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'gm_free_move','flag','Свободно','true'::jsonb,$2)`, [campaignId, gm.user.id]);
      const strike = await check(hunter.id, 'attack', sword.id, {targetCharacterId: witch.id, sceneId, ...(i === 0 ? {opportunity: true} : {})}, i === 0 ? alice.token : gm.token);
      if (strike.outcome.hit) break;
    }
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='gm_free_move'`, [campaignId]);
    const save = (await pg.query<any>(`SELECT outcome FROM roll_log WHERE character_id=$1 AND label LIKE 'Концентрация%' ORDER BY created_at DESC LIMIT 1`, [witch.id])).rows[0];
    assert.equal(save?.outcome.advantage, 'disadv', JSON.stringify(save?.outcome));
  });

  await t.test('lucky: against an attack on you when ready; and on a check', async () => {
    const luckyOne = await hero('Счастливчик', 'Плут', 5, {feats: ['lucky']});
    const bandit = await npc('Бандит');
    const knife = await weapon(bandit.id, {name: 'Нож', damageFormula: '1d1'}, gm.token);
    assert.equal((await request('PUT', `${base}/characters/${luckyOne.id}/reactions`, alice.token, {lucky: true})).statusCode, 200);
    const feats = (await request('GET', `${base}/characters/${luckyOne.id}/features`, alice.token)).json().features.find((entry: any) => entry.id === 'feats');
    assert.deepEqual(feats.ready, ['lucky']);
    let stab: any = null;
    for (let i = 0; i < 20 && !(stab?.outcome.reasons ?? []).some((reason: string) => reason.startsWith('везунчик цели')); i++) {
      stab = await check(bandit.id, 'attack', knife.id, {targetCharacterId: luckyOne.id}, gm.token);
    }
    assert.ok(stab.outcome.reasons.some((reason: string) => reason.startsWith('везунчик цели (Счастливчик, осталось 2)')), JSON.stringify(stab.outcome.reasons));
    assert.deepEqual(await resource(luckyOne.id, 'Очки удачи'), {current: 2, max: 3});

    const sneak = await check(luckyOne.id, 'skill', 'stealth', {lucky: true});
    assert.ok(sneak.outcome.reasons.some((reason: string) => reason.startsWith('везунчик (очко удачи, осталось 1): ещё к20')));
    assert.equal(sneak.dice_results.length, 2);
    assert.equal((await resource(luckyOne.id, 'Очки удачи')).current, 1);
  });

  await t.test('stroke of luck on a check: the d20 counts as 20 once per short rest', async () => {
    const master = await hero('Мастер удачи', 'Плут', 20, {}, {dexterity: 10});
    const first = await check(master.id, 'skill', 'acrobatics', {strokeOfLuck: true});
    const natural = first.dice_results[0] === 20;
    if (!natural) {
      assert.ok(first.outcome.reasons.some((reason: string) => /^удача: к20 \d+ → 20$/.test(reason)));
      assert.equal(first.total - first.modifier, 20);
      assert.deepEqual(await resource(master.id, 'Удача'), {current: 0, max: 1});
    }
  });

  await t.test('hide in plain sight: a minute of camouflage, +10 to Stealth until it moves', async () => {
    const ranger = await hero('Тень леса', 'Следопыт', 10, {});
    const sceneId = await scene('Опушка', [[alice.token, ranger.id, 0.5, 0.5]]);
    const before = Number((await pg.query<any>('SELECT world_minutes FROM campaigns WHERE id=$1', [campaignId])).rows[0].world_minutes);
    const hide = await request('POST', `${base}/characters/${ranger.id}/features/hide-in-plain-sight`, alice.token, {sceneId});
    assert.equal(hide.statusCode, 200, hide.body);
    assert.equal(Number((await pg.query<any>('SELECT world_minutes FROM campaigns WHERE id=$1', [campaignId])).rows[0].world_minutes), before + 1);
    assert.ok((await effects(ranger.id)).includes('camouflaged'));
    const sneak = await check(ranger.id, 'skill', 'stealth');
    assert.ok(sneak.outcome.reasons.includes('маскировка +10'));
    assert.equal((await request('POST', `${base}/characters/${ranger.id}/features/hide-in-plain-sight`, alice.token, {sceneId})).statusCode, 400, 'already');
    assert.equal((await walk(sceneId, ranger.id, 2.5, 0.5, alice.token)).statusCode, 200);
    assert.ok(!(await effects(ranger.id)).includes('camouflaged'), 'a step breaks it');
    const wolf = await npc('Волк');
    await request('POST', `${base}/scenes/${sceneId}/objects`, gm.token, {characterId: wolf.id, x: 6.5, z: 0.5});
    await fight(sceneId, [[ranger.id, 20], [wolf.id, 10]]);
    assert.equal((await request('POST', `${base}/characters/${ranger.id}/features/hide-in-plain-sight`, alice.token, {sceneId})).statusCode, 400, 'not in combat');
  });

  await t.test('blindsense: a hidden foe within 10 feet gives no disadvantage', async () => {
    const rogue = await hero('Чуткая', 'Плут', 14, {});
    const novice = await hero('Новичок', 'Плут', 13, {});
    const lurker = await npc('Скрытень');
    await effect(lurker.id, 'hidden', {total: 40});
    const blade = await weapon(rogue.id, {name: 'Клинок', damageFormula: '1d1'});
    const shiv = await weapon(novice.id, {name: 'Заточка', damageFormula: '1d1'});
    const sceneId = await scene('Подвал', [[alice.token, rogue.id, 0.5, 0.5], [alice.token, novice.id, 0.5, 1.5], [gm.token, lurker.id, 1.5, 0.5]]);
    const sensed = await check(rogue.id, 'attack', blade.id, {targetCharacterId: lurker.id, sceneId});
    assert.equal(sensed.outcome.advantage, 'none');
    assert.ok(sensed.outcome.reasons.includes('слепое чувство: спрятавшийся рядом — без помехи'));
    assert.equal((await check(novice.id, 'attack', shiv.id, {targetCharacterId: lurker.id, sceneId})).outcome.advantage, 'disadv', 'before 14th level');
    await effect(rogue.id, 'deafened');
    assert.equal((await check(rogue.id, 'attack', blade.id, {targetCharacterId: lurker.id, sceneId})).outcome.advantage, 'disadv', 'deafened — no blindsense');
  });

  await t.test('beast spells: a druid of 18th level casts in wild shape', async () => {
    const elder = await hero('Старейшина', 'Друид', 18, {});
    const young = await hero('Ученица', 'Друид', 17, {});
    for (const id of [elder.id, young.id]) await effect(id, 'wild_shape', {beastName: 'Медведь'});
    const bloom = await learn(elder.id, 'Цветение', 0);
    const sprout = await learn(young.id, 'Росток', 0);
    assert.equal((await request('POST', `${base}/characters/${elder.id}/spells/${bloom}/cast`, alice.token, {})).statusCode, 201);
    const refused = await request('POST', `${base}/characters/${young.id}/spells/${sprout}/cast`, alice.token, {});
    assert.equal(refused.statusCode, 400);
    assert.match(refused.json().message, /зверином облике/);
  });
});
