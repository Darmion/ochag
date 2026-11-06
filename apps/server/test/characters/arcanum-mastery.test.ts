import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('feral senses, arcanum, spell mastery, signature spells, mage slayer, elemental adept', async t => {
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
  const gm = await register('gm_arcanum'), alice = await register('alice_arcanum');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Arcanum'})).json().id;
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
  const scene = async (name: string, members: Array<[string, string, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 24, heightCells: 12})).json().id;
    for (const [token, characterId, x, z] of members) {
      const placed = await request('POST', `${base}/scenes/${sceneId}/objects`, token, {characterId, x, z});
      assert.equal(placed.statusCode, 201, placed.body);
    }
    return sceneId as string;
  };
  const walk = async (sceneId: string, characterId: string, x: number, z: number, token: string) => {
    const object = (await request('GET', `${base}/scenes/${sceneId}`, gm.token)).json().objects.find((entry: any) => entry.character_id === characterId);
    return request('PUT', `${base}/scenes/${sceneId}/objects/${object.id}`, token, {
      x, y: object.y, z, rotationY: object.rotation_y, scale: object.scale, snapToGrid: object.snap_to_grid, parentObjectId: null, animationName: object.animation_name, revision: object.revision,
    });
  };
  const resource = async (id: string, name: string) => (await pg.query<any>('SELECT current, max, recharge FROM character_resources WHERE character_id=$1 AND name=$2', [id, name])).rows[0] ?? null;
  const effect = (id: string, code: string, parameters: any = {}) => pg.query(
    `INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,$3,$4::jsonb)`, [campaignId, id, code, JSON.stringify(parameters)],
  );
  const learn = async (characterId: string, name: string, level: number, mechanics: Record<string, unknown> = {}) => {
    const columns = Object.keys(mechanics);
    const spellId = (await pg.query<any>(
      `INSERT INTO campaign_spells (campaign_id, created_by, name, level, school, status, range${columns.map(column => `, ${column}`).join('')})
       VALUES ($1,$2,$3,$4,'Conjuration','approved','60 feet'${columns.map((_, index) => `, $${index + 5}`).join('')}) RETURNING id`,
      [campaignId, alice.user.id, name, level, ...Object.values(mechanics)],
    )).rows[0].id;
    const entry = await request('POST', `${base}/characters/${characterId}/spells`, alice.token, {source: 'custom', customSpellId: spellId});
    assert.equal(entry.statusCode, 201, entry.body);
    return entry.json().id as string;
  };
  const cast = (characterId: string, entry: string, body: any = {}) => request('POST', `${base}/characters/${characterId}/spells/${entry}/cast`, alice.token, body);
  const lastSave = async (characterId: string) => (await pg.query<any>(
    `SELECT outcome FROM roll_log WHERE character_id=$1 AND label LIKE 'Спасбросок%' ORDER BY created_at DESC LIMIT 1`, [characterId],
  )).rows[0]!.outcome;
  const hp = async (id: string) => Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current);
  const feature = async (characterId: string, id: string) => (await request('GET', `${base}/characters/${characterId}/features`, alice.token)).json().features.find((entry: any) => entry.id === id);

  await t.test('feral senses: an invisible target or own blindness gives no disadvantage', async () => {
    const tracker = await hero('Зверолов', 'Следопыт', 18, {});
    const novice = await hero('Ученик', 'Следопыт', 17, {});
    const ghost = await npc('Призрак');
    await effect(ghost.id, 'invisible');
    const bow = await weapon(tracker.id, {name: 'Лук', damageFormula: '1d1'});
    const sling = await weapon(novice.id, {name: 'Праща', damageFormula: '1d1'});
    const shot = await check(tracker.id, 'attack', bow.id, {targetCharacterId: ghost.id});
    assert.equal(shot.outcome.advantage, 'none');
    assert.ok(shot.outcome.reasons.includes('дикие чувства: невидимое — без помехи'), JSON.stringify(shot.outcome.reasons));
    assert.equal((await check(novice.id, 'attack', sling.id, {targetCharacterId: ghost.id})).outcome.advantage, 'disadv', 'before 18th level');
    const plain = await npc('Пугало');
    assert.equal(((await check(tracker.id, 'attack', bow.id, {targetCharacterId: plain.id})).outcome.reasons ?? []).includes('дикие чувства: невидимое — без помехи'), false, 'nothing to ignore — no note');
    await effect(tracker.id, 'blinded');
    assert.notEqual((await check(tracker.id, 'attack', bow.id, {targetCharacterId: plain.id})).outcome.advantage, 'disadv', 'blinded — still no disadvantage');
  });

  await t.test('mystic arcanum: a 6th-level spell without a slot once per long rest; 7th from the 13th level', async () => {
    const warlock = await hero('Тёмный', 'Колдун', 11, {}, {charisma: 18});
    const sixth = await learn(warlock.id, 'Тёмный зов', 6);
    const seventh = await learn(warlock.id, 'Бездна', 7);
    assert.match((await cast(warlock.id, sixth)).json().message, /ячеек 6 уровня/, 'no 6th-level slots');
    const done = await cast(warlock.id, sixth, {free: 'arcanum'});
    assert.equal(done.statusCode, 201, done.body);
    assert.deepEqual(done.json().free, {kind: 'arcanum', label: 'мистический арканум', left: 0});
    assert.deepEqual(await resource(warlock.id, 'Мистический арканум: 6 ур.'), {current: 0, max: 1, recharge: 'long'});
    assert.match((await cast(warlock.id, sixth, {free: 'arcanum'})).json().message, /после долгого отдыха/);
    assert.match((await cast(warlock.id, seventh, {free: 'arcanum'})).json().message, /заклинания 6 уровня/);
    assert.equal((await cast(warlock.id, sixth, {free: 'arcanum', slotLevel: 7})).statusCode, 400);
    const view = await feature(warlock.id, 'mystic-arcanum');
    assert.deepEqual(view.choices, [{value: '6', label: '6 ур.', count: 0}]);
    await request('POST', `${base}/characters/${warlock.id}/rest`, alice.token, {kind: 'long'});
    assert.equal((await resource(warlock.id, 'Мистический арканум: 6 ур.')).current, 1);
    await pg.query('UPDATE characters SET level=13 WHERE id=$1', [warlock.id]);
    assert.equal((await cast(warlock.id, seventh, {free: 'arcanum'})).statusCode, 201);
    const wizard = await hero('Книжник', 'Волшебник', 17, {});
    const wish = await learn(wizard.id, 'Желание', 6);
    assert.match((await cast(wizard.id, wish, {free: 'arcanum'})).json().message, /у колдуна с 11-го уровня/);
  });

  await t.test('spell mastery: chosen 1st and 2nd level spells at will; signature spells: two 3rd, each once per short rest', async () => {
    const wizard = await hero('Архимаг', 'Волшебник', 20, {}, {intelligence: 20});
    const spark = await learn(wizard.id, 'Искра', 1);
    const glint = await learn(wizard.id, 'Блик', 1);
    const flash = await learn(wizard.id, 'Вспышка', 2);
    const thunder = await learn(wizard.id, 'Гром', 3);
    const storm = await learn(wizard.id, 'Буря', 3);
    const gale = await learn(wizard.id, 'Шквал', 3);
    await pg.query('DELETE FROM character_spell_slots WHERE character_id=$1', [wizard.id]);
    const pick = (path: string, body: any) => request('PUT', `${base}/characters/${wizard.id}/${path}`, alice.token, body);

    assert.equal((await pick('spell-mastery', {[thunder]: true})).statusCode, 400, 'only 1st and 2nd level');
    assert.deepEqual((await pick('spell-mastery', {[spark]: true, [flash]: true})).json(), {mastery: [spark, flash]});
    assert.deepEqual((await pick('spell-mastery', {[glint]: true})).json(), {mastery: [flash, glint]}, 'a new 1st-level pick replaces the old one');
    assert.match((await cast(wizard.id, spark, {free: 'mastery'})).json().message, /не выбрано/);
    for (let i = 0; i < 3; i++) assert.equal((await cast(wizard.id, glint, {free: 'mastery'})).statusCode, 201, 'at will');
    assert.equal((await cast(wizard.id, glint, {free: 'mastery', slotLevel: 2})).statusCode, 400, 'only at its own level');
    const mastery = await feature(wizard.id, 'spell-mastery');
    assert.deepEqual(mastery.choices.filter((choice: any) => choice.active).map((choice: any) => choice.label), ['Блик', 'Вспышка']);

    assert.equal((await pick('signature-spells', {[flash]: true})).statusCode, 400, 'only 3rd level');
    assert.deepEqual((await pick('signature-spells', {[thunder]: true, [storm]: true})).json(), {signature: [thunder, storm]});
    assert.match((await pick('signature-spells', {[gale]: true})).json().message, /два/);
    const once = await cast(wizard.id, thunder, {free: 'signature'});
    assert.equal(once.statusCode, 201, once.body);
    assert.deepEqual(await resource(wizard.id, 'Фирменное: Гром'), {current: 0, max: 1, recharge: 'short'});
    assert.match((await cast(wizard.id, thunder, {free: 'signature'})).json().message, /после короткого отдыха/);
    assert.equal((await cast(wizard.id, storm, {free: 'signature'})).statusCode, 201, 'each has its own charge');
    const signature = await feature(wizard.id, 'signature-spells');
    assert.deepEqual(signature.choices.filter((choice: any) => choice.active).map((choice: any) => [choice.label, choice.count]), [['Буря', 0], ['Гром', 0]]);
    await request('POST', `${base}/characters/${wizard.id}/rest`, alice.token, {kind: 'short', hitDice: 0});
    assert.equal((await cast(wizard.id, thunder, {free: 'signature'})).statusCode, 201, 'back after a short rest');

    const apprentice = await hero('Подмастерье', 'Волшебник', 17, {});
    const bolt = await learn(apprentice.id, 'Стрела', 1);
    assert.equal((await request('PUT', `${base}/characters/${apprentice.id}/spell-mastery`, alice.token, {[bolt]: true})).statusCode, 400, 'from 18th level');
  });

  await t.test('sorcerous restoration: a short rest gives back 4 sorcery points', async () => {
    const sorcerer = await hero('Искрящая', 'Чародей', 20, {});
    await feature(sorcerer.id, 'metamagic');
    const updated = await pg.query(`UPDATE character_resources SET current=0 WHERE character_id=$1 AND name='Очки чародейства'`, [sorcerer.id]);
    if (!updated.rowCount) {
      await pg.query(`INSERT INTO character_resources (campaign_id, character_id, name, current, max, recharge) VALUES ($1,$2,'Очки чародейства',0,20,'long')`, [campaignId, sorcerer.id]);
    }
    await request('POST', `${base}/characters/${sorcerer.id}/rest`, alice.token, {kind: 'short', hitDice: 0});
    assert.equal((await resource(sorcerer.id, 'Очки чародейства')).current, 4);
    const young = await hero('Искорка', 'Чародей', 19, {});
    await pg.query(`INSERT INTO character_resources (campaign_id, character_id, name, current, max, recharge) VALUES ($1,$2,'Очки чародейства',0,19,'long')
      ON CONFLICT DO NOTHING`, [campaignId, young.id]);
    await pg.query(`UPDATE character_resources SET current=0 WHERE character_id=$1 AND name='Очки чародейства'`, [young.id]);
    await request('POST', `${base}/characters/${young.id}/rest`, alice.token, {kind: 'short', hitDice: 0});
    assert.equal((await resource(young.id, 'Очки чародейства')).current, 0, 'from 20th level');
  });

  await t.test('mage slayer: advantage on saves against a caster within 5 feet; shield master: +2 to a lone DEX save', async () => {
    const mage = await hero('Колдунья', 'Волшебник', 5, {}, {intelligence: 16});
    await pg.query('UPDATE characters SET spell_save_dc_override=15 WHERE id=$1', [mage.id]);
    const slayer = await hero('Ловец магов', 'Воин', 5, {feats: ['mage-slayer', 'shield-master']}, {dexterity: 10});
    const friend = await hero('Напарник', 'Воин', 5, {}, {dexterity: 10});
    const spit = await learn(mage.id, 'Огненный плевок', 0, {save_ability: 'dexterity', damage_formula: '1d1', damage_type: 'fire'});
    const sceneId = await scene('Арена', [[alice.token, mage.id, 0.5, 0.5], [alice.token, slayer.id, 1.5, 0.5], [alice.token, friend.id, 1.5, 1.5]]);
    const at = (targetIds: string[]) => cast(mage.id, spit, {sceneId, targetIds});
    const first = await at([slayer.id]);
    assert.equal(first.statusCode, 201, first.body);
    let save = await lastSave(slayer.id);
    assert.equal(save.advantage, 'adv');
    assert.ok(!(save.reasons ?? []).includes('мастер щита (+2 к спасброску ЛОВ)'), 'no shield in hand');

    const shield = (await request('POST', `${base}/characters`, alice.token, {kind: 'object', name: 'Щит'})).json();
    await pg.query('UPDATE characters SET container_id=$2 WHERE id=$1', [shield.id, slayer.id]);
    assert.equal((await at([slayer.id])).statusCode, 201);
    save = await lastSave(slayer.id);
    assert.ok(save.reasons.includes('мастер щита (+2 к спасброску ЛОВ)'), JSON.stringify(save.reasons));
    assert.equal((await at([slayer.id, friend.id])).statusCode, 201);
    assert.ok(!((await lastSave(slayer.id)).reasons ?? []).includes('мастер щита (+2 к спасброску ЛОВ)'), 'not the only target');

    assert.equal((await walk(sceneId, slayer.id, 6.5, 0.5, alice.token)).statusCode, 200);
    assert.equal((await at([slayer.id])).statusCode, 201);
    assert.equal((await lastSave(slayer.id)).advantage, 'none', 'the caster is far');
  });

  await t.test('elemental adept: ones count as twos and resistance does not help', async () => {
    const adept = await hero('Пиромант', 'Волшебник', 5, {feats: ['elemental-adept-fire']}, {intelligence: 16});
    const plain = await hero('Поджигатель', 'Волшебник', 5, {}, {intelligence: 16});
    await pg.query('UPDATE characters SET spell_save_dc_override=40 WHERE id = ANY($1::uuid[])', [[adept.id, plain.id]]);
    const salamander = await npc('Саламандра', {dexterity: 1});
    await pg.query(`UPDATE characters SET damage_resistances='["fire"]'::jsonb WHERE id=$1`, [salamander.id]);
    const mechanics = {save_ability: 'dexterity', damage_formula: '4d1', damage_type: 'fire'};
    const burst = await learn(adept.id, 'Жар', 0, mechanics);
    const plainBurst = await learn(plain.id, 'Жар', 0, mechanics);
    let before = await hp(salamander.id);
    const done = await cast(adept.id, burst, {targetIds: [salamander.id]});
    assert.equal(done.statusCode, 201, done.body);
    assert.deepEqual(done.json().elementalAdept, {damageType: 'fire', raised: 4});
    assert.equal(before - await hp(salamander.id), 8, '4 × 2, not halved');
    before = await hp(salamander.id);
    assert.equal((await cast(plain.id, plainBurst, {targetIds: [salamander.id]})).statusCode, 201);
    assert.equal(before - await hp(salamander.id), 2, '4 halved by resistance');
  });

  await t.test('cleansing touch: the chosen spell is ended', async () => {
    const paladin = await hero('Светлая', 'Паладин', 14, {}, {charisma: 16});
    const caster = await npc('Ведьма');
    const add = (code: string, spell: string, spellLevel: number) => effect(paladin.id, code, {source: 'spell', sourceName: spell, spellLevel, sourceCharacterId: caster.id});
    await add('frightened', 'Ужас', 3);
    await add('blessed', 'Благословение', 1);
    const list = (await request('GET', `${base}/characters/${paladin.id}/cleansing-touch`, alice.token)).json().spells;
    assert.deepEqual(list.map((spell: any) => [spell.label, spell.level, spell.harmful]), [['Ужас', 3, true], ['Благословение', 1, false]]);
    const done = await request('POST', `${base}/characters/${paladin.id}/features/cleansing-touch`, alice.token, {spell: list[1].value});
    assert.equal(done.statusCode, 200, done.body);
    assert.match(done.json().message, /«Благословение» на «Светлая» больше не действует/);
    const left = (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active', [paladin.id])).rows.map(row => row.effect_code);
    assert.deepEqual(left, ['frightened']);
    assert.equal((await request('POST', `${base}/characters/${paladin.id}/features/cleansing-touch`, alice.token, {spell: list[1].value})).statusCode, 400, 'already gone');
  });
});
