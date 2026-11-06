import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('stealth and passive Perception', async t => {
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

  const gm = await register('gm_stealth'), alice = await register('alice_stealth');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Stealth'})).json().id;
  await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'hostile_blocks','flag','Сквозь врагов','false'::jsonb,$2)`, [campaignId, gm.user.id]);
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Коридор', widthCells: 10, heightCells: 1})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const characters = `${base}/characters`;
  const hero = (await request('POST', characters, alice.token, {kind: 'character', name: 'Герой', hpMax: 30})).json();
  const goblin = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 30})).json();
  const heroAt = (await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: -4.5, z: 0})).json().id;
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: -3.5, z: 0});
  const dagger = (await request('POST', `${characters}/${goblin.id}/weapons`, gm.token, {name: 'Кинжал', ability: 'finesse', proficient: false, damageFormula: '1d1', damageType: 'piercing'})).json();
  const sword = (await request('POST', `${characters}/${hero.id}/weapons`, alice.token, {name: 'Меч', ability: 'strength', proficient: false, damageFormula: '1d1', damageType: 'slashing'})).json();

  const sees = async (token: string) => (await request('GET', scenePath, token)).json().objects.some((o: any) => o.character_id === goblin.id);
  const setStealth = (total: number) => pg.query(`UPDATE character_effects SET parameters = jsonb_build_object('total', $2::int) WHERE character_id=$1 AND effect_code='hidden'`, [goblin.id, total]);
  const isHidden = async () => (await pg.query(`SELECT 1 FROM character_effects WHERE character_id=$1 AND effect_code='hidden' AND active`, [goblin.id])).rows.length > 0;

  await t.test('nobody hides in bright light in plain sight', async () => {
    const tried = await request('POST', `${scenePath}/hide`, gm.token, {characterId: goblin.id});
    assert.equal(tried.statusCode, 400);
    assert.match(tried.json().message, /ясно видит/);
  });

  await t.test('in the dusk the goblin hides; a player who does not notice him does not see him', async () => {
    await request('PATCH', scenePath, gm.token, {lighting: 'dim'});
    assert.equal((await request('POST', `${scenePath}/hide`, alice.token, {characterId: goblin.id})).statusCode, 403, 'not hers');
    const hidden = await request('POST', `${scenePath}/hide`, gm.token, {characterId: goblin.id});
    assert.equal(hidden.statusCode, 200, hidden.body);
    assert.equal(hidden.json().roll.hidden, true, 'the NPC rolls behind the screen');
    await setStealth(25);
    assert.equal(await sees(alice.token), false, 'passive 10 − 5 in half-light < 25');
    assert.equal(await sees(gm.token), true);
    await setStealth(5);
    assert.equal(await sees(alice.token), true, 'passive 5 ≥ 5 — noticed');
  });

  await t.test('an attack from hiding has advantage and gives the attacker away', async () => {
    await setStealth(25);
    const stab = (await request('POST', `${base}/rolls/check`, gm.token, {characterId: goblin.id, kind: 'attack', key: dagger.id, targetCharacterId: hero.id, sceneId})).json();
    assert.equal(stab.outcome.advantage, 'adv');
    assert.ok(stab.outcome.reasons.includes('преимущество: из скрытности'), JSON.stringify(stab.outcome));
    assert.equal(await isHidden(), false);
    assert.equal(await sees(alice.token), true);
  });

  await t.test('attacking an unseen target — with disadvantage', async () => {
    assert.equal((await request('POST', `${scenePath}/hide`, gm.token, {characterId: goblin.id})).statusCode, 200);
    await setStealth(25);
    const swing = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'attack', key: sword.id, targetCharacterId: goblin.id, sceneId})).json();
    assert.ok(swing.outcome.reasons.includes('помеха: цель скрыта'), JSON.stringify(swing.outcome));
  });

  await t.test('searching rolls Perception — with disadvantage in the dusk — and finds him', async () => {
    await setStealth(1);
    const search = await request('POST', `${scenePath}/search`, alice.token, {characterId: hero.id});
    assert.equal(search.statusCode, 200, search.body);
    assert.ok(search.json().roll.outcome.reasons.includes('помеха: полумрак'), JSON.stringify(search.json().roll.outcome));
    assert.deepEqual(search.json().found, ['«Гоблин»']);
    assert.equal(await isHidden(), false);
  });

  await t.test('stepping out of the shadow is free; only the owner or the GM', async () => {
    await request('POST', `${scenePath}/hide`, gm.token, {characterId: goblin.id});
    assert.equal((await request('POST', `${scenePath}/unhide`, alice.token, {characterId: goblin.id})).statusCode, 403);
    assert.equal((await request('POST', `${scenePath}/unhide`, gm.token, {characterId: goblin.id})).statusCode, 200);
    assert.equal(await isHidden(), false);
  });

  await t.test('in combat hiding takes the action', async () => {
    const initiative = `${scenePath}/initiative`;
    const entry = (await request('POST', `${initiative}/join`, alice.token, {characterId: hero.id})).json().id;
    await request('PATCH', `${initiative}/${entry}`, gm.token, {score: 20});
    await request('POST', `${initiative}/advance`, gm.token);
    const hid = await request('POST', `${scenePath}/hide`, alice.token, {characterId: hero.id});
    assert.equal(hid.statusCode, 200, hid.body);
    const row = (await request('GET', initiative, gm.token)).json().entries.find((e: any) => e.id === entry);
    assert.equal(row.action_used, true);
    assert.equal((await request('POST', `${scenePath}/search`, alice.token, {characterId: hero.id})).statusCode, 400, 'the action is spent');
    assert.equal((await request('POST', `${scenePath}/search`, alice.token, {characterId: hero.id, using: 'bonus'})).statusCode, 200, 'a bonus action can still search');
    await request('DELETE', initiative, gm.token);
    await request('POST', `${scenePath}/unhide`, alice.token, {characterId: hero.id});
  });

  await t.test('passive Perception spots traps nearby when the hero moves; players see a spotted trap area', async () => {
    await request('PATCH', scenePath, gm.token, {lighting: 'bright'});
    const chest = (await request('POST', characters, gm.token, {kind: 'object', name: 'Сундук'})).json();
    await request('POST', `${scenePath}/objects`, gm.token, {characterId: chest.id, x: 0.5, z: 0});
    await request('PUT', `${characters}/${chest.id}/state`, gm.token, {openable: true, trapArmed: true, trapDetectDc: 5});
    const pit = (await request('POST', `${scenePath}/triggers`, gm.token, {kind: 'enter', shape: 'square', x: 3, z: 0, direction: 0, sizeFeet: 5, name: 'Яма', detectDc: 8})).json();
    const deep = (await request('POST', `${scenePath}/triggers`, gm.token, {kind: 'enter', shape: 'square', x: 4, z: 0, direction: 0, sizeFeet: 5, name: 'Глубокая яма', detectDc: 30})).json();
    assert.equal((await request('GET', scenePath, alice.token)).json().triggers.length, 0);

    const current = (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.id === heroAt);
    const moved = await request('PUT', `${scenePath}/objects/${heroAt}`, alice.token, {
      x: -2.5, y: 0, z: 0, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
    });
    assert.equal(moved.statusCode, 200, moved.body);
    const chestState = (await request('GET', scenePath, alice.token)).json().objects.find((o: any) => o.character_id === chest.id).state;
    assert.equal(chestState.trap?.detected, true, 'passive 10 ≥ DC 5 within 30 ft');
    const spotted = (await request('GET', scenePath, alice.token)).json().triggers;
    assert.deepEqual(spotted.map((trigger: any) => trigger.name), ['Яма'], 'DC 8 spotted, DC 30 not');
    assert.equal(spotted[0].dc, undefined, 'players get no rules');
    const all = (await request('GET', `${scenePath}/triggers`, gm.token)).json().triggers;
    assert.deepEqual(all.map((trigger: any) => [trigger.id, trigger.detected]), [[pit.id, true], [deep.id, false]]);
  });
});
