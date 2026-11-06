import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('feats and fighting styles', async t => {
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
  const gm = await register('gm_feats'), alice = await register('alice_feats');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Feats'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const hero = async (name: string, className: string, level: number, sheetExtra: any = {}, extra: any = {}) => {
    const made = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 60, hpCurrent: 60, level, speedFeet: 30, ...extra})).json();
    await pg.query('UPDATE characters SET class_name=$2, sheet_extra=$3::jsonb WHERE id=$1', [made.id, className, JSON.stringify(sheetExtra)]);
    return made;
  };
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 100000, hpCurrent: 100000, armorClass: 1, speedFeet: 30, ...extra,
  })).json();
  const weapon = async (characterId: string, body: any) => {
    const made = await request('POST', `${base}/characters/${characterId}/weapons`, alice.token, {ability: 'strength', proficient: false, attackBonus: 20, ...body});
    assert.equal(made.statusCode, 201, made.body);
    return made.json();
  };
  const check = async (characterId: string, kind: string, key: string, extra: any = {}) => {
    const response = await request('POST', `${base}/rolls/check`, alice.token, {characterId, kind, key, ...extra});
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };
  const hit = async (characterId: string, key: string, targetId: string, extra: any = {}) => {
    for (let i = 0; i < 30; i++) {
      const attack = await check(characterId, 'attack', key, {targetCharacterId: targetId, ...extra});
      if (attack.outcome.hit) return attack;
    }
    throw new Error('no hit in 30 attacks');
  };
  const lastSave = async (id: string) => {
    const row = (await pg.query<any>(`SELECT outcome FROM roll_log WHERE character_id=$1 AND outcome->>'kind'='save' ORDER BY created_at DESC LIMIT 1`, [id])).rows[0];
    return {...row, outcome: {...row.outcome, reasons: row.outcome.reasons ?? []}};
  };
  const features = async (id: string) => (await request('GET', `${base}/characters/${id}/features`, alice.token)).json().features as any[];
  const scene = async (name: string, members: Array<[string, string, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 24, heightCells: 12})).json().id;
    for (const [token, characterId, x, z] of members) await request('POST', `${base}/scenes/${sceneId}/objects`, token, {characterId, x, z});
    return sceneId as string;
  };

  await t.test('marks in «Умения»: feats and styles found in the text, then checked by hand', async () => {
    const fighter = await hero('Отмеченный', 'Воин', 4, {text: {levels: {value: 'Уровень 4. Черта: Настороженный; Боевой стиль: Стрельба — +2'}}});
    const list = await features(fighter.id);
    const feats = list.find(entry => entry.id === 'feats');
    assert.equal(feats.detail, 'Настороженный');
    assert.ok(feats.choices.find((choice: any) => choice.value === 'alert').active);
    assert.equal(list.find(entry => entry.id === 'fighting-styles').detail, 'Стрельба');
    const marked = await request('PUT', `${base}/characters/${fighter.id}/feats`, alice.token, {mobile: true});
    assert.deepEqual(marked.json(), {feats: ['alert', 'mobile']}, 'the text is the starting point');
    assert.deepEqual((await request('PUT', `${base}/characters/${fighter.id}/feats`, alice.token, {alert: false})).json(), {feats: ['mobile']});
    assert.equal((await request('PUT', `${base}/characters/${fighter.id}/fighting-styles`, alice.token, {nonsense: true})).statusCode, 400);
    assert.deepEqual((await request('PUT', `${base}/characters/${fighter.id}/fighting-styles`, alice.token, {dueling: true})).json(), {fightingStyles: ['archery', 'dueling']});
    const wizard = await hero('Учёный', 'Волшебник', 3);
    assert.equal((await features(wizard.id)).some(entry => entry.id === 'fighting-styles'), false, 'no style for a wizard');
    assert.equal((await features(wizard.id)).find(entry => entry.id === 'feats').detail, 'не отмечены');
  });

  await t.test('alert +5 to initiative, mobile +10 feet, resilient, war caster, lucky', async () => {
    const scout = await hero('Дозорный', 'Плут', 3, {feats: ['alert', 'mobile']}, {dexterity: 14});
    const sceneId = await scene('Опушка', [[alice.token, scout.id, 0.5, 0.5]]);
    assert.equal((await request('POST', `${base}/scenes/${sceneId}/initiative/join`, alice.token, {characterId: scout.id})).statusCode, 201);
    const roll = (await pg.query<any>(`SELECT modifier, outcome FROM roll_log WHERE character_id=$1 AND label LIKE 'Инициатива%'`, [scout.id])).rows[0];
    assert.equal(roll.modifier, 7, 'DEX +2 and alert +5');
    assert.ok(roll.outcome.reasons.includes('настороженный +5'));
    const entries = (await request('GET', `${base}/scenes/${sceneId}/initiative`, alice.token)).json().entries;
    assert.equal(entries[0].speed_feet, 40);

    const tank = await hero('Крепыш', 'Волшебник', 5, {feats: ['resilient-constitution', 'war-caster', 'lucky']}, {constitution: 10});
    const save = await check(tank.id, 'save', 'constitution');
    assert.equal(save.modifier, 3);
    assert.ok(save.outcome.reasons.includes('владение: устойчивый'));
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'concentration','{"source":"spell","spellName":"Огненный щит"}')`, [campaignId, tank.id]);
    const roll1 = (await request('POST', `${base}/rolls`, gm.token, {formula: '1d1+9'})).json();
    await request('POST', `${base}/rolls/${roll1.id}/apply`, gm.token, {characterId: tank.id, mode: 'damage'});
    const concentration = (await pg.query<any>(`SELECT outcome FROM roll_log WHERE character_id=$1 AND label LIKE 'Концентрация%'`, [tank.id])).rows[0];
    assert.ok(concentration.outcome.reasons.includes('преимущество: боевой заклинатель'), JSON.stringify(concentration.outcome));

    await pg.query(`DELETE FROM character_resources WHERE character_id=$1 AND name='Очки удачи'`, [tank.id]);
    const apply = await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [tank.id], code: 'poisoned', save: {ability: 'wisdom', dc: 40}});
    assert.equal(apply.statusCode, 200, apply.body);
    assert.ok((await lastSave(tank.id)).outcome.reasons.some((reason: string) => /^везунчик \(очко удачи, осталось 2\): переброс/.test(reason)));
    assert.deepEqual((await pg.query<any>(`SELECT current, max, recharge FROM character_resources WHERE character_id=$1 AND name='Очки удачи'`, [tank.id])).rows[0], {current: 2, max: 3, recharge: 'long'});
  });

  await t.test('sharpshooter: long range without disadvantage, −5 / +10; not for a melee weapon', async () => {
    const archer = await hero('Лучник', 'Воин', 5, {}, {dexterity: 10});
    const sniper = await hero('Снайпер', 'Воин', 5, {feats: ['sharpshooter']}, {dexterity: 10});
    const target = await npc('Мишень');
    const sceneId = await scene('Стрельбище', [[alice.token, archer.id, -11.5, 0.5], [alice.token, sniper.id, -11.5, 2.5], [gm.token, target.id, 9.5, 0.5]]);
    const bow = (id: string) => weapon(id, {name: 'Длинный лук', ability: 'dexterity', damageFormula: '1d1', weaponKind: 'ranged', rangeFeet: 80, longRangeFeet: 320});
    const plainBow = await bow(archer.id);
    const sniperBow = await bow(sniper.id);
    const plain = await check(archer.id, 'attack', plainBow.id, {targetCharacterId: target.id, sceneId});
    assert.ok(plain.outcome.reasons.includes('помеха: дальняя дистанция'));
    const aimed = await check(sniper.id, 'attack', sniperBow.id, {targetCharacterId: target.id, sceneId});
    assert.ok(!aimed.outcome.reasons.includes('помеха: дальняя дистанция'));
    assert.ok(aimed.outcome.reasons.some((reason: string) => reason.startsWith('меткий стрелок: дальняя дистанция')));
    const strong = await hit(sniper.id, sniperBow.id, target.id, {power: true, sceneId});
    assert.equal(strong.modifier, 15, '+20 bonus −5');
    assert.match(strong.damage.roll.formula, /\+10$/);
    assert.match(strong.damage.roll.label, /меткий стрелок \+10/);
    const preview = (await request('GET', `${base}/rolls/attack-preview?characterId=${sniper.id}&key=${sniperBow.id}&targetCharacterId=${target.id}&sceneId=${sceneId}&advantage=none&power=true`, alice.token)).json();
    assert.equal(preview.power, 'меткий стрелок');
    assert.equal(preview.averageDamage, 11);
    const knife = await weapon(sniper.id, {name: 'Нож', damageFormula: '1d1'});
    assert.equal((await request('POST', `${base}/rolls/check`, alice.token, {characterId: sniper.id, kind: 'attack', key: knife.id, power: true})).statusCode, 400);
  });

  await t.test('great weapon master and great weapon fighting; dueling; archery', async () => {
    const brute = await hero('Секач', 'Воин', 5, {feats: ['great-weapon-master'], fightingStyles: ['great-weapon']}, {strength: 10});
    const dummy = await npc('Чучело');
    const maul = await weapon(brute.id, {name: 'Молот', damageFormula: '4d2', properties: ['heavy', 'two-handed']});
    const blow = await hit(brute.id, maul.id, dummy.id, {power: true});
    assert.match(blow.damage.roll.label, /большое оружие: переброс \d/);
    assert.match(blow.damage.roll.label, /мастер большого оружия \+10/);
    const light = await weapon(brute.id, {name: 'Кинжал', damageFormula: '1d4', properties: ['light', 'finesse']});
    assert.equal((await request('POST', `${base}/rolls/check`, alice.token, {characterId: brute.id, kind: 'attack', key: light.id, targetCharacterId: dummy.id, power: true})).statusCode, 400, 'not heavy');

    const duelist = await hero('Фехтовальщик', 'Воин', 3, {text: {levels: {value: 'Боевой стиль: Дуэлянт'}}}, {strength: 10});
    const sword = await weapon(duelist.id, {name: 'Длинный меч', damageFormula: '1d1', properties: ['versatile']});
    assert.match((await hit(duelist.id, sword.id, dummy.id)).damage.roll.formula, /\+2$/);
    const built = await hero('Из мастера', 'Воин', 3, {builder: {fightingStyle: 'dueling'}}, {strength: 10});
    const builtSword = await weapon(built.id, {name: 'Длинный меч', damageFormula: '1d1+2'});
    assert.equal((await hit(built.id, builtSword.id, dummy.id)).damage.roll.formula.endsWith('+2+2'), false, 'already in the weapon — not twice');

    const ranger = await hero('Стрелок', 'Следопыт', 2, {fightingStyles: ['archery']}, {dexterity: 10});
    const bow = await weapon(ranger.id, {name: 'Короткий лук', ability: 'dexterity', damageFormula: '1d1', weaponKind: 'ranged', rangeFeet: 80, longRangeFeet: 320, attackBonus: 0});
    const shot = await check(ranger.id, 'attack', bow.id, {targetCharacterId: dummy.id});
    assert.equal(shot.modifier, 2);
    assert.ok(shot.outcome.reasons.includes('стрельба +2'));
  });

  await t.test('the second weapon: no ability modifier to damage without two-weapon fighting', async () => {
    const twin = await hero('Близнец', 'Плут', 3, {}, {strength: 16});
    const styled = await hero('Мастер двух клинков', 'Воин', 3, {fightingStyles: ['two-weapon']}, {strength: 16});
    const dummy = await npc('Столб');
    const off = await weapon(twin.id, {name: 'Короткий меч', damageFormula: '1d1+@mod', properties: ['light']});
    const styledOff = await weapon(styled.id, {name: 'Короткий меч', damageFormula: '1d1+@mod', properties: ['light']});
    const plain = await hit(twin.id, off.id, dummy.id, {using: 'bonus'});
    assert.equal(plain.damage.roll.total, plain.damage.critical ? 2 : 1, 'STR +3 is not added');
    assert.match(plain.damage.roll.label, /второе оружие — без модификатора/);
    const main = await hit(twin.id, off.id, dummy.id);
    assert.equal(main.damage.roll.total, main.damage.critical ? 5 : 4, 'the main attack keeps it');
    const both = await hit(styled.id, styledOff.id, dummy.id, {using: 'bonus'});
    assert.equal(both.damage.roll.total, both.damage.critical ? 5 : 4, 'two-weapon fighting adds it');
  });
});
