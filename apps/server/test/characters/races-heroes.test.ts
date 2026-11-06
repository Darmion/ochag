import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('race traits and level 7–11 features', async t => {
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
  const gm = await register('gm_thirteen'), alice = await register('alice_thirteen');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Thirteen'})).json().id;
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
    kind: 'npc', name, disposition: 'hostile', hpMax: 100000, hpCurrent: 100000, armorClass: 1, speedFeet: 30, ...extra,
  })).json();
  const resource = async (id: string, name: string) => (await pg.query<any>('SELECT current, max, recharge FROM character_resources WHERE character_id=$1 AND name=$2', [id, name])).rows[0] ?? null;
  const codes = async (id: string) => (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active', [id])).rows.map(row => row.effect_code as string);
  const lastSave = async (id: string) => {
    const row = (await pg.query<any>(`SELECT outcome, total FROM roll_log WHERE character_id=$1 AND outcome->>'kind'='save' ORDER BY created_at DESC LIMIT 1`, [id])).rows[0];
    return {...row, outcome: {...row.outcome, reasons: row.outcome.reasons ?? []}};
  };
  const apply = async (targetId: string, condition: string, save?: {ability: string; dc: number}) => {
    const result = await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [targetId], code: condition, ...(save ? {save} : {})});
    assert.equal(result.statusCode, 200, result.body);
    return result.json().results[0];
  };
  const hp = async (id: string) => Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current);
  const hurt = async (characterId: string, amount: number, damageType?: string) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: amount === 1 ? '1d1' : `1d1+${amount - 1}`})).json();
    const applied = await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId, mode: 'damage', ...(damageType ? {damageType} : {})});
    assert.equal(applied.statusCode, 200, applied.body);
    return applied.json();
  };
  const features = async (id: string) => (await request('GET', `${base}/characters/${id}/features`, alice.token)).json().features as any[];
  const feature = async (id: string, featureId: string) => (await features(id)).find(entry => entry.id === featureId);
  const check = async (characterId: string, kind: string, key: string, extra: any = {}) => {
    const response = await request('POST', `${base}/rolls/check`, alice.token, {characterId, kind, key, ...extra});
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };
  const weapon = async (characterId: string, damageFormula: string) => (await request('POST', `${base}/characters/${characterId}/weapons`, alice.token, {
    name: 'Секира', ability: 'strength', proficient: false, attackBonus: 20, damageFormula,
  })).json();
  const critical = async (characterId: string, weaponId: string, targetId: string) => {
    for (let i = 0; i < 400; i++) {
      const attack = await check(characterId, 'attack', weaponId, {targetCharacterId: targetId});
      if (attack.outcome?.critical && attack.damage) return attack;
    }
    throw new Error('no critical hit in 400 attacks');
  };
  const scene = async (name: string, members: Array<[string, string, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 24, heightCells: 12})).json().id;
    for (const [token, characterId, x, z] of members) await request('POST', `${base}/scenes/${sceneId}/objects`, token, {characterId, x, z});
    return sceneId as string;
  };

  await t.test('lucky: a natural 1 on a halfling\'s d20 is rolled again; race traits are listed', async () => {
    const halfling = await hero('Пипин', 'Плут', 3, 'Легконогий полурослик');
    const listed = (await features(halfling.id)).filter(entry => entry.name.startsWith('Раса:')).map(entry => [entry.id, entry.use]);
    assert.deepEqual(listed, [['lucky', 'passive'], ['brave', 'passive']]);
    let lucky: any = null;
    for (let i = 0; i < 300 && !lucky; i++) {
      const roll = await check(halfling.id, 'ability', 'strength');
      const note = (roll.outcome?.reasons ?? []).find((reason: string) => /^везучий: 1 → \d+$/.test(reason));
      if (note) lucky = {roll, rerolled: Number(note.split('→ ')[1])};
      else assert.notEqual(roll.dice_results[0], 1, 'a kept 1 is always rerolled');
    }
    assert.ok(lucky, 'one in twenty d20 rolls is a 1');
    assert.equal(lucky.roll.dice_results[0], lucky.rerolled, 'the new die is the one kept');
    const human = await hero('Сэм', 'Плут', 3, 'Человек');
    assert.deepEqual((await features(human.id)).filter(entry => entry.name.startsWith('Раса:')), []);
  });

  await t.test('brave, fey ancestry, dwarven resilience, gnome cunning: advantage on the save against that', async () => {
    const halfling = await hero('Храбрец', 'Воин', 3, 'Полурослик');
    await apply(halfling.id, 'frightened', {ability: 'wisdom', dc: 40});
    assert.ok((await lastSave(halfling.id)).outcome.reasons.includes('преимущество: храбрый'));
    await apply(halfling.id, 'charmed', {ability: 'wisdom', dc: 40});
    assert.ok(!(await lastSave(halfling.id)).outcome.reasons.includes('преимущество: храбрый'), 'only fear');
    const elf = await hero('Эльфийка', 'Воин', 3, 'Высший эльф');
    await apply(elf.id, 'charmed', {ability: 'wisdom', dc: 40});
    assert.ok((await lastSave(elf.id)).outcome.reasons.includes('преимущество: наследие фей'));
    const dwarf = await hero('Гимли', 'Воин', 3, 'Холмовой дварф');
    await apply(dwarf.id, 'poisoned', {ability: 'constitution', dc: 40});
    assert.ok((await lastSave(dwarf.id)).outcome.reasons.includes('преимущество: дварфийская устойчивость'));
    const gnome = await hero('Тинкер', 'Волшебник', 3, 'Скальный гном');
    const caster = await hero('Чародей', 'Волшебник', 5, null, {intelligence: 18});
    const spell = (await request('POST', `${base}/characters/${caster.id}/spells`, gm.token, {source: 'srd', srdIndex: 'hold-person'})).json();
    await pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,2,2,2)', [campaignId, caster.id]);
    const sceneId = await scene('Поляна', [[alice.token, caster.id, 0.5, 0.5], [alice.token, gnome.id, 1.5, 0.5]]);
    const cast = await request('POST', `${base}/characters/${caster.id}/spells/${spell.id}/cast`, alice.token, {sceneId, targetIds: [gnome.id]});
    assert.equal(cast.statusCode, 201, cast.body);
    assert.ok((await lastSave(gnome.id)).outcome.reasons.includes('преимущество: гномья хитрость'), JSON.stringify((await lastSave(gnome.id)).outcome.reasons));
    await apply(gnome.id, 'frightened', {ability: 'wisdom', dc: 40});
    assert.ok(!(await lastSave(gnome.id)).outcome.reasons.includes('преимущество: гномья хитрость'), 'a GM condition is not magic');
  });

  await t.test('relentless endurance: a half-orc drops to 1 instead of 0, once per long rest', async () => {
    const orc = await hero('Гром', 'Воин', 3, 'Полуорк', {hpCurrent: 20});
    assert.match((await feature(orc.id, 'relentless-endurance')).detail, /наготове/);
    const first = await hurt(orc.id, 30);
    assert.equal(await hp(orc.id), 1);
    assert.ok(first.notices.some((notice: any) => /«Непоколебимость»/.test(notice.title)), JSON.stringify(first.notices));
    assert.deepEqual(await resource(orc.id, 'Непоколебимость'), {current: 0, max: 1, recharge: 'long'});
    assert.match((await feature(orc.id, 'relentless-endurance')).detail, /потрачено/);
    await hurt(orc.id, 5);
    assert.equal(await hp(orc.id), 0, 'spent — falls');
    await pg.query('UPDATE characters SET hp_current=10 WHERE id=$1', [orc.id]);
    await request('POST', `${base}/characters/${orc.id}/rest`, alice.token, {kind: 'long'});
    assert.equal((await resource(orc.id, 'Непоколебимость')).current, 1, 'back after a long rest');
    await hurt(orc.id, 200);
    assert.equal(await hp(orc.id), 0, 'massive damage kills outright — no endurance');
  });

  await t.test('relentless rage: raging at 0 — a CON save DC 10, +5 each time; fails at 0 hit points', async () => {
    const barbarian = await hero('Ургаш', 'Варвар', 11, null, {constitution: 30});
    assert.match((await feature(barbarian.id, 'relentless-rage')).detail, /СЛ 10/);
    assert.equal((await request('POST', `${base}/characters/${barbarian.id}/features/rage`, alice.token, {})).statusCode, 200);
    const held = await hurt(barbarian.id, 70);
    assert.equal(await hp(barbarian.id), 1, 'CON +10 against DC 10 always holds');
    assert.ok(held.notices.some((notice: any) => /«Непреклонная ярость»/.test(notice.title) && /СЛ 15/.test(notice.detail)), JSON.stringify(held.notices));
    assert.ok((await codes(barbarian.id)).includes('raging'), 'still raging');
    assert.deepEqual(await resource(barbarian.id, 'Непреклонная ярость'), {current: 5, max: 6, recharge: 'short'});
    assert.match((await feature(barbarian.id, 'relentless-rage')).detail, /СЛ 15/);
    await pg.query(`UPDATE character_resources SET current=0 WHERE character_id=$1 AND name='Непреклонная ярость'`, [barbarian.id]);
    await hurt(barbarian.id, 10);
    assert.equal(await hp(barbarian.id), 0, 'DC 40 — falls');
    assert.ok(!(await codes(barbarian.id)).includes('raging'));
    const calm = await hero('Спокойный', 'Варвар', 11, null, {constitution: 30, hpCurrent: 5});
    await hurt(calm.id, 10);
    assert.equal(await hp(calm.id), 0);
  });

  await t.test('brutal critical and savage attacks: extra weapon dice on a melee critical hit', async () => {
    const dummy = await npc('Чучело');
    const barbarian = await hero('Крушила', 'Варвар', 9, null, {strength: 10});
    const axe = await weapon(barbarian.id, '1d12');
    const crit = await critical(barbarian.id, axe.id, dummy.id);
    assert.equal(crit.damage.roll.formula, '2d12+1d12');
    assert.equal(crit.damage.roll.dice_results.length, 3);
    assert.match(crit.damage.roll.label, /сокрушительный крит/);
    const orc = await hero('Свирепый', 'Варвар', 13, 'Полуорк', {strength: 10});
    const cleaver = await weapon(orc.id, '1d12');
    const savage = await critical(orc.id, cleaver.id, dummy.id);
    assert.equal(savage.damage.roll.formula, '2d12+3d12', 'two for 13th level and one for the half-orc');
    const plain = await hero('Обычный', 'Варвар', 8, null, {strength: 10});
    const club = await weapon(plain.id, '1d12');
    assert.equal((await critical(plain.id, club.id, dummy.id)).damage.roll.formula, '2d12');
  });

  await t.test('improved divine smite: every melee weapon hit deals 1d8 radiant more', async () => {
    const dummy = await npc('Мишень');
    const paladin = await hero('Каратель', 'Паладин', 11, null, {strength: 10});
    const sword = await weapon(paladin.id, '1d1');
    let attack: any = null;
    for (let i = 0; i < 20 && !attack; i++) {
      const done = await check(paladin.id, 'attack', sword.id, {targetCharacterId: dummy.id});
      if (done.outcome?.hit) attack = done;
    }
    assert.ok(attack);
    assert.equal(attack.improvedSmite.roll.formula, attack.outcome.critical ? '2d8' : '1d8');
    assert.match(attack.improvedSmite.roll.label, /улучшенная кара/);
    const young = await hero('Оруженосец', 'Паладин', 10, null, {strength: 10});
    const blade = await weapon(young.id, '1d1');
    for (let i = 0; i < 5; i++) {
      assert.equal((await check(young.id, 'attack', blade.id, {targetCharacterId: dummy.id})).improvedSmite, undefined);
    }
  });

  await t.test('aura of courage: no fear for the paladin and allies within 10 feet', async () => {
    const paladin = await hero('Отважный', 'Паладин 10 (Клятва мести)', 10, null);
    const near = await hero('Соратник', 'Воин', 3, null);
    const far = await hero('Дальний', 'Воин', 3, null);
    await scene('Мост', [[alice.token, paladin.id, 0.5, 0.5], [alice.token, near.id, 1.5, 0.5], [alice.token, far.id, 10.5, 0.5]]);
    const self = await apply(paladin.id, 'frightened', {ability: 'wisdom', dc: 40});
    assert.deepEqual([self.applied, self.immune], [false, 'аура отваги']);
    const ally = await apply(near.id, 'frightened', {ability: 'wisdom', dc: 40});
    assert.deepEqual([ally.applied, ally.immune], [false, 'аура отваги: Отважный']);
    assert.equal((await apply(far.id, 'frightened')).applied, true, 'outside the aura');
    assert.equal((await apply(near.id, 'charmed')).applied, true, 'only fear');
    assert.match((await feature(paladin.id, 'aura-of-courage')).detail, /в 10 фт\. нельзя испугать/);
  });

  await t.test('reliable talent: a proficient skill check never shows less than 10', async () => {
    const rogue = await hero('Ловкач', 'Плут', 11, null, {dexterity: 10});
    await pg.query(`INSERT INTO character_skills(campaign_id, character_id, skill_index, proficient) VALUES($1,$2,'stealth',true)`, [campaignId, rogue.id]);
    let floored = 0;
    for (let i = 0; i < 40; i++) {
      const roll = await check(rogue.id, 'skill', 'stealth');
      assert.ok(Math.max(...roll.dice_results) >= 10, `${roll.dice_results}`);
      if ((roll.outcome?.reasons ?? []).some((reason: string) => /^надёжный талант: \d → 10$/.test(reason))) floored += 1;
    }
    assert.ok(floored > 0, 'about half of the rolls are lifted');
    let low = false;
    for (let i = 0; i < 40 && !low; i++) low = (await check(rogue.id, 'skill', 'athletics')).dice_results[0] < 10;
    assert.ok(low, 'without proficiency — no floor');
    const young = await hero('Подмастерье', 'Плут', 10, null);
    await pg.query(`INSERT INTO character_skills(campaign_id, character_id, skill_index, proficient) VALUES($1,$2,'stealth',true)`, [campaignId, young.id]);
    let youngLow = false;
    for (let i = 0; i < 40 && !youngLow; i++) youngLow = (await check(young.id, 'skill', 'stealth')).dice_results[0] < 10;
    assert.ok(youngLow, 'from 11th level');
  });

  await t.test('stillness of mind and purity of body', async () => {
    const monk = await hero('Тихий', 'Монах', 10, null);
    assert.equal((await feature(monk.id, 'stillness-of-mind')).reason, 'не очарован и не испуган');
    assert.equal((await request('POST', `${base}/characters/${monk.id}/features/stillness-of-mind`, alice.token, {})).statusCode, 400);
    await apply(monk.id, 'charmed');
    await apply(monk.id, 'frightened');
    assert.match((await feature(monk.id, 'stillness-of-mind')).detail, /снять: (очарован, испуган|испуган, очарован)/);
    const calmed = await request('POST', `${base}/characters/${monk.id}/features/stillness-of-mind`, alice.token, {});
    assert.equal(calmed.statusCode, 200, calmed.body);
    assert.match(calmed.json().message, /«Спокойствие разума» — (очарование и испуг|испуг и очарование) больше не действуют\./);
    assert.deepEqual(await codes(monk.id), []);
    const poison = await apply(monk.id, 'poisoned', {ability: 'constitution', dc: 40});
    assert.deepEqual([poison.applied, poison.immune], [false, 'чистота тела']);
    const venom = await hurt(monk.id, 12, 'poison');
    assert.equal(venom.applied, 0);
    assert.equal(await hp(monk.id), 60);
    const novice = await hero('Новичок', 'Монах', 6, null);
    assert.equal(await feature(novice.id, 'stillness-of-mind'), undefined);
    assert.equal((await apply(novice.id, 'poisoned')).applied, true);
  });

  await t.test('fey ancestry: magic cannot put an elf to sleep', async () => {
    const sleeper = await hero('Сонник', 'Волшебник', 3, null, {intelligence: 16});
    const spell = (await request('POST', `${base}/characters/${sleeper.id}/spells`, gm.token, {source: 'srd', srdIndex: 'sleep'})).json();
    await pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,2,2)', [campaignId, sleeper.id]);
    const elf = await npc('Эльф-разведчик', {hpMax: 2, hpCurrent: 2});
    await pg.query(`UPDATE characters SET sheet_extra='{"race":"Лесной эльф"}'::jsonb WHERE id=$1`, [elf.id]);
    const kobold = await npc('Кобольд', {hpMax: 2, hpCurrent: 2});
    const sceneId = await scene('Опушка', [[alice.token, sleeper.id, 10.5, 10.5], [gm.token, elf.id, 5.5, 5.5], [gm.token, kobold.id, 6.5, 5.5]]);
    const template = (await request('POST', `${base}/scenes/${sceneId}/templates`, gm.token, {shape: 'circle', x: 6, z: 6, direction: 0, sizeFeet: 20})).json();
    const done = await request('POST', `${base}/characters/${sleeper.id}/spells/${spell.id}/cast`, alice.token, {sceneId, templateId: template.id});
    assert.equal(done.statusCode, 201, done.body);
    const byName = Object.fromEntries(done.json().targets.map((entry: any) => [entry.name, entry]));
    assert.equal(byName['Эльф-разведчик'].sleep.immune, true);
    assert.equal(byName['Эльф-разведчик'].condition, false);
    assert.equal(byName['Кобольд'].condition, true);
  });
});
