import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('inspiration everywhere, bestiary multiattack, legendary actions', async t => {
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
  const gm = await register('gm_legend'), alice = await register('alice_legend');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Legend'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const create = async (token: string, body: any) => (await request('POST', `${base}/characters`, token, body)).json();
  const learn = async (characterId: string, srdIndex: string) => {
    const made = await request('POST', `${base}/characters/${characterId}/spells`, gm.token, {source: 'srd', srdIndex});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const inspire = (id: string) => request('POST', `${base}/characters/${id}/inspiration`, gm.token, {inspired: true});
  const inspired = async (id: string) => (await pg.query<any>('SELECT inspiration FROM characters WHERE id=$1', [id])).rows[0].inspiration as boolean;
  const hp = async (id: string) => (await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current as number;
  const weapon = (id: string, body: any) => request('POST', `${base}/characters/${id}/weapons`, gm.token, {ability: 'strength', proficient: false, ...body});
  const arena = async (name: string, members: Array<[string, string, number, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 20, heightCells: 10})).json().id;
    const scenePath = `${base}/scenes/${sceneId}`;
    for (const [token, characterId, x, z] of members) await request('POST', `${scenePath}/objects`, token, {characterId, x, z});
    const entries: Record<string, string> = {};
    for (const [, characterId, , , score] of members) {
      const id = (await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId})).json().id;
      await request('PATCH', `${scenePath}/initiative/${id}`, gm.token, {score});
      entries[characterId] = id;
    }
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    return {sceneId, scenePath, entries};
  };

  await t.test('inspiration on a spell attack: advantage on the roll, spent once; not on a saving-throw spell', async () => {
    const mage = await create(alice.token, {kind: 'character', name: 'Ирма', intelligence: 16, hpMax: 20, hpCurrent: 20});
    const bolt = await learn(mage.id, 'fire-bolt');
    const flame = await learn(mage.id, 'sacred-flame');
    const dummy = await create(gm.token, {kind: 'npc', name: 'Чучело', disposition: 'hostile', hpMax: 200, hpCurrent: 200});
    await inspire(mage.id);
    const cast = (entry: string, extra: any = {}) => request('POST', `${base}/characters/${mage.id}/spells/${entry}/cast`, alice.token, {targetIds: [dummy.id], ...extra});

    const refused = await cast(flame, {inspiration: true});
    assert.equal(refused.statusCode, 400);
    assert.match(refused.json().message, /нет броска атаки/);
    assert.equal(await inspired(mage.id), true, 'still there');

    const done = await cast(bolt, {inspiration: true});
    assert.equal(done.statusCode, 201, done.body);
    assert.equal(done.json().inspiration, true);
    assert.equal(await inspired(mage.id), false);
    const rolls = (await request('GET', `${base}/rolls`, gm.token)).json();
    const attack = (rolls.rolls ?? rolls).find((roll: any) => /Заклинание: .* → Чучело/.test(roll.label));
    assert.ok(attack.outcome.reasons.includes('преимущество: вдохновение'), JSON.stringify(attack.outcome));
    assert.equal(attack.dice_results.length, 2);

    const again = await cast(bolt, {inspiration: true});
    assert.equal(again.statusCode, 400);
    assert.match(again.json().message, /нет вдохновения/);
  });

  await t.test('inspiration on a death save: two dice, the better one', async () => {
    const hero = await create(alice.token, {kind: 'character', name: 'Тиль', hpMax: 20, hpCurrent: 20});
    await pg.query('UPDATE characters SET hp_current=0 WHERE id=$1', [hero.id]);
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'unconscious','{"source":"hp"}')`, [campaignId, hero.id]);
    await inspire(hero.id);
    const save = await request('POST', `${base}/characters/${hero.id}/death-save`, alice.token, {inspiration: true});
    assert.equal(save.statusCode, 200, save.body);
    const roll = save.json().roll;
    assert.equal(roll.formula, '2d20adv');
    assert.equal(roll.dice_results.length, 2);
    assert.equal(roll.total, Math.max(...roll.dice_results));
    assert.equal(await inspired(hero.id), false);
    const plain = await request('POST', `${base}/characters/${hero.id}/death-save`, alice.token, {inspiration: true});
    assert.ok([400].includes(plain.statusCode), 'no inspiration left (or no longer dying)');
  });

  await t.test('multiattack by the bestiary text: a bite and two claws, each with its own weapon', async () => {
    const troll = await create(gm.token, {kind: 'npc', name: 'Тролль', disposition: 'hostile', strength: 18, hpMax: 84, hpCurrent: 84});
    await pg.query(
      `UPDATE characters SET attacks_per_action=3, sheet_extra = jsonb_set(sheet_extra, '{text}', $2::jsonb) WHERE id=$1`,
      [troll.id, JSON.stringify({actions: {name: 'Действия', value: 'Мультиатака. Совершает три атаки: одну укусом и две когтями.\n\nУкус. Рукопашная атака…'}})],
    );
    await weapon(troll.id, {name: 'Укус', attackBonus: 20, damageFormula: '1d6+4'});
    await weapon(troll.id, {name: 'Коготь', attackBonus: 20, damageFormula: '2d6+4'});
    const hero = await create(alice.token, {kind: 'character', name: 'Борн', hpMax: 300, hpCurrent: 300});
    const {scenePath} = await arena('Тролль', [[gm.token, troll.id, 0.5, 0.5, 30], [alice.token, hero.id, 1.5, 0.5, 5]]);
    const result = (await request('POST', `${scenePath}/initiative/auto`, gm.token, {advance: false})).json();
    assert.deepEqual(result.attacks.map((done: any) => done.weaponName), ['Укус', 'Коготь', 'Коготь'], result.summary);
    assert.match(result.summary, /атакует — Укус: «Борн» .*, Коготь: «Борн» .*, Коготь: «Борн»/);
    assert.ok(await hp(hero.id) < 300);
  });

  await t.test('«the second one with disadvantage»', async () => {
    const boss = await create(gm.token, {kind: 'npc', name: 'Вожак', disposition: 'hostile', hpMax: 30, hpCurrent: 30});
    await pg.query(
      `UPDATE characters SET attacks_per_action=2, sheet_extra = jsonb_set(sheet_extra, '{text}', $2::jsonb) WHERE id=$1`,
      [boss.id, JSON.stringify({actions: {name: 'Действия', value: 'Мультиатака. Совершает две атаки скимитаром; вторая — с помехой.'}})],
    );
    await weapon(boss.id, {name: 'Скимитар', ability: 'dexterity', attackBonus: 10, damageFormula: '1d6'});
    const hero = await create(alice.token, {kind: 'character', name: 'Ульф', hpMax: 300, hpCurrent: 300});
    const {scenePath} = await arena('Вожак', [[gm.token, boss.id, 0.5, 0.5, 30], [alice.token, hero.id, 1.5, 0.5, 5]]);
    const result = (await request('POST', `${scenePath}/initiative/auto`, gm.token, {advance: false})).json();
    assert.equal(result.attacks.length, 2, result.summary);
    assert.notEqual(result.attacks[0].outcome.requested, 'disadv');
    assert.equal(result.attacks[1].outcome.requested, 'disadv');
  });

  await t.test('legendary actions: at the end of a foe’s turn the boss strikes by itself; off by the flag; a click strikes too', async () => {
    const dragon = await create(gm.token, {kind: 'npc', name: 'Дракон', disposition: 'hostile', strength: 20, hpMax: 200, hpCurrent: 200});
    await weapon(dragon.id, {name: 'Хвост', attackBonus: 20, damageFormula: '1d4+10'});
    const boss = await request('PUT', `${base}/characters/${dragon.id}/boss`, gm.token, {
      legendaryActions: 3,
      options: [
        {name: 'Перемещение', cost: 1, text: 'Перемещается на половину скорости, не провоцируя атак при уходе.'},
        {name: 'Удар хвостом', cost: 1, text: 'Совершает атаку хвостом.'},
      ],
      phases: [],
    });
    assert.equal(boss.statusCode, 200, boss.body);
    const first = await create(alice.token, {kind: 'character', name: 'Кая', hpMax: 300, hpCurrent: 300});
    const second = await create(alice.token, {kind: 'character', name: 'Лот', hpMax: 300, hpCurrent: 300});
    const {scenePath, entries} = await arena('Логово', [
      [alice.token, first.id, 1.5, 0.5, 20], [alice.token, second.id, 8.5, 5.5, 15], [gm.token, dragon.id, 0.5, 0.5, 10],
    ]);
    const used = async () => (await pg.query<any>('SELECT legendary_used FROM initiative_entries WHERE id=$1', [entries[dragon.id]])).rows[0].legendary_used as number;
    const strikes = async () => (await pg.query<any>(`SELECT outcome->'target'->>'name' AS target FROM roll_log WHERE character_id=$1 AND outcome->>'kind'='attack' ORDER BY created_at`, [dragon.id])).rows.map(row => row.target as string);
    const lastChat = async () => (await pg.query<any>(`SELECT body FROM chat_messages WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 1`, [campaignId])).rows[0]?.body ?? '';

    const ended = await request('POST', `${scenePath}/initiative/advance`, alice.token, {});
    assert.equal(ended.statusCode, 204, ended.body);
    assert.deepEqual(await strikes(), ['Кая'], 'the tail went for the one in reach');
    assert.equal(await hp(second.id), 300, 'Lot is far away');
    assert.match(await lastChat(), /Легендарное действие: Удар хвостом/);
    assert.equal(await used(), 0, 'regained at the start of its own turn');

    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    assert.equal((await strikes()).length, 1);

    await request('POST', `${scenePath}/initiative/advance`, gm.token, {entryId: entries[second.id]});
    assert.equal(await used(), 1);
    assert.deepEqual(await strikes(), ['Кая', 'Кая']);

    await request('POST', `${base}/rules`, gm.token, {key: 'auto_legendary', kind: 'flag', label: 'Легендарные сами', value: false});
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {entryId: entries[first.id]});
    assert.equal((await strikes()).length, 2, 'the flag is off');

    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    const clicked = await request('POST', `${scenePath}/initiative/${entries[dragon.id]}/legendary`, gm.token, {option: 1});
    assert.equal(clicked.statusCode, 200, clicked.body);
    assert.equal(clicked.json().attacks.length, 1);
    assert.match(clicked.json().summary, /Хвост → «Кая»/);
    const moved = await request('POST', `${scenePath}/initiative/${entries[dragon.id]}/legendary`, gm.token, {option: 0});
    assert.equal(moved.statusCode, 200, moved.body);
    assert.equal(moved.json().attacks, undefined, 'moving is not an attack');
  });
});
