import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('early rage end, persistent rage, primal champion, superior inspiration, perfect self, eldritch master', async t => {
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
  const gm = await register('gm_capstone'), alice = await register('alice_capstone');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Capstones'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const hero = async (name: string, className: string, level: number, extra: any = {}) => {
    const made = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 300, hpCurrent: 300, level, speedFeet: 30, ...extra})).json();
    await pg.query('UPDATE characters SET class_name=$2 WHERE id=$1', [made.id, className]);
    return made;
  };
  const npc = async (name: string) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 1000, hpCurrent: 1000, armorClass: 1, speedFeet: 30,
  })).json();
  const codes = async (id: string) => (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active', [id])).rows.map(row => row.effect_code as string);
  const rage = async (id: string) => (await pg.query<any>(`SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code='raging' AND active`, [id])).rows[0]?.parameters ?? null;
  const resource = async (id: string, name: string) => (await pg.query<any>('SELECT current, max FROM character_resources WHERE character_id=$1 AND name=$2', [id, name])).rows[0] ?? null;
  const giveResource = (id: string, name: string, current: number, max: number, recharge = 'long') => pg.query(
    'INSERT INTO character_resources (campaign_id, character_id, name, current, max, recharge) VALUES ($1,$2,$3,$4,$5,$6)', [campaignId, id, name, current, max, recharge],
  );
  const hurt = async (characterId: string, amount: number) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: `1d1+${amount - 1}`})).json();
    const applied = await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId, mode: 'damage'});
    assert.equal(applied.statusCode, 200, applied.body);
  };
  const arena = async (name: string, members: Array<[string, string, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 24, heightCells: 12})).json().id as string;
    const scenePath = `${base}/scenes/${sceneId}`;
    for (const [token, characterId, x] of members) await request('POST', `${scenePath}/objects`, token, {characterId, x, z: 0.5});
    let score = 30;
    for (const [, characterId] of members) {
      const id = (await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId})).json().id;
      await request('PATCH', `${scenePath}/initiative/${id}`, gm.token, {score: score--});
    }
    const advance = async () => {
      const done = await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
      assert.equal(done.statusCode, 204, done.body);
    };
    await advance();
    return {sceneId, advance};
  };

  await t.test('rage ends early when a turn passes without an attack or damage; an attack or a hit keeps it', async () => {
    const barbarian = await hero('Ярый', 'Варвар', 3, {strength: 16});
    const axe = (await request('POST', `${base}/characters/${barbarian.id}/weapons`, alice.token, {name: 'Секира', ability: 'strength', proficient: true, attackBonus: 20, damageFormula: '1d1'})).json();
    const foe = await npc('Пень');
    const {sceneId, advance} = await arena('Ярость', [[alice.token, barbarian.id, 0.5], [gm.token, foe.id, 1.5]]);

    assert.equal((await request('POST', `${base}/characters/${barbarian.id}/features/rage`, alice.token, {sceneId})).statusCode, 200);
    assert.equal((await rage(barbarian.id)).kept, true, 'the turn of raging counts');
    await advance();
    assert.equal((await rage(barbarian.id)).kept, false);
    assert.equal((await rage(barbarian.id)).remainingRounds, 9);
    await advance();
    await advance();
    assert.ok(!(await codes(barbarian.id)).includes('raging'), 'no attack and no damage since the last turn — the rage is over');

    await advance();
    assert.equal((await request('POST', `${base}/characters/${barbarian.id}/features/rage`, alice.token, {sceneId})).statusCode, 200);
    await advance();
    await advance();
    const swing = await request('POST', `${base}/rolls/check`, alice.token, {characterId: barbarian.id, kind: 'attack', key: axe.id, targetCharacterId: foe.id, sceneId});
    assert.equal(swing.statusCode, 201, swing.body);
    assert.equal((await rage(barbarian.id)).kept, true, 'an attack keeps the rage');
    await advance();
    assert.ok((await codes(barbarian.id)).includes('raging'), 'attacked this turn — still raging');

    await hurt(barbarian.id, 5);
    assert.equal((await rage(barbarian.id)).kept, true, 'damage keeps the rage');
    await advance();
    await advance();
    assert.ok((await codes(barbarian.id)).includes('raging'), 'took damage since the last turn — still raging');
    await advance();
    await advance();
    assert.ok(!(await codes(barbarian.id)).includes('raging'), 'then a quiet turn ends it');
  });

  await t.test('persistent rage (barbarian 15): quiet turns do not end it, the minute does', async () => {
    const barbarian = await hero('Неудержимый', 'Варвар', 15, {strength: 18});
    const foe = await npc('Камень');
    const {sceneId, advance} = await arena('Неудержимость', [[alice.token, barbarian.id, 0.5], [gm.token, foe.id, 1.5]]);
    const features = (await request('GET', `${base}/characters/${barbarian.id}/features`, alice.token)).json().features.map((entry: any) => entry.id);
    assert.ok(features.includes('persistent-rage'));
    assert.equal((await request('POST', `${base}/characters/${barbarian.id}/features/rage`, alice.token, {sceneId})).statusCode, 200);
    for (let round = 0; round < 4; round++) {
      await advance();
      await advance();
    }
    assert.ok((await codes(barbarian.id)).includes('raging'), 'four quiet rounds — the rage goes on');
    assert.equal((await rage(barbarian.id)).remainingRounds, 6);
  });

  await t.test('primal champion: reaching barbarian 20 adds 4 to STR and CON (up to 24) and the CON hit points', async () => {
    const barbarian = await hero('Чемпион', 'Варвар', 19, {strength: 20, constitution: 18, hpMax: 250, hpCurrent: 250});
    const up = await request('POST', `${base}/characters/${barbarian.id}/level-up`, gm.token, {hp: 'average', milestone: true});
    assert.equal(up.statusCode, 201, up.body);
    const row = (await pg.query<any>('SELECT level, strength, constitution, hp_max FROM characters WHERE id=$1', [barbarian.id])).rows[0];
    assert.equal(row.level, 20);
    assert.equal(row.strength, 24);
    assert.equal(row.constitution, 22);
    assert.equal(row.hp_max, 250 + 11 + 40);
    const features = (await request('GET', `${base}/characters/${barbarian.id}/features`, alice.token)).json().features.map((entry: any) => entry.id);
    assert.ok(features.includes('primal-champion'));

    const fighter = await hero('Воин', 'Воин', 19, {strength: 20});
    await request('POST', `${base}/characters/${fighter.id}/level-up`, gm.token, {hp: 'average', milestone: true});
    assert.equal((await pg.query<any>('SELECT strength FROM characters WHERE id=$1', [fighter.id])).rows[0].strength, 20, 'only the barbarian');
  });

  await t.test('superior inspiration and perfect self: an empty pool refills on initiative, a non-empty one stays', async () => {
    const bard = await hero('Скальд', 'Бард', 20, {charisma: 16});
    const monk = await hero('Мастер', 'Монах', 20, {wisdom: 16});
    const young = await hero('Ученик', 'Бард', 19, {charisma: 16});
    await giveResource(bard.id, 'Вдохновение барда', 0, 3, 'short');
    await giveResource(monk.id, 'Ци', 0, 20, 'short');
    await giveResource(young.id, 'Вдохновение барда', 0, 3, 'short');
    const foe = await npc('Кукла');
    await arena('Инициатива', [[alice.token, bard.id, 0.5], [alice.token, monk.id, 1.5], [alice.token, young.id, 2.5], [gm.token, foe.id, 3.5]]);
    assert.equal((await resource(bard.id, 'Вдохновение барда')).current, 1);
    assert.equal((await resource(monk.id, 'Ци')).current, 4);
    assert.equal((await resource(young.id, 'Вдохновение барда')).current, 0, 'bard 19 — no superior inspiration');
    const note = (await pg.query<any>(`SELECT outcome FROM roll_log WHERE character_id=$1 AND label LIKE 'Инициатива%' ORDER BY created_at DESC LIMIT 1`, [bard.id])).rows[0].outcome;
    assert.ok(note.reasons.some((reason: string) => /превосходное вдохновение/.test(reason)), JSON.stringify(note));

    await pg.query(`UPDATE character_resources SET current=2 WHERE character_id=$1 AND name='Вдохновение барда'`, [bard.id]);
    await pg.query('DELETE FROM initiative_entries WHERE character_id=$1', [bard.id]);
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Снова', widthCells: 8, heightCells: 8})).json().id;
    await request('POST', `${base}/scenes/${sceneId}/objects`, alice.token, {characterId: bard.id, x: 0.5, z: 0.5});
    assert.equal((await request('POST', `${base}/scenes/${sceneId}/initiative/join`, alice.token, {characterId: bard.id})).statusCode, 201);
    assert.equal((await resource(bard.id, 'Вдохновение барда')).current, 2, 'not empty — nothing added');
  });

  await t.test('eldritch master: out of combat, a minute brings the pact slots back, once per long rest', async () => {
    const warlock = await hero('Колдун', 'Колдун', 20, {charisma: 20});
    await pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,5,1,4)', [campaignId, warlock.id]);
    const minutes = async () => Number((await pg.query<any>('SELECT world_minutes FROM campaigns WHERE id=$1', [campaignId])).rows[0].world_minutes);
    const listed = (await request('GET', `${base}/characters/${warlock.id}/features`, alice.token)).json().features.find((entry: any) => entry.id === 'eldritch-master');
    assert.equal(listed.available, true, JSON.stringify(listed));
    assert.match(listed.detail, /потрачено: 3/);
    const before = await minutes();
    const used = await request('POST', `${base}/characters/${warlock.id}/features/eldritch-master`, alice.token, {});
    assert.equal(used.statusCode, 200, used.body);
    assert.match(used.json().message, /ячейки договора вернулись/);
    assert.equal((await pg.query<any>('SELECT current FROM character_spell_slots WHERE character_id=$1 AND level=5', [warlock.id])).rows[0].current, 4);
    assert.equal((await resource(warlock.id, 'Мастер таинств')).current, 0);
    assert.equal(await minutes(), before + 1, 'a minute of entreaty');

    const whole = await request('POST', `${base}/characters/${warlock.id}/features/eldritch-master`, alice.token, {});
    assert.equal(whole.statusCode, 400);
    assert.match(whole.body, /и так целы/);
    await pg.query('UPDATE character_spell_slots SET current=0 WHERE character_id=$1', [warlock.id]);
    const twice = await request('POST', `${base}/characters/${warlock.id}/features/eldritch-master`, alice.token, {});
    assert.equal(twice.statusCode, 400);
    assert.match(twice.body, /потрачено — восстановится после долгого/);

    await pg.query(`UPDATE character_resources SET current=1 WHERE character_id=$1 AND name='Мастер таинств'`, [warlock.id]);
    const foe = await npc('Демон');
    await arena('Бой', [[alice.token, warlock.id, 0.5], [gm.token, foe.id, 1.5]]);
    const inFight = await request('POST', `${base}/characters/${warlock.id}/features/eldritch-master`, alice.token, {});
    assert.equal(inFight.statusCode, 400);
    assert.match(inFight.body, /вне боя/);

    const young = await hero('Подмастерье', 'Колдун', 19, {charisma: 20});
    assert.equal((await request('POST', `${base}/characters/${young.id}/features/eldritch-master`, alice.token, {})).statusCode, 400, 'warlock 19 — not yet');
  });
});
