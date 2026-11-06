import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('movement limits in combat', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db);
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

  const gm = await register('gm_move'), alice = await register('alice_move'), bob = await register('bob_move');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Move'})).json().id;
  for (const member of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Коридор', widthCells: 12, heightCells: 1})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const characters = `/campaigns/${campaignId}/characters`;

  const hero = (await request('POST', characters, alice.token, {kind: 'character', name: 'Герой', speedFeet: 15})).json();
  const goblin = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile'})).json();
  const heroPlacement = (await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: -5.5, z: 0})).json().id;
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 5.5, z: 0});

  const moveTo = async (x: number, token = alice.token) => {
    const current = (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.id === heroPlacement);
    return request('PUT', `${scenePath}/objects/${heroPlacement}`, token, {
      x, y: 0, z: 0, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
    });
  };
  const initiative = `${scenePath}/initiative`;
  const entries = async () => (await request('GET', initiative, gm.token)).json().entries as any[];

  await t.test('out of combat a hero walks as far as he likes', async () => {
    assert.equal((await moveTo(0.5)).statusCode, 200);
    assert.equal((await moveTo(-5.5)).statusCode, 200);
  });

  let heroEntry = '', goblinEntry = '';

  await t.test('in combat: only on his turn and only as far as his speed', async () => {
    heroEntry = (await request('POST', `${initiative}/join`, alice.token, {characterId: hero.id})).json().id;
    goblinEntry = (await request('POST', `${initiative}/join`, gm.token, {characterId: goblin.id})).json().id;
    await request('PATCH', `${initiative}/${heroEntry}`, gm.token, {score: 20});
    await request('PATCH', `${initiative}/${goblinEntry}`, gm.token, {score: 10});
    await request('POST', `${initiative}/advance`, gm.token);
    const entry = (await entries()).find(e => e.id === heroEntry);
    assert.deepEqual([entry.is_current, entry.speed_feet, entry.moved_feet], [true, 15, 0]);

    assert.equal((await moveTo(-3.5)).statusCode, 200, '10 feet');
    const tooFar = await moveTo(-1.5);
    assert.equal(tooFar.statusCode, 400);
    assert.match(tooFar.json().message, /путь стоит 10 фут\., осталось 5 из 15/);
    assert.equal((await moveTo(-2.5)).statusCode, 200, 'the last 5 feet');
    assert.equal((await entries()).find(e => e.id === heroEntry).moved_feet, 15);
  });

  await t.test('a Dash gives as much again; only the owner or the GM, only on his turn', async () => {
    assert.equal((await request('POST', `${initiative}/${heroEntry}/dash`, bob.token)).statusCode, 403);
    const dashed = await request('POST', `${initiative}/${heroEntry}/dash`, alice.token);
    assert.equal(dashed.statusCode, 200, dashed.body);
    assert.equal((await moveTo(0.5)).statusCode, 200, '15 more feet');
    assert.equal((await moveTo(1.5)).statusCode, 400, 'all 30 feet spent');
    assert.equal((await request('POST', `${initiative}/${goblinEntry}/dash`, gm.token)).statusCode, 400, 'not the goblin’s turn');
  });

  await t.test('on someone else’s turn the hero stays put — the GM too, unless «Свободно» (gm_free_move)', async () => {
    await request('POST', `${initiative}/advance`, gm.token);
    const out = await moveTo(-0.5);
    assert.equal(out.statusCode, 400);
    assert.match(out.json().message, /Сейчас ход «Гоблин»/);
    const gmOut = await moveTo(-5.5, gm.token);
    assert.equal(gmOut.statusCode, 400, 'the GM obeys the turn order as well (complaint 10)');
    assert.match(gmOut.json().message, /Сейчас ход «Гоблин»/);
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'gm_free_move','flag','Свободно','true'::jsonb,$2)`, [campaignId, gm.user.id]);
    assert.equal((await moveTo(-5.5, gm.token)).statusCode, 200, '«Свободно» — push, teleport');
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='gm_free_move'`, [campaignId]);
  });

  await t.test('difficult terrain costs double', async () => {
    assert.equal((await request('PUT', `${scenePath}/terrain`, alice.token, {cells: [[1, 0]]})).statusCode, 403);
    const terrain = await request('PUT', `${scenePath}/terrain`, gm.token, {cells: [[1, 0], [2, 0], [2, 0]]});
    assert.deepEqual(terrain.json().cells, [[1, 0], [2, 0]]);
    assert.equal((await request('PUT', `${scenePath}/terrain`, gm.token, {cells: [[12, 0]]})).statusCode, 400, 'off the map');
    assert.deepEqual((await request('GET', scenePath, alice.token)).json().scene.difficult_cells, [[1, 0], [2, 0]]);

    await request('POST', `${initiative}/advance`, gm.token);
    assert.equal((await entries()).find(e => e.id === heroEntry).moved_feet, 0);
    const muddy = await moveTo(-2.5);
    assert.equal(muddy.statusCode, 400, 'three cells, two of them mud: 10 + 10 + 5 = 25 feet');
    assert.match(muddy.json().message, /путь стоит 25 фут\./);
    assert.equal((await moveTo(-4.5)).statusCode, 200, 'one muddy cell — 10 feet');
    const second = await moveTo(-3.5);
    assert.equal(second.statusCode, 400, 'the next muddy cell needs 10, only 5 left');
    assert.match(second.json().message, /осталось 5 из 15/);
  });

  await t.test('5-10-5: diagonals are counted over the whole turn, step by step costs the same (second list, item 1)', async () => {
    const field = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Поле', widthCells: 6, heightCells: 6})).json().id;
    const fieldPath = `/campaigns/${campaignId}/scenes/${field}`;
    const scout = (await request('POST', characters, alice.token, {kind: 'character', name: 'Разведчик', speedFeet: 15})).json();
    const placed = (await request('POST', `${fieldPath}/objects`, alice.token, {characterId: scout.id, x: -2.5, z: -2.5})).json().id;
    const step = async (x: number, z: number) => {
      const current = (await request('GET', fieldPath, gm.token)).json().objects.find((o: any) => o.id === placed);
      return request('PUT', `${fieldPath}/objects/${placed}`, alice.token, {
        x, y: 0, z, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
      });
    };
    await request('POST', `/campaigns/${campaignId}/rules`, gm.token, {key: 'diagonal_5_10_5', kind: 'flag', label: '5-10-5', value: true});
    const entry = (await request('POST', `${fieldPath}/initiative/join`, alice.token, {characterId: scout.id})).json().id;
    await request('POST', `${fieldPath}/initiative/advance`, gm.token);
    const scoutEntry = async () => (await request('GET', `${fieldPath}/initiative`, gm.token)).json().entries.find((e: any) => e.id === entry);

    assert.equal((await step(-1.5, -1.5)).statusCode, 200, 'first diagonal — 5 feet');
    assert.equal((await step(-0.5, -0.5)).statusCode, 200, 'second diagonal — 10 feet, not 5');
    assert.equal((await scoutEntry()).moved_feet, 15);
    const third = await step(0.5, 0.5);
    assert.equal(third.statusCode, 400);
    assert.match(third.json().message, /путь стоит 5 фут\., осталось 0 из 15/);

    await request('POST', `${fieldPath}/initiative/advance`, gm.token);
    const fresh = await scoutEntry();
    assert.deepEqual([fresh.is_current, fresh.moved_feet], [true, 0]);
    assert.equal((await pg.query<{moved_diagonals: number}>('SELECT moved_diagonals FROM initiative_entries WHERE id=$1', [entry])).rows[0]!.moved_diagonals, 0);
    assert.equal((await step(0.5, 0.5)).statusCode, 200, 'a diagonal costs 5 again');
    await request('DELETE', `/campaigns/${campaignId}/rules/${(await request('GET', `/campaigns/${campaignId}/rules`, gm.token)).json().rules.find((r: any) => r.key === 'diagonal_5_10_5').id}`, gm.token);
  });

  await t.test('the campaign can switch the limit off', async () => {
    const rule = await request('POST', `/campaigns/${campaignId}/rules`, gm.token, {key: 'movement_limit', kind: 'flag', label: 'Лимит движения', value: false});
    assert.equal(rule.statusCode, 201, rule.body);
    await request('POST', `${initiative}/advance`, gm.token);
    assert.equal((await moveTo(4.5)).statusCode, 200, 'out of turn and far — allowed now');
  });
});
