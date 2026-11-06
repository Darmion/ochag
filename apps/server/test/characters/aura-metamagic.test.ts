import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('aura of protection, reckless attack, danger sense, metamagic, arcane recovery, NPC dispels enemy buffs', async t => {
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
  const gm = await register('gm_aura'), alice = await register('alice_aura');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Aura'})).json().id;
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
  const slots = (characterId: string, level: number, current: number, max = current) =>
    pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,$3,$4,$5)', [campaignId, characterId, level, current, max]);
  const effect = async (id: string, code: string) => (await pg.query<any>('SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code=$2 AND active', [id, code])).rows[0]?.parameters ?? null;
  const lastRoll = async (id: string) => (await pg.query<any>('SELECT modifier, outcome FROM roll_log WHERE character_id=$1 ORDER BY created_at DESC LIMIT 1', [id])).rows[0];
  const entry = async (id: string) => (await pg.query<any>('SELECT action_used, bonus_used, reaction_used FROM initiative_entries WHERE character_id=$1', [id])).rows[0];
  const points = async (id: string) => (await pg.query<any>(`SELECT current FROM character_resources WHERE character_id=$1 AND name='Очки чародейства'`, [id])).rows[0]?.current;
  const place = async (name: string, members: Array<[string, string, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 24, heightCells: 12})).json().id;
    for (const [token, characterId, x, z] of members) await request('POST', `${base}/scenes/${sceneId}/objects`, token, {characterId, x, z});
    return sceneId as string;
  };
  const arena = async (name: string, members: Array<[string, string, number, number, number]>) => {
    const sceneId = await place(name, members.map(([token, id, x, z]) => [token, id, x, z]));
    const scenePath = `${base}/scenes/${sceneId}`;
    for (const [, characterId, , , score] of members) {
      const id = (await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId})).json().id;
      await request('PATCH', `${scenePath}/initiative/${id}`, gm.token, {score});
    }
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    return {sceneId, scenePath, auto: async () => (await request('POST', `${scenePath}/initiative/auto`, gm.token, {advance: false})).json()};
  };
  const saveAgainst = (targetId: string, ability: string) =>
    request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [targetId], code: 'poisoned', save: {ability, dc: 1}});

  await t.test('aura of protection: +CHA to the paladin and allies within 10 feet, not further, not while the paladin is down', async () => {
    const paladin = await hero('Паладин', 'Паладин', 6, {charisma: 16, wisdom: 10});
    const near = await hero('Рядом', 'Воин', 3, {wisdom: 10});
    const far = await hero('Далеко', 'Воин', 3, {wisdom: 10});
    const sceneId = await place('Аура', [[alice.token, paladin.id, 0.5, 0.5], [alice.token, near.id, 2.5, 0.5], [alice.token, far.id, 6.5, 0.5]]);
    for (const [who, bonus] of [[paladin, 3], [near, 3], [far, 0]] as const) {
      assert.equal((await saveAgainst(who.id, 'wisdom')).statusCode, 200);
      const roll = await lastRoll(who.id);
      assert.equal(roll.modifier, bonus, who.name);
      assert.equal((roll.outcome.reasons ?? []).some((reason: string) => /аура защиты/.test(reason)), bonus > 0, JSON.stringify(roll.outcome));
    }
    assert.match((await lastRoll(near.id)).outcome.reasons.join(), /аура защиты \(Паладин\) \+3/);
    const own = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: near.id, kind: 'save', key: 'wisdom', sceneId})).json();
    assert.equal(own.modifier, 3);
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code) VALUES ($1,$2,'unconscious')`, [campaignId, paladin.id]);
    await saveAgainst(near.id, 'wisdom');
    assert.equal((await lastRoll(near.id)).modifier, 0, 'the paladin is unconscious — no aura');
    const features = (await request('GET', `${base}/characters/${paladin.id}/features`, alice.token)).json();
    assert.match(features.features.find((entry: any) => entry.id === 'aura-of-protection').detail, /\+3 к спасброскам — вы и союзники в 10 фт\./);
  });

  await t.test('danger sense: DEX saves with advantage unless blinded', async () => {
    const barbarian = await hero('Чуткий', 'Варвар', 2, {dexterity: 10});
    await saveAgainst(barbarian.id, 'dexterity');
    let roll = await lastRoll(barbarian.id);
    assert.equal(roll.outcome.advantage, 'adv');
    assert.ok(roll.outcome.reasons.includes('преимущество: опасное чутьё'));
    await saveAgainst(barbarian.id, 'wisdom');
    assert.equal((await lastRoll(barbarian.id)).outcome.advantage, 'none', 'only Dexterity');
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code) VALUES ($1,$2,'blinded')`, [campaignId, barbarian.id]);
    await saveAgainst(barbarian.id, 'dexterity');
    roll = await lastRoll(barbarian.id);
    assert.ok(!(roll.outcome.reasons ?? []).includes('преимущество: опасное чутьё'), 'blinded — no danger sense');
  });

  await t.test('reckless attack: before the first attack — own STR melee with advantage, attacks against with advantage; the NPC barbarian rages and attacks recklessly', async () => {
    const barbarian = await hero('Безрассудный', 'Варвар', 2, {strength: 16, hpMax: 300, hpCurrent: 300});
    const axe = await weapon(barbarian.id, {name: 'Секира', damageFormula: '1d12'}, alice.token);
    const orc = await npc('Орк-рубака', {hpMax: 300, hpCurrent: 300});
    const club = await weapon(orc.id, {name: 'Дубина'});
    const {sceneId} = await arena('Сеча', [[alice.token, barbarian.id, 0.5, 0.5, 30], [gm.token, orc.id, 1.5, 0.5, 5]]);
    const go = await request('POST', `${base}/characters/${barbarian.id}/features/reckless-attack`, alice.token, {sceneId});
    assert.equal(go.statusCode, 200, go.body);
    assert.deepEqual((await effect(barbarian.id, 'reckless')).expires, {at: 'start', of: barbarian.id});
    assert.match((await request('POST', `${base}/characters/${barbarian.id}/features/reckless-attack`, alice.token, {sceneId})).json().message, /уже/);
    const blow = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: barbarian.id, kind: 'attack', key: axe.id, targetCharacterId: orc.id, sceneId})).json();
    assert.equal(blow.outcome.advantage, 'adv');
    assert.ok(blow.outcome.reasons.includes('преимущество: безрассудная атака'));
    await request('POST', `${base}/characters/${orc.id}/effects`, gm.token, {effectCode: 'readied'});
    const back = (await request('POST', `${base}/rolls/check`, gm.token, {characterId: orc.id, kind: 'attack', key: club.id, targetCharacterId: barbarian.id, sceneId, using: 'reaction'})).json();
    assert.equal(back.outcome.advantage, 'adv');
    assert.ok(back.outcome.reasons.includes('преимущество: цель атакует безрассудно'));

    const berserk = await npc('Берсерк-2', {strength: 16, level: 3});
    await classed(berserk.id, 'Варвар 3');
    await weapon(berserk.id, {name: 'Секира', damageFormula: '1d12+3'});
    const target = await hero('Мишень', 'Воин', 3, {hpMax: 400, hpCurrent: 400});
    const fight = await arena('Ярость-2', [[gm.token, berserk.id, 0.5, 0.5, 30], [alice.token, target.id, 1.5, 0.5, 5]]);
    const turn = await fight.auto();
    assert.match(turn.summary, /впадает в ярость( \(бешенство\))?; атакует безрассудно/, turn.summary);
    assert.ok(await effect(berserk.id, 'reckless'));
  });

  await t.test('metamagic: quickened spends the bonus action and 2 points, twinned adds a second target for the slot level; one-creature spells take one target', async () => {
    const sorcerer = await hero('Чародейка', 'Чародей', 3, {charisma: 16});
    const bolt = await learn(sorcerer.id, 'fire-bolt');
    const word = await learn(sorcerer.id, 'healing-word');
    const fireball = await learn(sorcerer.id, 'fireball');
    await slots(sorcerer.id, 1, 4);
    await slots(sorcerer.id, 3, 1);
    const a = await npc('Манекен А', {armorClass: 1});
    const b = await npc('Манекен Б', {armorClass: 1});
    const {sceneId} = await arena('Полигон', [[alice.token, sorcerer.id, 0.5, 0.5, 30], [gm.token, a.id, 3.5, 0.5, 5], [gm.token, b.id, 3.5, 2.5, 4]]);
    const cast = (spell: string, body: any) => request('POST', `${base}/characters/${sorcerer.id}/spells/${spell}/cast`, alice.token, {sceneId, ...body});
    assert.match((await cast(bolt, {targetIds: [a.id], metamagic: 'quickened'})).json().message, /не отмечено/);
    const marked = await request('PUT', `${base}/characters/${sorcerer.id}/metamagic`, alice.token, {quickened: true, twinned: true});
    assert.deepEqual(marked.json().metamagic, ['quickened', 'twinned']);
    assert.match((await cast(bolt, {targetIds: [a.id, b.id]})).json().message, /на одно существо/);

    const quick = await cast(bolt, {targetIds: [a.id], metamagic: 'quickened'});
    assert.equal(quick.statusCode, 201, quick.body);
    assert.deepEqual(quick.json().metamagic, {id: 'quickened', name: 'Ускоренное заклинание', cost: 2, left: 1});
    assert.deepEqual([(await entry(sorcerer.id)).bonus_used, (await entry(sorcerer.id)).action_used], [true, false]);
    assert.match((await cast(word, {targetIds: [sorcerer.id], metamagic: 'quickened'})).json().message, /действием/);

    const twin = await cast(bolt, {targetIds: [a.id, b.id], metamagic: 'twinned'});
    assert.equal(twin.statusCode, 201, twin.body);
    assert.equal(twin.json().metamagic.cost, 1, 'a cantrip — 1 point');
    assert.deepEqual(twin.json().targets.map((entry: any) => entry.characterId).sort(), [a.id, b.id].sort());
    assert.equal(await points(sorcerer.id), 0);
    await pg.query(`UPDATE character_resources SET current=5 WHERE character_id=$1 AND name='Очки чародейства'`, [sorcerer.id]);
    await pg.query('UPDATE initiative_entries SET action_used=false, bonus_used=false, bonus_spell=false WHERE character_id=$1', [sorcerer.id]);
    assert.match((await cast(fireball, {targetIds: [a.id, b.id], metamagic: 'twinned'})).json().message, /не удвоить/);
    assert.match((await cast(bolt, {targetIds: [a.id], metamagic: 'twinned'})).json().message, /ровно две цели/);
    const features = (await request('GET', `${base}/characters/${sorcerer.id}/features`, alice.token)).json();
    const meta = features.features.find((entry: any) => entry.id === 'metamagic');
    assert.deepEqual([meta.resource.current, meta.choices.filter((choice: any) => choice.active).map((choice: any) => choice.value)], [5, ['quickened', 'twinned']]);
  });

  await t.test('arcane recovery: out of combat, once until a long rest, spent slots up to half the wizard level', async () => {
    const wizard = await hero('Волшебница', 'Волшебник', 5, {intelligence: 16});
    await slots(wizard.id, 1, 1, 4);
    await slots(wizard.id, 2, 1, 3);
    const recover = (body: any) => request('POST', `${base}/characters/${wizard.id}/features/arcane-recovery`, alice.token, body);
    const rested = await request('POST', `${base}/characters/${wizard.id}/rest`, alice.token, {kind: 'short'});
    assert.match(rested.json().summary, /можно «Арканное восстановление»/, rested.body);
    const listed = (await request('GET', `${base}/characters/${wizard.id}/features`, alice.token)).json().features.find((entry: any) => entry.id === 'arcane-recovery');
    assert.equal(listed.limit, 3);
    assert.deepEqual(listed.choices.map((choice: any) => [choice.value, choice.count]), [['1', 3], ['2', 2]]);
    assert.match((await recover({slots: [2, 2]})).json().message, /больше 3/);
    const done = await recover({slots: [2, 1]});
    assert.equal(done.statusCode, 200, done.body);
    assert.match(done.json().message, /вернулись ячейки 1 ур\., 2 ур\./);
    const left = (await pg.query<any>('SELECT level, current FROM character_spell_slots WHERE character_id=$1 ORDER BY level', [wizard.id])).rows;
    assert.deepEqual(left.map(row => row.current), [2, 2]);
    assert.match((await recover({slots: [1]})).json().message, /потрачено/);
    await request('POST', `${base}/characters/${wizard.id}/rest`, alice.token, {kind: 'long'});
    const foe = await npc('Враг');
    await arena('Бой мага', [[alice.token, wizard.id, 0.5, 0.5, 30], [gm.token, foe.id, 5.5, 0.5, 5]]);
    await pg.query('UPDATE character_spell_slots SET current=0 WHERE character_id=$1', [wizard.id]);
    assert.match((await recover({slots: [1]})).json().message, /вне боя/);
  });

  await t.test('an NPC caster dispels an enemy buff held by concentration', async () => {
    const mage = await npc('Разрушитель чар', {intelligence: 16, level: 5});
    await slots(mage.id, 3, 2);
    await learn(mage.id, 'dispel-magic');
    await weapon(mage.id, {name: 'Кинжал'});
    const cleric = await hero('Жрец-хранитель', 'Жрец', 3, {hpMax: 300, hpCurrent: 300});
    const blessedOne = await hero('Благословлённый', 'Воин', 3, {hpMax: 300, hpCurrent: 300});
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'concentration','{"spellName":"Благословение"}')`, [campaignId, cleric.id]);
    await pg.query(
      `INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'blessed',$3::jsonb)`,
      [campaignId, blessedOne.id, JSON.stringify({spellLevel: 1, die: 4, sourceCharacterId: cleric.id, sourceName: 'Благословение', concentrationOf: cleric.id})],
    );
    const {auto} = await arena('Чары', [[gm.token, mage.id, 0.5, 0.5, 30], [alice.token, blessedOne.id, 1.5, 0.5, 10], [alice.token, cleric.id, 8.5, 0.5, 5]]);
    const turn = await auto();
    assert.match(turn.summary, /творит «[^»]+» на «Благословлённый»: рассеяно: Благословение/, turn.summary);
    assert.equal(await effect(blessedOne.id, 'blessed'), null);
    assert.equal(await effect(cleric.id, 'concentration'), null, 'the cleric loses concentration');
  });
});
