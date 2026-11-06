import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('precision, parry, riposte, cutting words, sculpt spells, dark one’s blessing, elemental affinity', async t => {
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
  const gm = await register('gm_react'), alice = await register('alice_react');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'React'})).json().id;
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
  const row = async (id: string) => (await pg.query<any>('SELECT hp_current, hp_temp FROM characters WHERE id=$1', [id])).rows[0];
  const resource = async (id: string, name: string) => (await pg.query<any>('SELECT current FROM character_resources WHERE character_id=$1 AND name=$2', [id, name])).rows[0]?.current;
  const refill = (id: string, name: string, value: number) => pg.query('UPDATE character_resources SET current=$3 WHERE character_id=$1 AND name=$2', [id, name, value]);
  const entry = async (id: string) => (await pg.query<any>('SELECT reaction_used FROM initiative_entries WHERE character_id=$1', [id])).rows[0];
  const turn = (id: string) => pg.query('UPDATE initiative_entries SET action_used=false, bonus_used=false, reaction_used=false, attacks_made=0, bonus_spell=false, leveled_action_spell=false WHERE character_id=$1', [id]);
  const arena = async (name: string, members: Array<[string, string, number, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 24, heightCells: 12})).json().id;
    const scenePath = `${base}/scenes/${sceneId}`;
    for (const [token, characterId, x, z] of members) await request('POST', `${scenePath}/objects`, token, {characterId, x, z});
    for (const [, characterId, , , score] of members) {
      const id = (await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId})).json().id;
      await request('PATCH', `${scenePath}/initiative/${id}`, gm.token, {score});
    }
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    return {sceneId, scenePath};
  };
  const attack = (token: string, characterId: string, key: string, targetCharacterId: string, sceneId: string, extra: any = {}) =>
    request('POST', `${base}/rolls/check`, token, {characterId, kind: 'attack', key, targetCharacterId, sceneId, ...extra}).then(response => response.json());

  await t.test('precision attack: spends a superiority die only when it can turn a miss into a hit', async () => {
    const master = await hero('Точный', 'Воин (Мастер боевых искусств) 3', 3, {strength: 10});
    const sword = await weapon(master.id, {name: 'Меч', attackBonus: 10}, alice.token);
    await request('PUT', `${base}/characters/${master.id}/maneuvers`, alice.token, {precision: true});
    const wall = await npc('Щитоносец', {armorClass: 25, hpMax: 500, hpCurrent: 500});
    const {sceneId} = await arena('Точность', [[alice.token, master.id, 0.5, 0.5, 30], [gm.token, wall.id, 1.5, 0.5, 5]]);
    let helped: any = null;
    let hopeless: any = null;
    for (let i = 0; i < 80 && !(helped && hopeless); i++) {
      await turn(master.id);
      await refill(master.id, 'Кости превосходства', 4);
      const blow = await attack(alice.token, master.id, sword.id, wall.id, sceneId, {precision: true});
      const natural = blow.dice_results[0];
      if (blow.outcome.precision) {
        helped = blow;
        assert.ok(natural + 10 + 8 >= 25 && natural + 10 < 25, `only a near miss: ${natural}`);
        assert.ok(blow.outcome.reasons.some((reason: string) => /^точная атака \+\d$/.test(reason)));
        assert.equal(Number(await resource(master.id, 'Кости превосходства')), 3);
      } else if (natural !== 1 && natural + 10 + 8 < 25) {
        hopeless = blow;
        assert.equal(Number(await resource(master.id, 'Кости превосходства') ?? 4), 4, 'no die spent when it cannot help');
      }
    }
    assert.ok(helped && hopeless);
  });

  await t.test('parry and riposte ready: a melee hit loses the die + DEX; a melee miss is answered with a reaction attack', async () => {
    const master = await hero('Фехтовальщица', 'Воин (Мастер боевых искусств) 3', 3, {strength: 16, dexterity: 14, hpMax: 400, hpCurrent: 400});
    await weapon(master.id, {name: 'Рапира', attackBonus: 20, damageFormula: '1d8'}, alice.token);
    await request('PUT', `${base}/characters/${master.id}/maneuvers`, alice.token, {parry: true, riposte: true});
    assert.equal((await request('PUT', `${base}/characters/${master.id}/reactions`, alice.token, {parry: true})).statusCode, 200);
    const brute = await npc('Головорез', {hpMax: 400, hpCurrent: 400});
    const hammer = await weapon(brute.id, {name: 'Молот', attackBonus: 20, damageFormula: '1d1+29'});
    const clumsy = await weapon(brute.id, {name: 'Кривой нож', attackBonus: -10, damageFormula: '1d1'});
    assert.ok(clumsy.id, JSON.stringify(clumsy));
    await pg.query('UPDATE characters SET armor_class=15 WHERE id=$1', [master.id]);
    const {sceneId} = await arena('Дуэль', [[gm.token, brute.id, 0.5, 0.5, 30], [alice.token, master.id, 1.5, 0.5, 5]]);
    let blow: any = null;
    for (let i = 0; i < 10 && !blow?.damage; i++) {
      await turn(brute.id);
      blow = await attack(gm.token, brute.id, hammer.id, master.id, sceneId);
    }
    assert.ok(blow.parried, JSON.stringify(blow).slice(0, 300));
    assert.ok(blow.parried.value >= 1 + 2 && blow.parried.value <= 8 + 2);
    assert.equal(blow.damage.applied, Math.max(0, (blow.damage.roll.total ?? 0)));
    assert.match(blow.damage.roll.label, /парировано/);
    assert.equal((await entry(master.id)).reaction_used, true);
    assert.equal(Number(await resource(master.id, 'Кости превосходства')), 3);

    await pg.query('UPDATE initiative_entries SET reaction_used=false WHERE character_id=$1', [master.id]);
    await request('PUT', `${base}/characters/${master.id}/reactions`, alice.token, {parry: false, riposte: true});
    let miss: any = null;
    for (let i = 0; i < 10 && !miss?.riposte; i++) {
      await turn(brute.id);
      await pg.query('UPDATE initiative_entries SET reaction_used=false WHERE character_id=$1', [master.id]);
      miss = await attack(gm.token, brute.id, clumsy.id, master.id, sceneId);
    }
    assert.ok(miss.riposte, JSON.stringify(miss).slice(0, 300));
    assert.equal(miss.riposte.weapon, 'Рапира');
    assert.equal((await entry(master.id)).reaction_used, true);
    if (miss.riposte.hit) {
      const answer = (await pg.query<any>(`SELECT label FROM roll_log WHERE character_id=$1 AND label LIKE 'Урон: Рапира%' ORDER BY created_at DESC LIMIT 1`, [master.id])).rows[0];
      assert.match(answer.label, /ответный удар/);
    }
  });

  await t.test('cutting words ready: the bard takes a die off an enemy hit on an ally when it may turn it into a miss', async () => {
    const bard = await hero('Сказительница', 'Бард', 3, {charisma: 16});
    const knight = await hero('Рыцарь', 'Воин', 3, {armorClass: 15, hpMax: 400, hpCurrent: 400});
    assert.equal((await request('PUT', `${base}/characters/${bard.id}/reactions`, alice.token, {'cutting-words': true})).statusCode, 200);
    const orc = await npc('Орк-копейщик', {hpMax: 400, hpCurrent: 400});
    const spear = await weapon(orc.id, {name: 'Копьё', attackBonus: 0, damageFormula: '1d1'});
    const {sceneId} = await arena('Строй', [[gm.token, orc.id, 0.5, 0.5, 30], [alice.token, knight.id, 1.5, 0.5, 5], [alice.token, bard.id, 4.5, 0.5, 4]]);
    let words: any = null;
    for (let i = 0; i < 60 && !words; i++) {
      await turn(orc.id);
      await pg.query('UPDATE initiative_entries SET reaction_used=false WHERE character_id=$1', [bard.id]);
      const blow = await attack(gm.token, orc.id, spear.id, knight.id, sceneId);
      if (blow.outcome.cuttingWords) words = blow;
    }
    assert.ok(words, 'a hit of 15–19 against AC 15 — the bard answers sooner or later');
    assert.equal(words.outcome.cuttingWords.name, 'Сказительница');
    assert.ok(words.outcome.reasons.some((reason: string) => /^острое словцо \(Сказительница\) −\d$/.test(reason)));
    assert.equal((await entry(bard.id)).reaction_used, true);
    assert.ok(Number(await resource(bard.id, 'Вдохновение барда')) < 3);
  });

  await t.test('sculpt spells: an evoker’s allies in the fireball save and take nothing; another school — no', async () => {
    const wizard = await hero('Воплотитель', 'Волшебник', 5, {intelligence: 18});
    await slots(wizard.id, 3, 4);
    const fireball = await learn(wizard.id, 'fireball');
    const friend = await hero('Соратник', 'Воин', 3, {hpMax: 300, hpCurrent: 300, dexterity: 1});
    const foe = await npc('Враг-1', {hpMax: 300, hpCurrent: 300});
    const cast = (await request('POST', `${base}/characters/${wizard.id}/spells/${fireball}/cast`, alice.token, {targetIds: [friend.id, foe.id]})).json();
    const mine = cast.targets.find((entry: any) => entry.characterId === friend.id);
    assert.deepEqual([mine.sculpted, mine.save.success, mine.damage], [true, true, 0]);
    assert.ok(cast.targets.find((entry: any) => entry.characterId === foe.id).damage > 0);
    await request('PUT', `${base}/characters/${wizard.id}/subclass`, alice.token, {classId: 'wizard', subclass: 'other'});
    const plain = (await request('POST', `${base}/characters/${wizard.id}/spells/${fireball}/cast`, alice.token, {targetIds: [friend.id, foe.id]})).json();
    assert.equal(plain.targets.find((entry: any) => entry.characterId === friend.id).sculpted, undefined);
  });

  await t.test('dark one’s blessing: a fiend warlock dropping a foe gets CHA + level temporary hit points', async () => {
    const warlock = await hero('Отмеченный', 'Колдун', 3, {charisma: 16, hpMax: 30, hpCurrent: 30});
    const knife = await weapon(warlock.id, {name: 'Кинжал', attackBonus: 20}, alice.token);
    const imp = await npc('Бес', {hpMax: 1, hpCurrent: 1});
    const {sceneId} = await arena('Сделка', [[alice.token, warlock.id, 0.5, 0.5, 30], [gm.token, imp.id, 1.5, 0.5, 5]]);
    let blow: any = null;
    for (let i = 0; i < 10 && !blow?.damage; i++) {
      await turn(warlock.id);
      blow = await attack(alice.token, warlock.id, knife.id, imp.id, sceneId);
    }
    assert.deepEqual(blow.blessing, {characterId: warlock.id, name: 'Отмеченный', value: 6});
    assert.equal((await row(warlock.id)).hp_temp, 6);

    const bolt = await learn(warlock.id, 'fire-bolt');
    const imp2 = await npc('Бес-2', {hpMax: 1, hpCurrent: 1, armorClass: 1});
    await pg.query('UPDATE characters SET hp_temp=0 WHERE id=$1', [warlock.id]);
    for (let i = 0; i < 10 && (await row(imp2.id)).hp_current > 0; i++) {
      await turn(warlock.id);
      const cast = await request('POST', `${base}/characters/${warlock.id}/spells/${bolt}/cast`, alice.token, {targetIds: [imp2.id]});
      assert.equal(cast.statusCode, 201, cast.body);
    }
    assert.equal((await row(warlock.id)).hp_temp, 6, 'by a spell too');
  });

  await t.test('elemental affinity: +CHA to one damage roll of the ancestry’s type', async () => {
    const sorcerer = await hero('Драконица', 'Чародей', 6, {charisma: 18});
    const bolt = await learn(sorcerer.id, 'fire-bolt');
    const frost = await learn(sorcerer.id, 'ray-of-frost');
    const listed = (await request('GET', `${base}/characters/${sorcerer.id}/features`, alice.token)).json().features.find((entry: any) => entry.id === 'elemental-affinity');
    assert.equal(listed.detail, 'предок не выбран');
    assert.deepEqual((await request('PUT', `${base}/characters/${sorcerer.id}/draconic-ancestry`, alice.token, {red: true})).json().draconicAncestry, ['red']);
    const target = await npc('Мишень', {armorClass: 1, hpMax: 500, hpCurrent: 500});
    let fire: any = null;
    for (let i = 0; i < 10 && !fire?.damageRoll; i++) fire = (await request('POST', `${base}/characters/${sorcerer.id}/spells/${bolt}/cast`, alice.token, {targetIds: [target.id]})).json();
    assert.deepEqual(fire.affinity, {bonus: 4, damageType: 'fire'});
    assert.match(fire.damageRoll.formula, /\+4$/);
    let cold: any = null;
    for (let i = 0; i < 10 && !cold?.damageRoll; i++) cold = (await request('POST', `${base}/characters/${sorcerer.id}/spells/${frost}/cast`, alice.token, {targetIds: [target.id]})).json();
    assert.equal(cold.affinity, undefined, 'cold — not a red dragon’s fire');
  });
});
