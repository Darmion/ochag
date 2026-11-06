import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('breath weapon and level 2–18 features', async t => {
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
  const gm = await register('gm_fourteen'), alice = await register('alice_fourteen');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Fourteen'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const hero = async (name: string, className: string, level: number, race: string | null, extra: any = {}) => {
    const made = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 60, hpCurrent: 60, level, speedFeet: 30, ...extra})).json();
    await pg.query('UPDATE characters SET class_name=$2, sheet_extra=$3::jsonb WHERE id=$1', [made.id, className, JSON.stringify(race ? {info: {race}} : {})]);
    return made;
  };
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 200, hpCurrent: 200, armorClass: 5, speedFeet: 30, ...extra,
  })).json();
  const resource = async (id: string, name: string) => (await pg.query<any>('SELECT current, max, recharge FROM character_resources WHERE character_id=$1 AND name=$2', [id, name])).rows[0] ?? null;
  const hp = async (id: string) => Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current);
  const lastSave = async (id: string) => {
    const row = (await pg.query<any>(`SELECT outcome, total FROM roll_log WHERE character_id=$1 AND outcome->>'kind'='save' ORDER BY created_at DESC LIMIT 1`, [id])).rows[0];
    return {...row, outcome: {...row.outcome, reasons: row.outcome.reasons ?? []}};
  };
  const apply = async (targetId: string, condition: string, save?: {ability: string; dc: number}) => {
    const result = await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [targetId], code: condition, ...(save ? {save} : {})});
    assert.equal(result.statusCode, 200, result.body);
    return result.json().results[0];
  };
  const hurt = async (characterId: string, amount: number, damageType?: string) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: `1d1+${amount - 1}`})).json();
    return (await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId, mode: 'damage', ...(damageType ? {damageType} : {})})).json();
  };
  const check = async (characterId: string, kind: string, key: string, extra: any = {}) => {
    const response = await request('POST', `${base}/rolls/check`, alice.token, {characterId, kind, key, ...extra});
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };
  const features = async (id: string) => (await request('GET', `${base}/characters/${id}/features`, alice.token)).json().features as any[];
  const feature = async (id: string, featureId: string) => (await features(id)).find(entry => entry.id === featureId);
  const scene = async (name: string, members: Array<[string, string, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 24, heightCells: 12})).json().id;
    for (const [token, characterId, x, z] of members) {
      const placed = await request('POST', `${base}/scenes/${sceneId}/objects`, token, {characterId, x, z});
      assert.equal(placed.statusCode, 201, placed.body);
    }
    return sceneId as string;
  };
  const join = async (sceneId: string, characterId: string, score: number) => {
    const id = (await request('POST', `${base}/scenes/${sceneId}/initiative/join`, gm.token, {characterId})).json().id;
    await request('PATCH', `${base}/scenes/${sceneId}/initiative/${id}`, gm.token, {score});
  };

  await t.test('breath weapon: a cone toward the target, one damage roll, a save each, half on success; once per short rest', async () => {
    const drake = await hero('Огнедых', 'Воин', 1, 'Драконорождённый (красный)', {constitution: 14});
    const goblin = await npc('Гоблин', {dexterity: 1});
    const friend = await hero('Друг', 'Воин', 1, null, {dexterity: 1});
    const far = await npc('Дальний', {dexterity: 1});
    const behind = await npc('Сзади', {dexterity: 1});
    const sceneId = await scene('Пещера', [
      [alice.token, drake.id, 0.5, 0.5], [alice.token, friend.id, 1.5, 0.5], [gm.token, goblin.id, 2.5, 0.5],
      [gm.token, far.id, 5.5, 0.5], [gm.token, behind.id, -1.5, 0.5],
    ]);
    const listed = await feature(drake.id, 'breath-weapon');
    assert.equal(listed.use, 'action');
    assert.match(listed.detail, /конус 15 фт\., огонь, 2d6, СЛ 12 ЛОВ/);
    assert.equal(listed.choices.find((choice: any) => choice.active)?.value, 'red');
    assert.ok((await features(drake.id)).some(entry => entry.id === 'draconic-resistance' && /огонь/.test(entry.detail)));

    const breath = await request('POST', `${base}/characters/${drake.id}/breath-weapon`, alice.token, {sceneId, targetId: goblin.id});
    assert.equal(breath.statusCode, 201, breath.body);
    const body = breath.json();
    assert.deepEqual([body.shape, body.dc, body.save, body.damageType, body.formula], ['cone', 12, 'dexterity', 'fire', '2d6']);
    assert.deepEqual(body.targets.map((entry: any) => entry.name).sort(), ['Гоблин', 'Друг'], 'allies in the cone too; not far, not behind, not self');
    for (const entry of body.targets) {
      assert.equal(entry.applied, entry.success ? Math.floor(body.damage / 2) : body.damage, JSON.stringify(entry));
    }
    assert.equal(await hp(goblin.id), 200 - body.targets.find((entry: any) => entry.name === 'Гоблин').applied);
    assert.equal(await hp(far.id), 200);
    assert.deepEqual(await resource(drake.id, 'Оружие дыхания'), {current: 0, max: 1, recharge: 'short'});
    const damageRoll = (await pg.query<any>(`SELECT outcome FROM roll_log WHERE character_id=$1 AND label LIKE 'Оружие дыхания%'`, [drake.id])).rows[0];
    assert.equal(damageRoll.outcome.targets.length, 2, 'the combat summary sees every victim');
    const again = await request('POST', `${base}/characters/${drake.id}/breath-weapon`, alice.token, {sceneId, targetId: goblin.id});
    assert.equal(again.statusCode, 400);
    assert.match(again.json().message, /потрачено — вернётся после короткого отдыха/);
    await request('POST', `${base}/characters/${drake.id}/rest`, alice.token, {kind: 'short'});
    assert.equal((await resource(drake.id, 'Оружие дыхания')).current, 1);

    const blue = await hero('Грозовик', 'Воин', 6, 'Драконорождённый', {constitution: 10});
    const line = await scene('Коридор', [[alice.token, blue.id, 0.5, 5.5], [gm.token, goblin.id, 6.5, 5.5], [gm.token, far.id, 8.5, 5.5]]);
    assert.equal((await feature(blue.id, 'breath-weapon')).reason, 'предок не выбран');
    assert.equal((await request('POST', `${base}/characters/${blue.id}/breath-weapon`, alice.token, {sceneId: line, targetId: goblin.id})).statusCode, 400);
    assert.equal((await request('PUT', `${base}/characters/${blue.id}/dragon-ancestry`, alice.token, {ancestry: 'blue'})).statusCode, 200);
    const bolt = (await request('POST', `${base}/characters/${blue.id}/breath-weapon`, alice.token, {sceneId: line, targetId: goblin.id})).json();
    assert.deepEqual([bolt.shape, bolt.damageType, bolt.formula, bolt.dc], ['line', 'lightning', '3d6', 11]);
    assert.deepEqual(bolt.targets.map((entry: any) => entry.name), ['Гоблин'], '35 feet away is past the 30-foot line');
    assert.equal((await request('POST', `${base}/characters/${friend.id}/breath-weapon`, alice.token, {sceneId, targetId: goblin.id})).statusCode, 400);
    assert.equal((await request('PUT', `${base}/characters/${friend.id}/dragon-ancestry`, alice.token, {ancestry: 'red'})).statusCode, 400);
  });

  await t.test('indomitable and diamond soul: a failed save is rolled again; manual rule — not', async () => {
    const fighter = await hero('Стойкий', 'Воин', 9, null, {constitution: 1});
    assert.equal((await apply(fighter.id, 'poisoned', {ability: 'constitution', dc: 40})).applied, true);
    const first = await lastSave(fighter.id);
    assert.ok(first.outcome.reasons.some((reason: string) => /^упорный: переброс -?\d+ → -?\d+$/.test(reason)), first.outcome.reasons.join('; '));
    assert.equal((await resource(fighter.id, 'Упорный')).current, 0);
    await pg.query('DELETE FROM character_effects WHERE character_id=$1', [fighter.id]);
    await apply(fighter.id, 'poisoned', {ability: 'constitution', dc: 40});
    assert.ok(!(await lastSave(fighter.id)).outcome.reasons.some((reason: string) => reason.startsWith('упорный')), 'spent');
    assert.match((await feature(fighter.id, 'indomitable')).reason, /потрачено/);

    const monk = await hero('Алмаз', 'Монах', 14, null, {charisma: 10});
    const save = await check(monk.id, 'save', 'charisma');
    assert.equal(save.modifier, 5, 'proficiency in every save');
    assert.ok(save.outcome.reasons.includes('владение: алмазная душа'));
    await apply(monk.id, 'charmed', {ability: 'charisma', dc: 40});
    assert.ok((await lastSave(monk.id)).outcome.reasons.some((reason: string) => reason.startsWith('алмазная душа (1 ци): переброс')));
    assert.equal((await resource(monk.id, 'Ци')).current, 13);

    await request('POST', `${base}/rules`, gm.token, {key: 'save_rerolls', kind: 'text', label: 'Переброс', value: 'manual'});
    await pg.query('DELETE FROM character_effects WHERE character_id=$1', [monk.id]);
    await apply(monk.id, 'charmed', {ability: 'charisma', dc: 40});
    assert.ok(!(await lastSave(monk.id)).outcome.reasons.some((reason: string) => reason.startsWith('алмазная душа')));
    assert.equal((await resource(monk.id, 'Ци')).current, 13, 'manual — nothing spent');
    assert.match((await feature(monk.id, 'diamond-soul')).detail, /«Вручную»/);
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='save_rerolls'`, [campaignId]);
  });

  await t.test('fast movement and unarmored movement add speed; heavy armor or armor class with armor — not', async () => {
    const barbarian = await hero('Бегун', 'Варвар', 5, null);
    const monk = await hero('Ветерок', 'Монах', 6, null, {dexterity: 14, wisdom: 14, armorClass: 14});
    const armored = await hero('Латник', 'Монах', 6, null, {dexterity: 14, wisdom: 14, armorClass: 16});
    const heavy = await hero('Тяжёлый', 'Варвар', 5, null);
    assert.equal((await request('POST', `${base}/characters/${heavy.id}/gear`, alice.token, {srdIndex: 'chain-mail'})).statusCode, 201);
    const sceneId = await scene('Луг', [[alice.token, barbarian.id, -11.5, -5.5], [alice.token, monk.id, -11.5, 5.5], [alice.token, armored.id, -9.5, 5.5], [alice.token, heavy.id, -7.5, 5.5]]);
    for (const [id, score] of [[barbarian.id, 20], [monk.id, 15], [armored.id, 10], [heavy.id, 5]] as const) await join(sceneId, id, score);
    const entries = (await request('GET', `${base}/scenes/${sceneId}/initiative`, alice.token)).json().entries;
    const speed = (id: string) => entries.find((entry: any) => entry.character_id === id).speed_feet;
    assert.deepEqual([speed(barbarian.id), speed(monk.id), speed(armored.id), speed(heavy.id)], [40, 45, 30, 30]);
    assert.match((await feature(monk.id, 'unarmored-movement')).detail, /\+15 фт\./);
    await request('POST', `${base}/scenes/${sceneId}/initiative/advance`, gm.token, {});
    const objects = (await request('GET', `${base}/scenes/${sceneId}`, alice.token)).json().objects as any[];
    const own = objects.find((object: any) => object.character_id === barbarian.id);
    const move = (x: number) => request('PUT', `${base}/scenes/${sceneId}/objects/${own.id}`, alice.token, {
      x, y: 0, z: -5.5, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: own.revision,
    });
    const tooFar = await move(-2.5);
    assert.equal(tooFar.statusCode, 400, '45 feet — past 40');
    assert.match(tooFar.json().message, /40/);
    const moved = await move(-3.5);
    assert.equal(moved.statusCode, 200, moved.body);
  });

  await t.test('feral instinct, jack of all trades, remarkable athlete: initiative and checks', async () => {
    const barbarian = await hero('Чуткий', 'Варвар', 7, null, {dexterity: 10});
    const bard = await hero('Мастер', 'Бард', 2, null, {dexterity: 14, wisdom: 10});
    const champion = await hero('Атлет', 'Воин', 7, null, {strength: 10, wisdom: 10});
    const sceneId = await scene('Поляна', [[alice.token, barbarian.id, 0.5, 0.5], [alice.token, bard.id, 2.5, 0.5], [alice.token, champion.id, 4.5, 0.5]]);
    for (const id of [barbarian.id, bard.id, champion.id]) {
      assert.equal((await request('POST', `${base}/scenes/${sceneId}/initiative/join`, alice.token, {characterId: id})).statusCode, 201);
    }
    const initiative = async (id: string) => (await pg.query<any>(`SELECT formula, modifier, dice_results, outcome FROM roll_log WHERE character_id=$1 AND label LIKE 'Инициатива%'`, [id])).rows[0];
    const feral = await initiative(barbarian.id);
    assert.equal(feral.dice_results.length, 2);
    assert.match(feral.formula, /^2d20adv/);
    assert.ok(feral.outcome.reasons.includes('преимущество: дикий инстинкт'));
    assert.equal((await initiative(bard.id)).modifier, 3, 'DEX +2 and half of +2');
    assert.equal((await initiative(champion.id)).modifier, 2, 'half of +3, rounded up');
    const insight = await check(bard.id, 'skill', 'insight');
    assert.equal(insight.modifier, 1);
    assert.ok(insight.outcome.reasons.includes('мастер на все руки +1'));
    assert.equal((await check(champion.id, 'ability', 'strength')).modifier, 2);
    assert.equal((await check(champion.id, 'ability', 'wisdom')).modifier, 0, 'only STR, DEX, CON');
    assert.equal((await check(bard.id, 'save', 'wisdom')).modifier, 0, 'saves are not checks');
  });

  await t.test('slippery mind and elusive', async () => {
    const rogue = await hero('Тень', 'Плут', 18, null, {wisdom: 10});
    assert.equal((await check(rogue.id, 'save', 'wisdom')).modifier, 6);
    const brute = await hero('Громила', 'Воин', 3, null, {strength: 10});
    const club = (await request('POST', `${base}/characters/${brute.id}/weapons`, alice.token, {name: 'Дубина', ability: 'strength', proficient: false, attackBonus: 0, damageFormula: '1d4'})).json();
    await scene('Переулок', [[alice.token, rogue.id, 0.5, 0.5], [alice.token, brute.id, 1.5, 0.5]]);
    await apply(rogue.id, 'prone');
    const swing = await check(brute.id, 'attack', club.id, {targetCharacterId: rogue.id, advantage: 'adv'});
    assert.equal(swing.outcome.advantage, 'none');
    assert.equal(swing.dice_results.length, 1);
    assert.ok(swing.outcome.reasons.includes('без преимущества: неуловимость цели'), swing.outcome.reasons.join('; '));
    await apply(rogue.id, 'stunned');
    const stunned = await check(brute.id, 'attack', club.id, {targetCharacterId: rogue.id});
    assert.equal(stunned.outcome.advantage, 'adv', 'incapacitated — not elusive');
    const young = await hero('Подросток', 'Плут', 14, null, {wisdom: 10});
    assert.equal((await check(young.id, 'save', 'wisdom')).modifier, 0);
  });

  await t.test('race resistances for a sheet from LSS: dwarf poison, tiefling fire, dragonborn by ancestry', async () => {
    const dwarf = await hero('Борин', 'Воин', 3, 'Горный дварф');
    assert.equal((await hurt(dwarf.id, 10, 'poison')).applied, 5);
    const tiefling = await hero('Искра', 'Колдун', 3, 'Тифлинг');
    assert.equal((await hurt(tiefling.id, 10, 'fire')).applied, 5);
    assert.equal((await hurt(tiefling.id, 10, 'cold')).applied, 10);
    const silver = await hero('Иней', 'Воин', 3, 'Драконорождённый (серебряный)');
    assert.equal((await hurt(silver.id, 10, 'cold')).applied, 5);
    assert.ok((await features(tiefling.id)).some(entry => entry.id === 'hellish-resistance'));
  });

  await t.test('song of rest: who spends hit dice on a short rest heals a bard die more', async () => {
    const bard = await hero('Певец', 'Бард', 2, null);
    const tired = await hero('Усталый', 'Воин', 3, null, {hpCurrent: 5, constitution: 10});
    const alone = await hero('Одинокий', 'Воин', 3, null, {hpCurrent: 5, constitution: 10});
    await pg.query('UPDATE characters SET hit_die=10 WHERE id = ANY($1::uuid[])', [[tired.id, alone.id]]);
    const camp = await scene('Привал', [[alice.token, bard.id, 0.5, 0.5], [alice.token, tired.id, 1.5, 0.5]]);
    await scene('Пустошь', [[alice.token, alone.id, 0.5, 0.5]]);
    const rested = await request('POST', `${base}/scenes/${camp}/rest`, gm.token, {kind: 'short'});
    assert.equal(rested.statusCode, 200, rested.body);
    const result = rested.json().results.find((entry: any) => entry.name === 'Усталый');
    assert.ok(result.hitDice.rolls.length > 0);
    assert.equal(result.song.bard, 'Певец');
    assert.ok(result.song.value >= 1 && result.song.value <= 6);
    assert.match(rested.json().summary, /песнь отдыха \(Певец\) \+\d/);
    assert.equal(rested.json().results.find((entry: any) => entry.name === 'Певец').song, undefined, 'full hit points — no dice spent, no song');
    const solo = (await request('POST', `${base}/characters/${alone.id}/rest`, alice.token, {kind: 'short', autoHitDice: true})).json();
    assert.equal(solo.result.song, undefined, 'no bard on that scene');
    await pg.query('UPDATE characters SET hp_current=5, hit_dice_spent=0 WHERE id=$1', [tired.id]);
    await pg.query('UPDATE characters SET hp_current=0 WHERE id=$1', [bard.id]);
    const silent = (await request('POST', `${base}/characters/${tired.id}/rest`, alice.token, {kind: 'short', autoHitDice: true})).json();
    assert.equal(silent.result.song, undefined);
  });

  await t.test('survivor, indomitable might, cleansing touch', async () => {
    const champion = await hero('Ветеран', 'Воин', 18, null, {hpCurrent: 20, constitution: 14});
    const dummy = await npc('Манекен');
    const sceneId = await scene('Арена', [[alice.token, champion.id, 0.5, 0.5], [gm.token, dummy.id, 3.5, 0.5]]);
    await join(sceneId, champion.id, 20);
    await join(sceneId, dummy.id, 10);
    await request('POST', `${base}/scenes/${sceneId}/initiative/advance`, gm.token, {});
    assert.equal(await hp(champion.id), 27, '5 + CON 2 at the start of the turn');
    await request('POST', `${base}/scenes/${sceneId}/initiative/advance`, gm.token, {});
    await request('POST', `${base}/scenes/${sceneId}/initiative/advance`, gm.token, {});
    assert.equal(await hp(champion.id), 34);
    await pg.query('UPDATE characters SET hp_current=31 WHERE id=$1', [champion.id]);
    await request('POST', `${base}/scenes/${sceneId}/initiative/advance`, gm.token, {});
    await request('POST', `${base}/scenes/${sceneId}/initiative/advance`, gm.token, {});
    assert.equal(await hp(champion.id), 31, 'more than half — nothing');

    const mighty = await hero('Силач', 'Варвар', 18, null, {strength: 20});
    for (let i = 0; i < 12; i++) assert.ok((await check(mighty.id, 'ability', 'strength')).total >= 20);
    assert.ok((await check(mighty.id, 'skill', 'athletics')).total >= 20);

    const paladin = await hero('Очиститель', 'Паладин', 14, null, {charisma: 16});
    const ally = await hero('Скованный', 'Воин', 3, null);
    const away = await hero('Далёкий', 'Воин', 3, null);
    await scene('Храм', [[alice.token, paladin.id, 0.5, 0.5], [alice.token, ally.id, 1.5, 0.5], [alice.token, away.id, 8.5, 0.5]]);
    const add = (id: string, code: string, spell: string, spellLevel: number) => pg.query(
      `INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,$3,$4::jsonb)`,
      [campaignId, id, code, JSON.stringify({source: 'spell', sourceName: spell, spellLevel, sourceCharacterId: dummy.id})],
    );
    await add(ally.id, 'paralyzed', 'Удержание личности', 2);
    await add(ally.id, 'blessed', 'Благословение', 5);
    assert.deepEqual(await resource(paladin.id, 'Очищающее касание'), null, 'made on first use');
    const cleansed = await request('POST', `${base}/characters/${paladin.id}/features/cleansing-touch`, alice.token, {targetId: ally.id});
    assert.equal(cleansed.statusCode, 200, cleansed.body);
    assert.match(cleansed.json().message, /«Удержание личности» на «Скованный» больше не действует/);
    const left = (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active', [ally.id])).rows.map(row => row.effect_code);
    assert.deepEqual(left, ['blessed'], 'the harmful spell first');
    assert.deepEqual(await resource(paladin.id, 'Очищающее касание'), {current: 2, max: 3, recharge: 'long'});
    await add(away.id, 'restrained', 'Опутывание', 1);
    const reach = await request('POST', `${base}/characters/${paladin.id}/features/cleansing-touch`, alice.token, {targetId: away.id});
    assert.equal(reach.statusCode, 400);
    assert.match(reach.json().message, /касанием/);
    assert.equal((await request('POST', `${base}/characters/${paladin.id}/features/cleansing-touch`, alice.token, {})).statusCode, 400, 'nothing on self');
  });
});
