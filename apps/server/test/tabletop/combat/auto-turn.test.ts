import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('NPC auto turn: spells, ranged stance and target choice', async t => {
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
  const gm = await register('gm_auto'), alice = await register('alice_auto');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Auto'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Поле', widthCells: 16, heightCells: 8})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const initiative = `${scenePath}/initiative`;

  const create = async (token: string, body: any) => (await request('POST', `${base}/characters`, token, body)).json();
  const place = async (token: string, characterId: string, x: number, z: number) =>
    (await request('POST', `${scenePath}/objects`, token, {characterId, x, z})).json().id as string;
  const learn = async (characterId: string, srdIndex: string) => {
    const made = await request('POST', `${base}/characters/${characterId}/spells`, gm.token, {source: 'srd', srdIndex});
    assert.equal(made.statusCode, 201, made.body);
  };
  const weapon = (characterId: string, body: any) => request('POST', `${base}/characters/${characterId}/weapons`, gm.token, body);

  const fighter = await create(alice.token, {kind: 'character', name: 'Боец', hpMax: 60, hpCurrent: 60});
  const mage = await create(alice.token, {kind: 'character', name: 'Маг', hpMax: 9, hpCurrent: 9});
  const archer = await create(alice.token, {kind: 'character', name: 'Лучник', hpMax: 30, hpCurrent: 30});
  await weapon(fighter.id, {name: 'Кинжал', ability: 'strength', proficient: false, damageFormula: '1d4'});
  await weapon(archer.id, {name: 'Длинный лук', ability: 'dexterity', proficient: false, damageFormula: '2d8+4', weaponKind: 'ranged', rangeFeet: 150});
  await place(alice.token, fighter.id, 0.5, 0.5);
  await place(alice.token, mage.id, -3.5, 2.5);
  await place(alice.token, archer.id, -6.5, -2.5);

  const warlock = await create(gm.token, {kind: 'npc', name: 'Колдун', disposition: 'hostile', charisma: 16, hpMax: 40, hpCurrent: 40});
  await learn(warlock.id, 'fire-bolt');
  await weapon(warlock.id, {name: 'Нож', ability: 'strength', proficient: false, damageFormula: '1d4'});
  const warlockAt = await place(gm.token, warlock.id, 6.5, 0.5);

  const join = async (characterId: string, score: number) => {
    const id = (await request('POST', `${initiative}/join`, gm.token, {characterId})).json().id;
    await request('PATCH', `${initiative}/${id}`, gm.token, {score});
    return id;
  };
  await join(warlock.id, 30);
  for (const hero of [fighter, mage, archer]) await join(hero.id, 5);
  await request('POST', `${initiative}/advance`, gm.token, {});
  const auto = async (body: any = {}) => {
    await pg.query('UPDATE initiative_entries SET action_used=false, bonus_used=false, attacks_made=0, leveled_action_spell=false, bonus_spell=false, moved_feet=0, dashes=0 WHERE scene_id=$1 AND is_current', [sceneId]);
    return request('POST', `${initiative}/auto`, gm.token, {advance: false, ...body});
  };
  const position = async (placementId: string) => (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.id === placementId);

  await t.test('a caster with a cantrip stays at range and casts at the nearest', async () => {
    const response = await auto();
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json();
    assert.equal(result.target.name, 'Боец', 'nearest by path');
    assert.equal(result.moved, null, 'fire bolt reaches 120 ft — no need to walk up');
    assert.equal(result.spell?.name !== undefined && result.weapon === null, true, `casts instead of the knife: ${result.summary}`);
    assert.ok(result.cast?.targets?.[0]?.attack, 'a spell attack was rolled');
    assert.match(result.summary, /творит/);
    const at = await position(warlockAt);
    assert.deepEqual([at.x, at.z], [6.5, 0.5]);
  });

  await t.test('the GM may aim at the weakest or the most dangerous', async () => {
    assert.equal((await auto({target: 'weakest'})).json().target.name, 'Маг', 'fewest hit points');
    assert.equal((await auto({target: 'threat'})).json().target.name, 'Лучник', 'the strongest attack');
    assert.equal((await auto({target: 'random'})).statusCode, 400);
  });

  await t.test('an archer keeps shooting from where it stands', async () => {
    await pg.query(`DELETE FROM character_spells WHERE character_id=$1`, [warlock.id]);
    await pg.query(`DELETE FROM character_weapons WHERE character_id=$1`, [warlock.id]);
    await weapon(warlock.id, {name: 'Короткий лук', ability: 'dexterity', proficient: false, damageFormula: '1d6', weaponKind: 'ranged', rangeFeet: 80});
    const result = (await auto()).json();
    assert.equal(result.moved, null, `stays: ${result.summary}`);
    assert.equal(result.weapon?.name, 'Короткий лук');
  });

  await t.test('an area spell goes where the foes are; a leveled spell takes the lowest slot it fits', async () => {
    await pg.query(`DELETE FROM character_weapons WHERE character_id=$1`, [warlock.id]);
    await learn(warlock.id, 'fireball');
    await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,3,2,2),($1,$2,2,1,1)`, [campaignId, warlock.id]);
    const blast = (await auto()).json();
    assert.ok(blast.area, `the fireball, not «nothing to do»: ${blast.summary}`);
    assert.match(blast.summary, /на область/);

    await pg.query(`DELETE FROM character_spells WHERE character_id=$1 AND srd_index='fireball'`, [warlock.id]);
    await learn(warlock.id, 'magic-missile');
    const before = (await pg.query<any>('SELECT level, current FROM character_spell_slots WHERE character_id=$1 ORDER BY level', [warlock.id])).rows;
    const result = (await auto()).json();
    assert.equal(result.spell?.name !== undefined, true, result.summary);
    const after = (await pg.query<any>('SELECT level, current FROM character_spell_slots WHERE character_id=$1 ORDER BY level', [warlock.id])).rows;
    assert.deepEqual(after.map((row: any) => [row.level, row.current]), before.map((row: any) => [row.level, row.level === 2 ? row.current - 1 : row.current]),
      'magic missile (1st) went off with the 2nd-level slot — the lowest there was');
  });
});
