import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('class features and bosses', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 100_000});
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

  const gm = await register('gm_features'), alice = await register('alice_features');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Features'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Арена', widthCells: 12, heightCells: 12})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const initiative = `${scenePath}/initiative`;

  const hero = async (name: string, className: string, level: number, extra: any = {}) => {
    const created = (await request('POST', `${base}/characters`, alice.token, {
      kind: 'character', name, strength: 16, dexterity: 16, hpMax: 40, hpCurrent: 40, armorClass: 14, speedFeet: 30, level, ...extra,
    })).json();
    await pg.query('UPDATE characters SET class_name=$2 WHERE id=$1', [created.id, className]);
    return created;
  };
  const grok = await hero('Грок', 'Варвар', 3);
  const bran = await hero('Бран', 'Воин', 2, {hpCurrent: 10});
  const shade = await hero('Тень', 'Плут', 3);
  const ala = await hero('Ала', 'Паладин', 2);
  const goblin = (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 500, hpCurrent: 500, armorClass: 1, speedFeet: 30,
  })).json();
  const skeleton = (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name: 'Скелет', disposition: 'hostile', hpMax: 500, hpCurrent: 500, armorClass: 1, speedFeet: 30,
  })).json();
  await pg.query(`UPDATE characters SET sheet_extra='{"srdMonster":"skeleton"}'::jsonb WHERE id=$1`, [skeleton.id]);
  const dragon = (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name: 'Дракон', disposition: 'hostile', hpMax: 100, hpCurrent: 100, armorClass: 18, speedFeet: 40,
  })).json();

  const place = (characterId: string, x: number, z: number, token = alice.token) => request('POST', `${scenePath}/objects`, token, {characterId, x, z});
  await place(goblin.id, -0.5, -0.5, gm.token);
  await place(shade.id, -1.5, -0.5);
  await place(grok.id, 0.5, -0.5);
  await place(ala.id, -0.5, -1.5);
  await place(bran.id, 3.5, 3.5);
  await place(skeleton.id, 4.5, 3.5, gm.token);
  await place(dragon.id, -5.5, 5.5, gm.token);
  const moveTo = (characterId: string, x: number, z: number) =>
    pg.query('UPDATE scene_objects SET x=$2, z=$3 WHERE character_id=$1', [characterId, x, z]);

  const weapon = async (characterId: string, body: any) => (await request('POST', `${base}/characters/${characterId}/weapons`, alice.token, {damageType: 'slashing', ...body})).json();
  const axe = await weapon(grok.id, {name: 'Секира', ability: 'strength', damageFormula: '1d1+@str'});
  const sword = await weapon(bran.id, {name: 'Меч', ability: 'strength', damageFormula: '1d1'});
  const rapier = await weapon(shade.id, {name: 'Рапира', ability: 'finesse', damageFormula: '1d1', damageType: 'piercing'});
  const club = await weapon(shade.id, {name: 'Дубинка', ability: 'strength', damageFormula: '1d1', damageType: 'bludgeoning'});
  const longsword = await weapon(ala.id, {name: 'Длинный меч', ability: 'strength', damageFormula: '1d1'});
  await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,2,2)`, [campaignId, ala.id]);

  await request('POST', `${initiative}/start`, gm.token, {});
  const entries = async () => (await request('GET', initiative, gm.token)).json().entries;
  const entryOf = async (id: string) => (await entries()).find((entry: any) => entry.character_id === id);
  const turnTo = (id: string) => pg.query(
    `UPDATE initiative_entries SET is_current = (character_id = $2), action_used=false, bonus_used=false, reaction_used=false,
       attacks_made=0, disengaged=false, moved_feet=0, dashes=0, action_surged=false WHERE scene_id=$1`,
    [sceneId, id],
  );
  const freshAction = (id: string) => pg.query('UPDATE initiative_entries SET action_used=false, attacks_made=0 WHERE character_id=$1', [id]);
  const attack = (characterId: string, key: string, targetCharacterId: string, extra: any = {}, token = alice.token) =>
    request('POST', `${base}/rolls/check`, token, {characterId, kind: 'attack', key, targetCharacterId, sceneId, ...extra});
  const hit = async (characterId: string, key: string, targetCharacterId: string, extra: any = {}) => {
    for (let i = 0; i < 30; i++) {
      await freshAction(characterId);
      const response = await attack(characterId, key, targetCharacterId, extra);
      assert.equal(response.statusCode, 201, response.body);
      if (response.json().outcome.hit) return response.json();
    }
    throw new Error('no hit in 30 attacks');
  };
  const hurt = async (characterId: string, amount: number, damageType?: string) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: amount === 1 ? '1d1' : `1d1+${amount - 1}`})).json();
    return (await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId, mode: 'damage', ...(damageType ? {damageType} : {})})).json();
  };
  const feature = (characterId: string, id: string, token = alice.token) =>
    request('POST', `${base}/characters/${characterId}/features/${id}`, token, {sceneId});
  const features = async (characterId: string) => (await request('GET', `${base}/characters/${characterId}/features?sceneId=${sceneId}`, alice.token)).json();
  const effect = async (characterId: string, code: string) =>
    (await pg.query<any>(`SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code=$2`, [characterId, code])).rows[0];
  const resource = async (characterId: string, name: string) =>
    (await pg.query<any>('SELECT current, max FROM character_resources WHERE character_id=$1 AND name=$2', [characterId, name])).rows[0];

  await t.test('features list: what the class has and what can be used now', async () => {
    await turnTo(grok.id);
    const list = await features(grok.id);
    assert.equal(list.className, 'Варвар');
    assert.deepEqual(list.features.map((entry: any) => [entry.id, entry.available]), [['rage', true], ['reckless-attack', true], ['danger-sense', true], ['frenzy', false], ['unarmored-defense', true], ['feats', true]]);
    assert.equal(list.features[0].detail, '+2 к урону');
    assert.match(list.features.find((entry: any) => entry.id === 'unarmored-defense').detail, /^без доспехов КД \d+ = 10 \+ ЛОВ \+ ТЕЛ \(\+2 со щитом\)$/);
    assert.deepEqual(list.features[0].resource, {name: 'Ярость', current: 3, max: 3}, 'missing resources come from the class table');
    assert.deepEqual((await features(shade.id)).features.map((entry: any) => [entry.id, entry.available, entry.detail]), [
      ['cunning-action', false, 'Рывок, Отход, Спрятаться'], ['sneak-attack', true, '2d6'], ['feats', true, 'не отмечены'],
    ]);
    assert.equal((await request('GET', `${base}/characters/${grok.id}/features`, gm.token)).statusCode, 200);
  });

  await t.test('rage: a bonus action, a use, resistance, +2 damage, Strength advantage, no spells; ends at 0 hit points', async () => {
    await turnTo(grok.id);
    const rage = await feature(grok.id, 'rage');
    assert.equal(rage.statusCode, 200, rage.body);
    assert.match(rage.json().message, /впадает в ярость: \+2 к урону/);
    assert.deepEqual(await resource(grok.id, 'Ярость'), {current: 2, max: 3});
    assert.deepEqual((await effect(grok.id, 'raging')).parameters, {source: 'rage', remainingRounds: 10, damageBonus: 2, kept: true});
    assert.equal((await entryOf(grok.id)).bonus_used, true);
    assert.match((await feature(grok.id, 'rage')).json().message, /уже в ярости/);

    const slashed = await hurt(grok.id, 10, 'slashing');
    assert.deepEqual([slashed.applied, slashed.modified], [5, 'resisted']);
    assert.equal((await hurt(grok.id, 4, 'fire')).applied, 4, 'fire is not resisted');

    const swing = await hit(grok.id, axe.id, goblin.id);
    assert.equal(swing.damage.roll.total, swing.damage.critical ? 7 : 6, '1 (+1 on a crit) + STR 3 + rage 2');
    assert.match(swing.damage.roll.formula, /\+3\+2$/);
    assert.match(swing.damage.roll.label, /\(ярость\)/);

    const save = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: grok.id, kind: 'save', key: 'strength'})).json();
    assert.ok(save.outcome.reasons.includes('преимущество: ярость'), JSON.stringify(save.outcome));
    assert.match((await request('POST', `${base}/characters/${grok.id}/spells/${randomUUID()}/cast`, alice.token, {})).json().message, /в ярости нельзя сотворять/);

    assert.equal((await feature(grok.id, 'end-rage')).statusCode, 200);
    assert.equal(await effect(grok.id, 'raging'), undefined);
    assert.match((await feature(grok.id, 'end-rage')).json().message, /не в ярости/);
    await turnTo(grok.id);
    assert.equal((await feature(grok.id, 'rage')).statusCode, 200);
    await hurt(grok.id, 200);
    assert.equal(await effect(grok.id, 'raging'), undefined, 'rage ends when the barbarian drops');
    await pg.query(`UPDATE characters SET hp_current=40 WHERE id=$1`, [grok.id]);
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [grok.id]);
    assert.match((await feature(bran.id, 'rage')).json().message, /«Ярость» — умение класса «Варвар» с 1-го уровня; у «Бран» его нет/);
  });

  await t.test('second wind heals 1d10 + level once per short rest; action surge gives one more action, once a turn', async () => {
    await turnTo(bran.id);
    const wind = await feature(bran.id, 'second-wind');
    assert.equal(wind.statusCode, 200, wind.body);
    assert.ok(wind.json().healed >= 3 && wind.json().healed <= 12, wind.body);
    const hp = (await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [bran.id])).rows[0].hp_current;
    assert.equal(hp, 10 + wind.json().healed);
    assert.match((await feature(bran.id, 'second-wind')).json().message, /бонусное действие в этот ход уже потрачено/);
    await turnTo(bran.id);
    assert.match((await feature(bran.id, 'second-wind')).json().message, /потрачено — восстановится после короткого отдыха/);

    await moveTo(bran.id, -0.5, 0.5);
    await turnTo(bran.id);
    assert.equal((await attack(bran.id, sword.id, goblin.id)).statusCode, 201);
    assert.match((await attack(bran.id, sword.id, goblin.id)).json().message, /атаки действия «Атака» в этот ход сделаны/);
    const surge = await feature(bran.id, 'action-surge');
    assert.equal(surge.statusCode, 200, surge.body);
    assert.equal((await attack(bran.id, sword.id, goblin.id)).statusCode, 201, 'the surge gave the action back');
    assert.match((await feature(bran.id, 'action-surge')).json().message, /не больше раза за ход/);
    await turnTo(goblin.id);
    assert.match((await feature(bran.id, 'action-surge')).json().message, /в свой ход/);
    await moveTo(bran.id, 3.5, 3.5);
  });

  await t.test('sneak attack: an ally by the target or advantage, a finesse weapon, once a turn', async () => {
    await turnTo(shade.id);
    const first = await hit(shade.id, rapier.id, goblin.id);
    assert.deepEqual(first.outcome.sneakAttack, {dice: '2d6', reason: 'союзник рядом с целью'});
    assert.match(first.damage.roll.formula, first.damage.critical ? /\+4d6$/ : /\+2d6$/);
    assert.match(first.damage.roll.label, /скрытая атака/);
    assert.equal(first.damage.roll.dice_results.length, first.damage.critical ? 6 : 3);
    assert.equal((await entryOf(shade.id)).sneak_attack_used, true);

    const second = await hit(shade.id, rapier.id, goblin.id);
    assert.equal(second.outcome.sneakAttack, undefined, 'once a turn');

    await request('POST', `${initiative}/advance`, gm.token);
    assert.ok((await entries()).every((entry: any) => entry.sneak_attack_used === false));

    await turnTo(shade.id);
    await moveTo(grok.id, 2.5, 2.5);
    await moveTo(ala.id, 2.5, 3.5);
    const alone = await hit(shade.id, rapier.id, goblin.id);
    assert.equal(alone.outcome.sneakAttack, undefined, 'no ally by the target, no advantage');
    const sneaky = await hit(shade.id, rapier.id, goblin.id, {advantage: 'adv'});
    assert.deepEqual(sneaky.outcome.sneakAttack, {dice: '2d6', reason: 'преимущество'});
    await pg.query('UPDATE initiative_entries SET sneak_attack_used=false WHERE character_id=$1', [shade.id]);
    const blunt = await hit(shade.id, club.id, goblin.id, {advantage: 'adv'});
    assert.equal(blunt.outcome.sneakAttack, undefined, 'a club is neither finesse nor ranged');
    await moveTo(grok.id, 0.5, -0.5);
    await moveTo(ala.id, -0.5, -1.5);
  });

  await t.test('divine smite: after a melee hit, a slot for 2d8 radiant (+1d8 undead), once a hit, right after it', async () => {
    await turnTo(ala.id);
    const swing = await hit(ala.id, longsword.id, goblin.id);
    assert.deepEqual(swing.smite.slots, [{level: 1, current: 2}]);
    assert.equal(swing.smite.targetName, 'Гоблин');
    const before = (await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [goblin.id])).rows[0].hp_current;
    const smite = await request('POST', `${base}/rolls/${swing.id}/smite`, alice.token, {slotLevel: 1});
    assert.equal(smite.statusCode, 201, smite.body);
    assert.equal(smite.json().roll.formula, swing.outcome.critical ? '4d8' : '2d8');
    assert.equal(smite.json().roll.outcome.damageType, 'radiant');
    assert.equal(smite.json().roll.label, 'Божественная кара → Гоблин');
    const after = (await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [goblin.id])).rows[0].hp_current;
    assert.equal(before - after, smite.json().applied);
    assert.equal((await pg.query<any>('SELECT current FROM character_spell_slots WHERE character_id=$1 AND level=1', [ala.id])).rows[0].current, 1);
    assert.match((await request('POST', `${base}/rolls/${swing.id}/smite`, alice.token, {slotLevel: 1})).json().message, /уже была/);

    const next = await hit(ala.id, longsword.id, goblin.id);
    assert.match((await request('POST', `${base}/rolls/${swing.id}/smite`, alice.token, {slotLevel: 1})).json().message, /другая атака/);
    assert.match((await request('POST', `${base}/rolls/${next.id}/smite`, alice.token, {slotLevel: 2})).json().message, /Ячеек 2-го уровня не осталось/);

    await moveTo(skeleton.id, -1.5, -1.5);
    const bones = await hit(ala.id, longsword.id, skeleton.id);
    const holy = (await request('POST', `${base}/rolls/${bones.id}/smite`, alice.token, {slotLevel: 1})).json();
    assert.equal(holy.roll.formula, bones.outcome.critical ? '6d8' : '3d8', 'undead take 1d8 more');
    assert.equal(holy.undead, true);
    assert.equal((await hit(ala.id, longsword.id, skeleton.id)).smite, undefined, 'no slots — no offer');

    const save = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: ala.id, kind: 'save', key: 'strength'})).json();
    assert.match((await request('POST', `${base}/rolls/${save.id}/smite`, alice.token, {slotLevel: 1})).json().message, /после атаки по цели/);
    await turnTo(shade.id);
    const stab = await hit(shade.id, rapier.id, goblin.id);
    assert.equal(stab.smite, undefined);
    assert.match((await request('POST', `${base}/rolls/${stab.id}/smite`, alice.token, {slotLevel: 1})).json().message, /«Божественная кара» — умение класса «Паладин»/);
  });

  await t.test('boss: the GM sets legendary actions and phases; spends them between turns; phases fire once', async () => {
    const bossPath = `${base}/characters/${dragon.id}/boss`;
    const settings = {
      legendaryActions: 3,
      options: [{name: 'Обнаружение', cost: 1, text: 'Проверка Мудрости (Восприятие).'}, {name: 'Удар хвостом', cost: 1}, {name: 'Взмах крыльев', cost: 2, text: 'Сбивает с ног.'}],
      phases: [
        {atPercent: 25, title: 'Последний рубеж', text: 'Дракон зовёт на помощь.', public: false},
        {atPercent: 50, title: 'Ярость дракона', text: 'Чешуя раскаляется!'},
      ],
    };
    assert.equal((await request('PUT', bossPath, alice.token, settings)).statusCode, 403);
    assert.equal((await request('GET', bossPath, alice.token)).statusCode, 403, 'players do not see the boss plan');
    assert.match((await request('PUT', bossPath, gm.token, {...settings, legendaryActions: 1})).json().message, /«Взмах крыльев» стоит 2, а за раунд всего 1/);
    assert.match((await request('PUT', `${base}/characters/${grok.id}/boss`, gm.token, settings)).json().message, /только НПС/);
    const saved = await request('PUT', bossPath, gm.token, settings);
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json().phases.map((phase: any) => [phase.atPercent, phase.public, phase.done]), [[50, true, false], [25, false, false]], 'top phase first');
    assert.equal((await request('GET', bossPath, gm.token)).json().options.length, 3);

    const dragonEntry = await entryOf(dragon.id);
    assert.deepEqual([dragonEntry.legendary_actions, dragonEntry.legendary_used], [3, 0]);
    const legendary = (option: number, token = gm.token) => request('POST', `${initiative}/${dragonEntry.id}/legendary`, token, {option});
    await turnTo(shade.id);
    assert.equal((await legendary(0, alice.token)).statusCode, 403);
    const wings = await legendary(2);
    assert.equal(wings.statusCode, 200, wings.body);
    assert.deepEqual([wings.json().used, wings.json().left], [2, 1]);
    assert.match((await legendary(2)).json().message, /осталось 1 из 3 легендарных действий, а «Взмах крыльев» стоит 2/);
    assert.equal((await legendary(1)).json().left, 0);
    const chat = (await request('GET', `${base}/chat`, alice.token)).json().messages;
    assert.ok(chat.some((message: any) => message.body === 'Легендарное действие: Взмах крыльев (стоит 2) — Сбивает с ног.' && message.character_id === dragon.id), JSON.stringify(chat.slice(-2)));

    await turnTo(dragon.id);
    assert.match((await legendary(0)).json().message, /не в свой ход/);
    await pg.query('UPDATE initiative_entries SET legendary_used=3 WHERE id=$1', [dragonEntry.id]);
    for (let i = 0; i < 10 && !(await entryOf(dragon.id)).is_current; i++) await request('POST', `${initiative}/advance`, gm.token);
    await turnTo(shade.id);
    await request('POST', `${initiative}/advance`, gm.token);
    for (let i = 0; i < 10 && !(await entryOf(dragon.id)).is_current; i++) await request('POST', `${initiative}/advance`, gm.token);
    assert.equal((await entryOf(dragon.id)).legendary_used, 0);

    assert.deepEqual((await hurt(dragon.id, 49)).notices, []);
    const half = await hurt(dragon.id, 1);
    assert.deepEqual(half.notices.map((notice: any) => [notice.title, notice.detail, notice.secret]), [['Дракон: Ярость дракона', 'Чешуя раскаляется!', false]]);
    assert.deepEqual((await hurt(dragon.id, 5)).notices, [], 'once');
    const last = await hurt(dragon.id, 25);
    assert.deepEqual(last.notices.map((notice: any) => [notice.title, notice.secret]), [['Дракон: Последний рубеж', true]]);
    assert.deepEqual((await request('GET', bossPath, gm.token)).json().phases.map((phase: any) => phase.done), [true, true]);

    const copy = (await request('POST', `${base}/characters/${dragon.id}/duplicate`, gm.token, {count: 1})).json().characters[0];
    const copied = (await request('GET', `${base}/characters/${copy.id}/boss`, gm.token)).json();
    assert.deepEqual([copied.legendaryActions, copied.options.length, copied.phases.map((phase: any) => phase.done)], [3, 3, [false, false]]);
  });
});
