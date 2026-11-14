import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('level up window', async t => {
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

  const gm = await register('gm_levelup'), alice = await register('alice_levelup'), bob = await register('bob_levelup');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Level up'})).json().id;
  for (const player of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', player.token, {code});
  }
  const base = `/campaigns/${campaignId}`;
  const create = async (body: any) => (await request('POST', `${base}/characters`, alice.token, {kind: 'character', ...body})).json();
  const sheet = async (id: string) => (await request('GET', `${base}/characters/${id}`, alice.token)).json();
  const levelUp = (id: string, body: any, token = alice.token) => request('POST', `${base}/characters/${id}/level-up`, token, body);

  const fighter = await create({name: 'Торин', className: 'Воин', level: 3, strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8, hpMax: 28});
  await pg.query('UPDATE characters SET hp_current=28 WHERE id=$1', [fighter.id]);

  await t.test('experience does not raise a hero by itself: the level waits for the window', async () => {
    const award = (await request('POST', `${base}/experience`, gm.token, {characterIds: [fighter.id], amount: 2700})).json().awards[0];
    assert.deepEqual([award.level, award.leveledUp, award.readyLevel], [3, false, 4]);
    const preview = (await request('GET', `${base}/characters/${fighter.id}/level-up`, alice.token)).json();
    assert.deepEqual([preview.plan.from, preview.plan.to, preview.plan.asi, preview.plan.averageHp], [3, 4, true, 8]);
    assert.equal((await request('GET', `${base}/characters/${fighter.id}/level-up`, bob.token)).statusCode, 403);
  });

  await t.test('rolled hit points go to the journal; a Constitution increase adds hit points for every level', async () => {
    assert.equal((await levelUp(fighter.id, {hp: 'roll'})).statusCode, 400, 'the ability increase is not chosen');
    const done = await levelUp(fighter.id, {hp: 'roll', asi: {kind: 'asi', increases: {constitution: 2}}});
    assert.equal(done.statusCode, 201, done.body);
    const {level, hpGain, roll, next} = done.json();
    assert.equal(level, 4);
    assert.ok(roll >= 1 && roll <= 10);
    assert.equal(hpGain, Math.max(1, roll + 2) + 4, 'the die + old CON +2, then CON 16 adds 1 × 4 levels');
    const after = await sheet(fighter.id);
    assert.deepEqual([after.level, after.constitution, after.hp_max, after.hp_current], [4, 16, 28 + hpGain, 28 + hpGain]);
    assert.match(after.sheet_extra.text.levels.value, /Уровень 4\. Улучшение характеристик: Телосложение \+2/);
    assert.equal(next, null);
    const rolls = (await request('GET', `${base}/rolls`, gm.token)).json().rolls;
    assert.ok(rolls.some((entry: any) => entry.label === 'Хиты за 4 уровень — Торин' && entry.total === roll));
    assert.match((await levelUp(fighter.id, {hp: 'average'})).json().message, /не хватает/);
  });

  await t.test('the GM can level up by milestone; class resources follow the level', async () => {
    assert.equal((await levelUp(fighter.id, {hp: 'average', milestone: true})).statusCode, 403);
    const preview = (await request('GET', `${base}/characters/${fighter.id}/level-up`, gm.token)).json();
    assert.equal(preview.plan, null);
    assert.deepEqual(preview.milestone.features, ['Дополнительная атака']);
    const done = await levelUp(fighter.id, {hp: 'average', milestone: true}, gm.token);
    assert.equal(done.statusCode, 201, done.body);
    assert.deepEqual([done.json().level, done.json().hpGain], [5, 9], 'd10 / 2 + 1 + CON 3');
    const resources = (await sheet(fighter.id)).resources.map((r: any) => [r.name, r.max, r.recharge]).sort();
    assert.deepEqual(resources, [['Всплеск действий', 1, 'short'], ['Второе дыхание', 1, 'short']]);
  });

  await t.test('a wizard writes two new spells into the book; slots grow', async () => {
    const wizard = await create({name: 'Мирриэль', className: 'Волшебник', level: 1, intelligence: 16, constitution: 12, hpMax: 7});
    await request('POST', `${base}/experience`, gm.token, {characterIds: [wizard.id], amount: 300});
    const plan = (await request('GET', `${base}/characters/${wizard.id}/level-up`, alice.token)).json().plan;
    assert.deepEqual([plan.spells, plan.maxSpellLevel, plan.cantrips], [2, 1, 0]);
    assert.equal(plan.subclass.current, 'evocation');
    assert.equal((await levelUp(wizard.id, {hp: 'average', subclass: 'evocation', spells: ['shield', 'fireball']})).statusCode, 400, 'no 3rd level spells at level 2');
    const done = await levelUp(wizard.id, {hp: 'average', subclass: 'evocation', spells: ['shield', 'magic-missile']});
    assert.equal(done.statusCode, 201, done.body);
    assert.equal(done.json().className, 'Волшебник (Школа Воплощения)');
    const spells = (await pg.query<any>('SELECT srd_index, prepared FROM character_spells WHERE character_id=$1 ORDER BY srd_index', [wizard.id])).rows;
    assert.deepEqual(spells, [{srd_index: 'magic-missile', prepared: false}, {srd_index: 'shield', prepared: false}]);
    const slots = (await pg.query<any>('SELECT level, max FROM character_spell_slots WHERE character_id=$1', [wizard.id])).rows;
    assert.deepEqual(slots, [{level: 1, max: 3}]);
  });

  await t.test('a paladin picks a fighting style: Dueling adds to the one-handed weapon', async () => {
    const paladin = await create({name: 'Ансельм', className: 'Паладин', level: 1, strength: 16, charisma: 14, constitution: 14, hpMax: 12});
    await request('POST', `${base}/characters/${paladin.id}/weapons`, alice.token, {name: 'Длинный меч', ability: 'strength', damageFormula: '1d8+@mod', damageType: 'slashing'});
    await request('POST', `${base}/experience`, gm.token, {characterIds: [paladin.id], amount: 300});
    assert.match((await levelUp(paladin.id, {hp: 'average'})).json().message, /боевой стиль/);
    const done = await levelUp(paladin.id, {hp: 'average', fightingStyle: 'dueling'});
    assert.equal(done.statusCode, 201, done.body);
    const after = await sheet(paladin.id);
    assert.equal(after.weapons[0].damage_formula, '1d8+@mod+2');
    const resources = Object.fromEntries(after.resources.map((r: any) => [r.name, r.max]));
    assert.deepEqual(resources, {'Божественное чувство': 3, 'Наложение рук': 10});
    assert.match(after.sheet_extra.text.levels.value, /Боевой стиль: Дуэлянт/);
  });

  await t.test('the subclass is chosen on its level: into the class text and the automation choice', async () => {
    const paladin = await create({name: 'Изольда', className: 'Паладин', level: 2, strength: 16, charisma: 14, constitution: 14, hpMax: 20});
    await request('POST', `${base}/experience`, gm.token, {characterIds: [paladin.id], amount: 900});
    const plan = (await request('GET', `${base}/characters/${paladin.id}/level-up`, alice.token)).json().plan;
    assert.equal(plan.subclass.current, 'devotion');
    assert.ok(plan.subclass.options.some((option: any) => option.value === 'vengeance' && option.label === 'Клятва мести'));
    assert.match((await levelUp(paladin.id, {hp: 'average'})).json().message, /подкласс/);
    assert.equal((await levelUp(paladin.id, {hp: 'average', subclass: 'nonsense'})).statusCode, 400);
    const done = await levelUp(paladin.id, {hp: 'average', subclass: 'vengeance'});
    assert.equal(done.statusCode, 201, done.body);
    assert.equal(done.json().className, 'Паладин (Клятва мести)');
    assert.deepEqual([plan.features, plan.subclass.srdFeatures], [['Божественное здоровье'], ['Клятва преданности: заклинания клятвы, Божественный канал']]);
    assert.deepEqual(done.json().features, ['Подкласс: Клятва мести', 'Божественное здоровье', 'Умения подкласса «Клятва мести» 3-го уровня впишите в лист вручную']);
    const after = await sheet(paladin.id);
    assert.equal(after.sheet_extra.subclasses.paladin, 'vengeance');
    assert.match(after.sheet_extra.text.levels.value, /Уровень 3\. Подкласс: Клятва мести/);
    const features = (await request('GET', `${base}/characters/${paladin.id}/features`, alice.token)).json();
    assert.equal(features.subclasses.find((entry: any) => entry.classId === 'paladin').value, 'vengeance');
    await request('POST', `${base}/experience`, gm.token, {characterIds: [paladin.id], amount: 2700});
    const later = (await request('GET', `${base}/characters/${paladin.id}/level-up`, alice.token)).json().plan;
    assert.equal(later.subclass, null);
    assert.match((await levelUp(paladin.id, {hp: 'average', subclass: 'devotion', asi: {kind: 'asi', increases: {strength: 2}}})).json().message, /Подкласс на этом уровне не выбирают/);

    const rogue = await create({name: 'Шнырь', className: 'Плут', level: 2, dexterity: 16, hpMax: 15});
    await request('POST', `${base}/experience`, gm.token, {characterIds: [rogue.id], amount: 900});
    const rogueDone = await levelUp(rogue.id, {hp: 'average', subclass: 'thief'});
    assert.equal(rogueDone.statusCode, 201, rogueDone.body);
    assert.equal(rogueDone.json().className, 'Плут (Вор)');
    await request('POST', `${base}/experience`, gm.token, {characterIds: [rogue.id], amount: 1800});
    const multiclass = (await request('GET', `${base}/characters/${rogue.id}/level-up?classId=fighter`, alice.token)).json().plan;
    assert.deepEqual([multiclass.classProblem, multiclass.newClass, multiclass.classText], [null, true, 'Плут (Вор) 3 / Воин 1']);
  });

  await t.test('a feat from the list: its name, +1 for a half-feat, the marked feats list grows', async () => {
    const knight = await create({name: 'Бертран', className: 'Воин', level: 3, strength: 16, constitution: 13, wisdom: 12, intelligence: 10, hpMax: 28});
    await pg.query(`UPDATE characters SET sheet_extra = jsonb_set(COALESCE(sheet_extra, '{}'::jsonb), '{feats}', '["alert"]') WHERE id=$1`, [knight.id]);
    await request('POST', `${base}/experience`, gm.token, {characterIds: [knight.id], amount: 2700});
    const info = (await request('GET', `${base}/characters/${knight.id}/level-up`, alice.token)).json();
    assert.deepEqual(info.feats.find((feat: any) => feat.id === 'observant').abilities, ['intelligence', 'wisdom']);
    assert.equal(info.feats.find((feat: any) => feat.id === 'alert').known, true);
    const feat = (id: string, increase?: string) => ({hp: 'average', asi: {kind: 'feat', id, name: id, ...(increase ? {increase} : {})}});
    assert.match((await levelUp(knight.id, feat('alert'))).json().message, /уже есть/);
    assert.match((await levelUp(knight.id, feat('observant'))).json().message, /Интеллект или Мудрость/);
    assert.match((await levelUp(knight.id, feat('observant', 'strength'))).json().message, /Интеллект или Мудрость/);
    assert.match((await levelUp(knight.id, feat('sentinel', 'strength'))).json().message, /не повышает/);
    const done = await levelUp(knight.id, feat('resilient-constitution', 'constitution'));
    assert.equal(done.statusCode, 201, done.body);
    assert.equal(done.json().hpGain, 6 + 1 + 4, 'd10 average 6 + CON 1, then +1 × 4 levels');
    const after = await sheet(knight.id);
    assert.equal(after.constitution, 14);
    assert.deepEqual(after.sheet_extra.feats, ['alert', 'resilient-constitution']);
    assert.match(after.sheet_extra.text.levels.value, /Черта: Устойчивый \(Телосложение\) \(Телосложение \+1\)/);
  });

  await t.test('a sorcerer replaces one known spell on a new level', async () => {
    const sorcerer = await create({name: 'Зарина', className: 'Чародей', level: 2, charisma: 16, hpMax: 12});
    await pg.query(`INSERT INTO character_spells (campaign_id, character_id, source, srd_index, prepared) VALUES ($1,$2,'srd','magic-missile',true), ($1,$2,'srd','shield',true)`, [campaignId, sorcerer.id]);
    await pg.query(`INSERT INTO character_spells (campaign_id, character_id, source, srd_index, prepared, granted) VALUES ($1,$2,'srd','sleep',true,true)`, [campaignId, sorcerer.id]);
    await request('POST', `${base}/experience`, gm.token, {characterIds: [sorcerer.id], amount: 900});
    const info = (await request('GET', `${base}/characters/${sorcerer.id}/level-up`, alice.token)).json();
    assert.equal(info.plan.replaceSpell, true);
    assert.deepEqual(info.swappableSpells.sort(), ['magic-missile', 'shield'], 'a granted spell is not swappable');
    const body = (replace: any) => ({hp: 'average', spells: ['misty-step'], replace});
    assert.equal((await levelUp(sorcerer.id, body({from: 'sleep', to: 'burning-hands'}))).statusCode, 400, 'granted');
    assert.equal((await levelUp(sorcerer.id, body({from: 'magic-missile', to: 'cure-wounds'}))).statusCode, 400, 'not a sorcerer spell');
    assert.equal((await levelUp(sorcerer.id, body({from: 'magic-missile', to: 'misty-step'}))).statusCode, 400, 'already picked as the new spell');
    const done = await levelUp(sorcerer.id, body({from: 'magic-missile', to: 'burning-hands'}));
    assert.equal(done.statusCode, 201, done.body);
    const spells = (await pg.query<any>('SELECT srd_index FROM character_spells WHERE character_id=$1 ORDER BY srd_index', [sorcerer.id])).rows.map(row => row.srd_index);
    assert.deepEqual(spells, ['burning-hands', 'misty-step', 'shield', 'sleep']);
    assert.match(done.json().features.join('; '), /Замена заклинания: .+ → /);
    const wizard = await create({name: 'Ворон', className: 'Волшебник', level: 2, hpMax: 10});
    const wizardPlan = (await request('GET', `${base}/characters/${wizard.id}/level-up`, gm.token)).json().milestone;
    assert.equal(wizardPlan.replaceSpell, false);
  });

  await t.test('a dry run shows before → after and leaves the sheet untouched; the list tells who may level up that a level waits', async () => {
    const cleric = await create({name: 'Элия', className: 'Жрец', level: 3, wisdom: 16, constitution: 14, hpMax: 24});
    const roster = async (token: string) => (await request('GET', `${base}/characters`, token)).json().characters.find((entry: any) => entry.id === cleric.id);
    assert.equal((await roster(alice.token)).level_ready, false);
    await request('POST', `${base}/experience`, gm.token, {characterIds: [cleric.id], amount: 2700});
    assert.equal((await roster(alice.token)).level_ready, true, 'the owner sees it');
    assert.equal((await roster(gm.token)).level_ready, true, 'and the GM');
    assert.equal((await roster(bob.token))?.level_ready ?? false, false, 'another player does not');
    assert.equal('experience' in (await roster(alice.token)), false, 'experience stays out of the list');

    const info = (await request('GET', `${base}/characters/${cleric.id}/level-up`, alice.token)).json();
    assert.deepEqual(info.suggestion.asi, {kind: 'asi', increases: {wisdom: 2}}, 'a cleric raises Wisdom');
    assert.equal(info.suggestion.cantrips.length, info.plan.cantrips);
    assert.equal(info.featureTexts['Улучшение характеристик'].automation, 'auto', 'every new feature comes with its card');
    const untouched = await sheet(cleric.id);
    const rollCount = async () => (await request('GET', `${base}/rolls`, gm.token)).json().rolls.length;
    const rollsBefore = await rollCount();

    const preview = await levelUp(cleric.id, {...info.suggestion, dryRun: true});
    assert.equal(preview.statusCode, 200, preview.body);
    const {before, after, problems, hpGain} = preview.json();
    assert.deepEqual(problems, []);
    assert.deepEqual([before.level, after.level, before.scores.wisdom, after.scores.wisdom, after.proficiency], [3, 4, 16, 18, 2]);
    assert.equal(after.hpMax - before.hpMax, hpGain);
    assert.ok(after.slots.some((slot: any) => slot.level === 2 && slot.max === 3), 'a third 2nd-level slot');
    assert.equal(after.spells - before.spells, info.plan.cantrips);

    const partial = (await levelUp(cleric.id, {hp: 'roll', dryRun: true})).json();
    assert.ok(partial.problems.length, 'the ability increase is not chosen yet');
    assert.deepEqual([partial.after.level, partial.after.scores.wisdom], [4, 16], 'the rest is previewed anyway');
    assert.ok(partial.hpRange[0] >= 1 && partial.hpRange[1] > partial.hpRange[0], 'a roll shows its range');
    const still = await sheet(cleric.id);
    assert.deepEqual([still.level, still.wisdom, still.hp_max, still.revision], [untouched.level, untouched.wisdom, untouched.hp_max, untouched.revision], 'nothing was written');
    assert.equal(await rollCount(), rollsBefore, 'a dry run rolls nothing');

    const done = await levelUp(cleric.id, info.suggestion);
    assert.equal(done.statusCode, 201, done.body);
    assert.equal((await sheet(cleric.id)).hp_max, before.hpMax + hpGain, 'exactly what the dry run promised');
    assert.equal((await roster(alice.token)).level_ready, false);
  });

  await t.test('the GM takes experience away without lowering the level; lowering a level undoes exactly what it gave', async () => {
    const levelDown = (id: string, body: any = {}, token = alice.token) => request('POST', `${base}/characters/${id}/level-down`, token, body);
    const giveXp = (id: string, amount: number, token = gm.token) => request('POST', `${base}/experience`, token, {characterIds: [id], amount});

    const scout = await create({name: 'Ласка', className: 'Следопыт', level: 1, dexterity: 16, hpMax: 11});
    await giveXp(scout.id, 900);
    const taken = await giveXp(scout.id, -600);
    assert.equal(taken.statusCode, 201, taken.body);
    assert.deepEqual([taken.json().awards[0].amount, taken.json().awards[0].experience, taken.json().awards[0].level], [-600, 300, 1]);
    assert.equal((await giveXp(scout.id, -5000)).json().awards[0].experience, 0, 'not below zero');
    assert.equal((await giveXp(scout.id, -10, alice.token)).statusCode, 403);
    assert.equal((await request('POST', `${base}/experience`, gm.token, {characterIds: [scout.id], amount: -10, split: true})).statusCode, 400);
    assert.equal((await levelDown(scout.id)).statusCode, 400, 'level 1 is the floor');

    const paladin = await create({name: 'Гвиневра', className: 'Паладин', level: 1, strength: 16, charisma: 14, constitution: 14, hpMax: 12});
    await request('POST', `${base}/characters/${paladin.id}/weapons`, alice.token, {name: 'Длинный меч', ability: 'strength', damageFormula: '1d8+@mod', damageType: 'slashing'});
    const start = await sheet(paladin.id);
    await giveXp(paladin.id, 300);
    assert.equal((await levelUp(paladin.id, {hp: 'average', fightingStyle: 'dueling'})).statusCode, 201);
    assert.equal((await levelDown(paladin.id, {expectedLevel: 3})).statusCode, 409, 'a stale confirmation is refused');
    const preview = (await request('GET', `${base}/characters/${paladin.id}/level-down`, alice.token)).json();
    assert.deepEqual([preview.from, preview.to, preview.recorded, preview.stillReady], [2, 1, true, true]);
    assert.ok(preview.lines.some((line: string) => /боевого стиля/.test(line)));
    assert.equal((await request('GET', `${base}/characters/${paladin.id}/level-down`, bob.token)).statusCode, 403);
    const down = await levelDown(paladin.id);
    assert.equal(down.statusCode, 200, down.body);
    const back = await sheet(paladin.id);
    assert.deepEqual([back.level, back.hp_max, back.hp_current, back.weapons[0].damage_formula], [1, start.hp_max, start.hp_current, '1d8+@mod']);
    assert.deepEqual(back.resources.map((r: any) => [r.name, r.max]).sort(), start.resources.map((r: any) => [r.name, r.max]).sort());
    assert.equal(back.sheet_extra?.text?.levels, undefined, 'the level 2 note is gone');
    assert.equal(back.experience, 300, 'experience stays');

    const wizard = await create({name: 'Сова', className: 'Волшебник', level: 1, intelligence: 16, constitution: 12, hpMax: 7});
    await giveXp(wizard.id, 300);
    assert.equal((await levelUp(wizard.id, {hp: 'average', subclass: 'evocation', spells: ['shield', 'magic-missile']})).statusCode, 201);
    assert.equal((await levelDown(wizard.id, {}, gm.token)).statusCode, 200, 'the GM may lower it too');
    const plain = await sheet(wizard.id);
    assert.deepEqual([plain.level, plain.class_name, plain.sheet_extra?.subclasses?.wizard], [1, 'Волшебник', undefined]);
    assert.equal((await pg.query('SELECT 1 FROM character_spells WHERE character_id=$1', [wizard.id])).rows.length, 0);
    const slots = (await pg.query<any>('SELECT level, max FROM character_spell_slots WHERE character_id=$1 AND max > 0', [wizard.id])).rows;
    assert.deepEqual(slots, [{level: 1, max: 2}]);

    const brute = await create({name: 'Гром', className: 'Воин', level: 3, strength: 16, constitution: 14, hpMax: 28});
    await pg.query('UPDATE characters SET hp_current=20 WHERE id=$1', [brute.id]);
    await giveXp(brute.id, 2700);
    assert.equal((await levelUp(brute.id, {hp: 'average', asi: {kind: 'asi', increases: {constitution: 2}}})).statusCode, 201);
    await levelDown(brute.id);
    const brute3 = await sheet(brute.id);
    assert.deepEqual([brute3.level, brute3.constitution, brute3.hp_max, brute3.hp_current], [3, 14, 28, 20]);
    assert.equal((await levelDown(brute.id)).statusCode, 200, 'an unrecorded level goes down too');
    const brute2 = await sheet(brute.id);
    assert.deepEqual([brute2.level, brute2.hp_max], [2, 28 - 8], 'the average of a d10 + CON');

    const mixed = await create({name: 'Сплав', className: 'Воин 3 / Волшебник 2', level: 5, constitution: 14, hpMax: 40});
    const ask = (await request('GET', `${base}/characters/${mixed.id}/level-down`, alice.token)).json();
    assert.deepEqual([ask.recorded, ask.needsClass, ask.classes.map((entry: any) => entry.id)], [false, true, ['fighter', 'wizard']]);
    assert.equal((await levelDown(mixed.id)).statusCode, 400, 'which class?');
    assert.equal((await levelDown(mixed.id, {classId: 'wizard'})).statusCode, 200);
    assert.equal((await sheet(mixed.id)).class_name, 'Воин 3 / Волшебник 1');
    await levelDown(mixed.id, {classId: 'wizard'});
    const single = await sheet(mixed.id);
    assert.deepEqual([single.class_name, single.level, single.hp_max], ['Воин 3', 3, 40 - 6 - 6]);
  });
});
