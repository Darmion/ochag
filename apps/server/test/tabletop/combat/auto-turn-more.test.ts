import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('NPC auto turn: multiattack, area spells, healing', async t => {
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
  const gm = await register('gm_auto2'), alice = await register('alice_auto2');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Auto 2'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const create = async (token: string, body: any) => (await request('POST', `${base}/characters`, token, body)).json();
  const learn = async (characterId: string, srdIndex: string) => {
    const made = await request('POST', `${base}/characters/${characterId}/spells`, gm.token, {source: 'srd', srdIndex});
    assert.equal(made.statusCode, 201, made.body);
  };
  const slots = (characterId: string, level: number, count: number) =>
    pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,$3,$4,$4)', [campaignId, characterId, level, count]);

  const arena = async (name: string, members: Array<[string, string, number, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 20, heightCells: 10})).json().id;
    const scenePath = `${base}/scenes/${sceneId}`;
    for (const [token, characterId, x, z] of members) await request('POST', `${scenePath}/objects`, token, {characterId, x, z});
    for (const [, characterId, , , score] of members) {
      const id = (await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId})).json().id;
      await request('PATCH', `${scenePath}/initiative/${id}`, gm.token, {score});
    }
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    return {
      scenePath,
      auto: async () => {
        await pg.query('UPDATE initiative_entries SET action_used=false, bonus_used=false, attacks_made=0, leveled_action_spell=false, bonus_spell=false, moved_feet=0, dashes=0 WHERE scene_id=$1 AND is_current', [sceneId]);
        const response = await request('POST', `${scenePath}/initiative/auto`, gm.token, {advance: false});
        assert.equal(response.statusCode, 200, response.body);
        return response.json();
      },
    };
  };
  const hp = async (id: string) => (await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current as number;

  await t.test('multiattack: as many attacks as the action holds; a fallen target — the next one in reach', async () => {
    const ogre = await create(gm.token, {kind: 'npc', name: 'Огр', disposition: 'hostile', strength: 18, hpMax: 60, hpCurrent: 60});
    await pg.query('UPDATE characters SET attacks_per_action=3 WHERE id=$1', [ogre.id]);
    await request('POST', `${base}/characters/${ogre.id}/weapons`, gm.token, {name: 'Дубина', ability: 'strength', proficient: false, attackBonus: 20, damageFormula: '1d4+20'});
    const weak = await create(gm.token, {kind: 'npc', name: 'Слабак', disposition: 'friendly', hpMax: 5, hpCurrent: 5});
    const tough = await create(gm.token, {kind: 'npc', name: 'Крепыш', disposition: 'friendly', hpMax: 200, hpCurrent: 200});
    const {auto} = await arena('Мультиатака', [[gm.token, ogre.id, 0.5, 0.5, 30], [gm.token, weak.id, 1.5, 0.5, 5], [gm.token, tough.id, 0.5, 1.5, 4]]);
    const result = await auto();
    assert.equal(result.attacks.length, 3, result.summary);
    assert.equal(await hp(weak.id) <= 0, true, 'the first one fell');
    const onWeak = result.attacks.filter((done: any) => done.victimName === 'Слабак').length;
    assert.equal(result.attacks.filter((done: any) => done.victimName === 'Крепыш').length, 3 - onWeak, 'once it fell, the rest went to the next foe in reach (two natural 1s leave none)');
    assert.match(result.summary, /атакует: Дубина — «Слабак» (?:попадание|промах)/, 'a natural 1 may miss — then the next swing');
  });

  await t.test('an area spell where it hits most foes and no friend', async () => {
    const mage = await create(gm.token, {kind: 'npc', name: 'Пиромант', disposition: 'hostile', hpMax: 40, hpCurrent: 40});
    await learn(mage.id, 'fireball');
    await learn(mage.id, 'fire-bolt');
    await slots(mage.id, 3, 2);
    const heroes = [];
    for (const name of ['Ава', 'Бран', 'Вик']) {
      heroes.push(await create(alice.token, {kind: 'character', name, hpMax: 80, hpCurrent: 80}));
    }
    const {scenePath, auto} = await arena('Огненный шар', [
      [gm.token, mage.id, -8.5, 0.5, 30],
      ...heroes.map((hero, index) => [alice.token, hero.id, [4.5, 5.5, 4.5][index]!, [0.5, 1.5, 2.5][index]!, 5] as [string, string, number, number, number]),
    ]);
    const result = await auto();
    assert.ok(result.area, result.summary);
    assert.equal(result.areaCast.targets.length, 3, 'all three in the blast');
    for (const hero of heroes) assert.ok(await hp(hero.id) < 80, 'everyone took fire');
    assert.match(result.summary, /на область: задето 3/);
    assert.equal((await request('GET', scenePath, gm.token)).json().templates.length, 0, 'the template is cleared after the blast');
    const slot = (await pg.query<any>('SELECT current FROM character_spell_slots WHERE character_id=$1 AND level=3', [mage.id])).rows[0].current;
    assert.equal(slot, 1);
  });

  await t.test('no area where it would hit a friend — a single-target spell instead', async () => {
    const mage = await create(gm.token, {kind: 'npc', name: 'Осторожный', disposition: 'hostile', hpMax: 40, hpCurrent: 40});
    await learn(mage.id, 'fireball');
    await learn(mage.id, 'fire-bolt');
    await slots(mage.id, 3, 2);
    const guard = await create(gm.token, {kind: 'npc', name: 'Страж', disposition: 'hostile', hpMax: 40, hpCurrent: 40});
    const hero = await create(alice.token, {kind: 'character', name: 'Дея', hpMax: 80, hpCurrent: 80});
    const {auto} = await arena('Свой рядом', [[gm.token, mage.id, -8.5, 0.5, 30], [alice.token, hero.id, 4.5, 0.5, 5], [gm.token, guard.id, 5.5, 0.5, 4]]);
    const result = await auto();
    assert.equal(result.area, null, 'the guard stands next to her');
    assert.match(result.summary, /творит/, result.summary);
  });

  await t.test('healing: a bonus-action heal for a badly hurt friend and still an attack; an action heal for one at death’s door', async () => {
    const priest = await create(gm.token, {kind: 'npc', name: 'Жрец', disposition: 'hostile', wisdom: 16, hpMax: 40, hpCurrent: 40});
    await learn(priest.id, 'healing-word');
    await learn(priest.id, 'cure-wounds');
    await slots(priest.id, 1, 4);
    await request('POST', `${base}/characters/${priest.id}/weapons`, gm.token, {name: 'Булава', ability: 'strength', proficient: false, damageFormula: '1d6'});
    const brute = await create(gm.token, {kind: 'npc', name: 'Громила', disposition: 'hostile', hpMax: 40, hpCurrent: 16});
    const hero = await create(alice.token, {kind: 'character', name: 'Эйра', hpMax: 80, hpCurrent: 80});
    const {auto} = await arena('Лечение', [[gm.token, priest.id, 0.5, 0.5, 30], [gm.token, brute.id, 0.5, 1.5, 4], [alice.token, hero.id, 1.5, 0.5, 5]]);
    const first = await auto();
    assert.match(first.summary, /лечит «Громила» \(«Лечащее слово»\): \+\d+ хит\.; атакует: Булава/, first.summary);
    assert.ok(await hp(brute.id) > 16, 'healed');
    assert.ok(first.attack, 'and still swung the mace');

    await pg.query('UPDATE characters SET hp_current=5 WHERE id=$1', [brute.id]);
    await pg.query(`DELETE FROM character_spells WHERE character_id=$1 AND srd_index='healing-word'`, [priest.id]);
    const second = await auto();
    assert.match(second.summary, /лечит «Громила»/, second.summary);
    assert.equal(second.attack, null, 'the action went to the healing');
  });
});
