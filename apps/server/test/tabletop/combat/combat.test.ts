import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('dice rolls and initiative tracker', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());

  const app = await buildApp(db);
  t.after(() => app.close());

  const request = async (method: any, url: string, token?: string, payload?: any) =>
    app.inject({
      method, url,
      ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}),
      ...(payload !== undefined ? {payload} : {}),
    });

  const password = 'Local test password 123!';

  const register = async (username: string) => {
    const response = await request('POST', '/auth/register', undefined, {username, password, displayName: username});
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };

  const owner = await register('gm_combat'), player = await register('player_combat'), bystander = await register('bystander_combat');

  const campaignId = (await request('POST', '/campaigns', owner.token, {name: 'Combat test'})).json().id;

  const join = async (token: string) => {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, owner.token)).json().code;
    assert.equal((await request('POST', '/campaigns/join', token, {code})).statusCode, 201);
  };
  await join(player.token);
  await join(bystander.token);

  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, owner.token, {name: 'Battle map'})).json().id;

  const characterId = (await pg.query<{id: string}>(
    `INSERT INTO characters(campaign_id, owner_user_id, name, dexterity) VALUES ($1,$2,'Fighter',16) RETURNING id`,
    [campaignId, player.user.id],
  )).rows[0]!.id;

  const targetId = (await pg.query<{id: string}>(
    `INSERT INTO characters(campaign_id, owner_user_id, name, hp_current, hp_max, hp_temp)
     VALUES ($1,$2,'Target',10,20,5) RETURNING id`,
    [campaignId, player.user.id],
  )).rows[0]!.id;

  const rollsPath = () => `/campaigns/${campaignId}/rolls`;
  const initiativePath = () => `/campaigns/${campaignId}/scenes/${sceneId}/initiative`;

  await t.test('an invalid formula is rejected', async () => {
    assert.equal((await request('POST', rollsPath(), player.token, {formula: 'lots of dice'})).statusCode, 400);
  });

  await t.test('a plain roll is visible to everyone', async () => {
    const response = await request('POST', rollsPath(), player.token, {formula: '1d20+2', label: 'Athletics'});
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    assert.equal(body.dice_results.length, 1);
    assert.equal(body.total, body.dice_results[0] + 2);

    const asBystander = (await request('GET', rollsPath(), bystander.token)).json().rolls;
    assert.equal(asBystander.some((r: any) => r.id === body.id), true);
    assert.equal(asBystander.find((r: any) => r.id === body.id).user_display_name, 'player_combat');
  });

  await t.test('composite formulas: several dice groups, keep-highest and sheet variables', async () => {
    const sum = (await request('POST', rollsPath(), player.token, {formula: '1d1+2d1+3'})).json();
    assert.equal(sum.total, 6);
    assert.equal(sum.modifier, 3);
    assert.deepEqual(sum.dice_results, [1, 1, 1]);
    assert.deepEqual(sum.breakdown.map((g: any) => [g.notation, g.rolls]), [['1d1', [1]], ['2d1', [1, 1]]]);

    const kept = (await request('POST', rollsPath(), player.token, {formula: '4d1kh3-1'})).json();
    assert.equal(kept.total, 2);
    assert.deepEqual(kept.breakdown[0].kept, [1, 1, 1]);

    const withoutCharacter = await request('POST', rollsPath(), player.token, {formula: '1d1+@dex'});
    assert.equal(withoutCharacter.statusCode, 400);
    assert.match(withoutCharacter.json().message, /от чьего имени/);

    const dex = (await request('POST', rollsPath(), player.token, {formula: 'd1+@dex', characterId})).json();
    assert.equal(dex.total, 4);
    const prof = await request('POST', rollsPath(), player.token, {formula: 'd1+@prof', characterId});
    assert.equal(prof.statusCode, 400);
    assert.match(prof.json().message, /@prof/);

    assert.equal((await request('POST', rollsPath(), player.token, {formula: '1d6+@luck'})).statusCode, 400);
    assert.equal((await request('POST', rollsPath(), player.token, {formula: '60d6+60d6'})).statusCode, 400);

    const longFormula = '1d8+1d6+1d4+2d10+3';
    assert.equal((await request('POST', rollsPath(), player.token, {formula: longFormula})).json().formula, longFormula, 'longer than the old 20-character limit');
  });

  await t.test('a hidden roll is visible to its own roller and the GM, not to a bystander', async () => {
    const response = await request('POST', rollsPath(), player.token, {formula: '1d6', hidden: true});
    assert.equal(response.statusCode, 201);
    const rollId = response.json().id;

    assert.equal((await request('GET', rollsPath(), player.token)).json().rolls.some((r: any) => r.id === rollId), true);
    assert.equal((await request('GET', rollsPath(), owner.token)).json().rolls.some((r: any) => r.id === rollId), true);
    assert.equal((await request('GET', rollsPath(), bystander.token)).json().rolls.some((r: any) => r.id === rollId), false);
  });

  const checkerId = (await pg.query<{id: string}>(
    `INSERT INTO characters(campaign_id, owner_user_id, name, dexterity, wisdom, level)
     VALUES ($1,$2,'Checker',14,8,5) RETURNING id`,
    [campaignId, player.user.id],
  )).rows[0]!.id;
  await pg.query(
    `INSERT INTO character_saves(campaign_id, character_id, ability, proficient, custom_bonus)
     VALUES ($1,$2,'wisdom',true,1)`,
    [campaignId, checkerId],
  );
  await pg.query(
    `INSERT INTO character_skills(campaign_id, character_id, skill_index, proficient, expertise)
     VALUES ($1,$2,'perception',true,true)`,
    [campaignId, checkerId],
  );

  const checkPath = () => `/campaigns/${campaignId}/rolls/check`;

  await t.test('a bystander cannot roll a check for someone else\'s character', async () => {
    const response = await request('POST', checkPath(), bystander.token, {characterId: checkerId, kind: 'ability', key: 'dexterity'});
    assert.equal(response.statusCode, 403);
  });

  await t.test('a raw ability check uses only the ability modifier, no proficiency', async () => {
    const response = await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'ability', key: 'dexterity'});
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    assert.equal(body.modifier, 2);
    assert.equal(body.total, body.dice_results[0] + 2);
    assert.equal(body.dice_results.length, 1);
    assert.equal(body.label, 'Проверка: Ловкость — Checker');
  });

  await t.test('a save adds ability modifier + proficiency (from level) + the save\'s own custom bonus', async () => {
    const response = await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'save', key: 'wisdom'});
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    assert.equal(body.modifier, 3);
    assert.equal(body.label, 'Спасбросок: Мудрость — Checker');
  });

  await t.test('a proficient skill with expertise doubles the proficiency bonus, not the ability modifier', async () => {
    const response = await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'skill', key: 'perception'});
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    assert.equal(body.modifier, 5);
    assert.equal(body.label, 'Навык: Восприятие — Checker');
  });

  await t.test('a non-proficient skill (no row at all) gets no proficiency bonus, just the ability modifier', async () => {
    const response = await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'skill', key: 'stealth'});
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().modifier, 2);
  });

  await t.test('an unknown skill or ability key is rejected, not silently treated as +0', async () => {
    assert.equal((await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'skill', key: 'not-a-skill'})).statusCode, 400);
    assert.equal((await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'ability', key: 'luck'})).statusCode, 400);
  });

  await t.test('advantage rolls two d20 and keeps the higher; disadvantage keeps the lower', async () => {
    const adv = await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'ability', key: 'dexterity', advantage: 'adv'});
    assert.equal(adv.statusCode, 201);
    const advBody = adv.json();
    assert.equal(advBody.dice_results.length, 2);
    assert.equal(advBody.total, Math.max(...advBody.dice_results) + 2);

    const disadv = await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'ability', key: 'dexterity', advantage: 'disadv'});
    const disadvBody = disadv.json();
    assert.equal(disadvBody.dice_results.length, 2);
    assert.equal(disadvBody.total, Math.min(...disadvBody.dice_results) + 2);
  });

  await t.test('bonusFormula adds a personal ad-hoc bonus on top, using the same @-token syntax as campaign_rules formulas', async () => {
    const flat = await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'ability', key: 'dexterity', bonusFormula: '+2'});
    assert.equal(flat.json().modifier, 4);

    const withProf = await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'ability', key: 'dexterity', bonusFormula: '+@prof'});
    assert.equal(withProf.json().modifier, 5);

    const unknown = await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'ability', key: 'dexterity', bonusFormula: '+@luck'});
    assert.equal(unknown.statusCode, 400);
  });

  await t.test('a proficient check with no level and no legacy sheet_extra.proficiency is a clear 400, not a silent 0', async () => {
    const bareId = (await pg.query<{id: string}>(
      `INSERT INTO characters(campaign_id, owner_user_id, name, strength) VALUES ($1,$2,'Bare',12) RETURNING id`,
      [campaignId, player.user.id],
    )).rows[0]!.id;
    await pg.query(
      `INSERT INTO character_saves(campaign_id, character_id, ability, proficient) VALUES ($1,$2,'strength',true)`,
      [campaignId, bareId],
    );
    const response = await request('POST', checkPath(), player.token, {characterId: bareId, kind: 'save', key: 'strength'});
    assert.equal(response.statusCode, 400);
  });

  await t.test('a character without a level falls back to legacy sheet_extra.proficiency, same as the client sheet does', async () => {
    const legacyId = (await pg.query<{id: string}>(
      `INSERT INTO characters(campaign_id, owner_user_id, name, strength, sheet_extra)
       VALUES ($1,$2,'Legacy',12,'{"proficiency":4}'::jsonb) RETURNING id`,
      [campaignId, player.user.id],
    )).rows[0]!.id;
    await pg.query(
      `INSERT INTO character_saves(campaign_id, character_id, ability, proficient) VALUES ($1,$2,'strength',true)`,
      [campaignId, legacyId],
    );
    const response = await request('POST', checkPath(), player.token, {characterId: legacyId, kind: 'save', key: 'strength'});
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().modifier, 5);
  });

  await t.test('a manager (GM) can roll a check for a character they do not own', async () => {
    const response = await request('POST', checkPath(), owner.token, {characterId: checkerId, kind: 'ability', key: 'dexterity'});
    assert.equal(response.statusCode, 201, response.body);
  });

  await t.test('checking an unknown character is a 404', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    const response = await request('POST', checkPath(), player.token, {characterId: unknown, kind: 'ability', key: 'dexterity'});
    assert.equal(response.statusCode, 404);
  });

  const proficientWeaponId = (await pg.query<{id: string}>(
    `INSERT INTO character_weapons(campaign_id, character_id, name, ability, proficient)
     VALUES ($1,$2,'Рапира','dexterity',true) RETURNING id`,
    [campaignId, checkerId],
  )).rows[0]!.id;
  const nonProficientWeaponId = (await pg.query<{id: string}>(
    `INSERT INTO character_weapons(campaign_id, character_id, name, ability, proficient)
     VALUES ($1,$2,'Чужой топор','strength',false) RETURNING id`,
    [campaignId, checkerId],
  )).rows[0]!.id;

  await t.test('an attack roll with a proficient finesse weapon uses its ability + proficiency bonus', async () => {
    const response = await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'attack', key: proficientWeaponId});
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    assert.equal(body.modifier, 5);
    assert.equal(body.label, 'Атака: Рапира — Checker');
  });

  await t.test('an attack roll with a non-proficient weapon skips the proficiency bonus', async () => {
    const response = await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'attack', key: nonProficientWeaponId});
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().modifier, 0);
  });

  await t.test('attacking with an unknown or malformed weapon id is a 404, not a 500', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    assert.equal((await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'attack', key: unknown})).statusCode, 404);
    assert.equal((await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'attack', key: 'not-a-uuid'})).statusCode, 404);
  });

  await t.test('a weapon belonging to a different character cannot be used to attack', async () => {
    const otherWeaponId = (await pg.query<{id: string}>(
      `INSERT INTO character_weapons(campaign_id, character_id, name, ability, proficient)
       VALUES ($1,$2,'Чужое','strength',true) RETURNING id`,
      [campaignId, targetId],
    )).rows[0]!.id;
    const response = await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'attack', key: otherWeaponId});
    assert.equal(response.statusCode, 404);
  });

  await t.test('joining initiative auto-rolls 1d20 plus the real dexterity modifier', async () => {
    const response = await request('POST', `${initiativePath()}/join`, player.token, {characterId});
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    assert.equal(body.alreadyJoined, false);

    const roll = (await request('GET', rollsPath(), player.token)).json().rolls
      .find((r: any) => r.label === 'Инициатива: Fighter');
    assert.ok(roll, 'expected a matching initiative roll in the log');
    assert.equal(roll.modifier, 3);
    assert.equal(roll.total, body.score);
  });

  await t.test('joining again with the same character is idempotent', async () => {
    const before = (await request('GET', initiativePath(), owner.token)).json().entries.length;
    const response = await request('POST', `${initiativePath()}/join`, player.token, {characterId});
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().alreadyJoined, true);
    assert.equal((await request('GET', initiativePath(), owner.token)).json().entries.length, before);
  });

  await t.test('a bystander cannot add someone else\'s character to initiative', async () => {
    assert.equal(
      (await request('POST', `${initiativePath()}/join`, bystander.token, {characterId})).statusCode,
      403,
    );
  });

  await t.test('only the manager can add an NPC entry', async () => {
    assert.equal(
      (await request('POST', `${initiativePath()}/npc`, player.token, {name: 'Goblin', score: 12})).statusCode,
      403,
    );
    assert.equal(
      (await request('POST', `${initiativePath()}/npc`, owner.token, {name: 'Goblin', score: 25})).statusCode,
      201,
    );
  });

  await t.test('only the manager can advance another creature turn, edit or end combat', async () => {
    assert.equal((await request('POST', `${initiativePath()}/advance`, player.token)).statusCode, 403);
    assert.equal((await request('DELETE', initiativePath(), player.token)).statusCode, 403);
  });

  await t.test('advance highlights the highest score first and increments the round on wraparound', async () => {
    const entries = (await request('GET', initiativePath(), owner.token)).json().entries;
    assert.equal(entries[0].name, 'Goblin');

    assert.equal((await request('POST', `${initiativePath()}/advance`, owner.token)).statusCode, 204);
    let state = (await request('GET', initiativePath(), owner.token)).json();
    assert.equal(state.entries.find((e: any) => e.is_current).name, 'Goblin');
    assert.equal(state.combatRound, 1);

    assert.equal((await request('POST', `${initiativePath()}/advance`, owner.token)).statusCode, 204);
    state = (await request('GET', initiativePath(), owner.token)).json();
    assert.equal(state.entries.find((e: any) => e.is_current).name, 'Fighter');

    assert.equal((await request('POST', `${initiativePath()}/advance`, player.token)).statusCode, 204);
    state = (await request('GET', initiativePath(), owner.token)).json();
    assert.equal(state.entries.find((e: any) => e.is_current).name, 'Goblin');
    assert.equal(state.combatRound, 2);

    assert.equal((await request('POST', `${initiativePath()}/advance`, player.token)).statusCode, 403);
    assert.equal((await request('POST', `${initiativePath()}/advance`, bystander.token)).statusCode, 403);
    state = (await request('GET', initiativePath(), owner.token)).json();
    assert.equal(state.entries.find((e: any) => e.is_current).name, 'Goblin');
  });

  await t.test('ending combat clears entries and resets the round', async () => {
    assert.equal((await request('DELETE', initiativePath(), owner.token)).statusCode, 204);
    const state = (await request('GET', initiativePath(), owner.token)).json();
    assert.deepEqual(state.entries, []);
    assert.equal(state.combatRound, 1);
  });

  await t.test('applying a roll as damage drains temp HP first, then current HP, floored at 0', async () => {
    // A 1-sided die always rolls 1, so "1d1+9" is a deterministic total of 10.
    const roll = (await request('POST', rollsPath(), player.token, {formula: '1d1+9'})).json();

    const response = await request('POST', `${rollsPath()}/${roll.id}/apply`, player.token, {
      characterId: targetId,
      mode: 'damage',
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(
      {hp_current: response.json().hp_current, hp_temp: response.json().hp_temp},
      {hp_current: 5, hp_temp: 0},
    );
  });

  await t.test('healing does not exceed hp_max', async () => {
    const roll = (await request('POST', rollsPath(), player.token, {formula: '1d1+99'})).json();

    const response = await request('POST', `${rollsPath()}/${roll.id}/apply`, player.token, {
      characterId: targetId,
      mode: 'heal',
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().hp_current, 20);
  });

  await t.test('a bystander cannot apply a roll to someone else\'s character', async () => {
    const roll = (await request('POST', rollsPath(), player.token, {formula: '1d1'})).json();
    assert.equal(
      (await request('POST', `${rollsPath()}/${roll.id}/apply`, bystander.token, {characterId: targetId, mode: 'damage'})).statusCode,
      403,
    );
  });

  await t.test('a manager (GM) can apply a roll to a character they do not own', async () => {
    const roll = (await request('POST', rollsPath(), owner.token, {formula: '1d1+4'})).json();
    const response = await request('POST', `${rollsPath()}/${roll.id}/apply`, owner.token, {
      characterId: targetId,
      mode: 'damage',
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().hp_current, 15);
  });

  await t.test('applying an unknown roll is a 404', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    assert.equal(
      (await request('POST', `${rollsPath()}/${unknown}/apply`, player.token, {characterId: targetId, mode: 'heal'})).statusCode,
      404,
    );
  });

  const critTargetId = (await pg.query<{id: string}>(
    `INSERT INTO characters(campaign_id, owner_user_id, name, hp_current, hp_max, hp_temp)
     VALUES ($1,$2,'Crit dummy',50,50,0) RETURNING id`,
    [campaignId, player.user.id],
  )).rows[0]!.id;

  await t.test('a critical hit on a composite formula rolls every dice group again, the number once', async () => {
    const roll = (await request('POST', rollsPath(), player.token, {formula: '1d1+2d1+1'})).json();
    assert.equal(roll.total, 4);
    await pg.query('UPDATE characters SET hp_current=20, hp_temp=0 WHERE id=$1', [targetId]);
    const applied = (await request('POST', `${rollsPath()}/${roll.id}/apply`, player.token, {characterId: targetId, mode: 'damage', critical: true})).json();
    assert.equal(applied.critical, true);
    assert.deepEqual(applied.criticalDice, [1, 1, 1]);
    assert.equal(applied.applied, 7, '4 + three extra one-sided dice');
  });

  await t.test('a critical hit doubles the damage dice, not the modifier — enabled by default with no campaign_rules row at all', async () => {
    // 2d1+9 with a crit: 2 rolled + 2 extra d1 + 9 once = 13.
    const roll = (await request('POST', rollsPath(), player.token, {formula: '2d1+9'})).json();
    const response = await request('POST', `${rollsPath()}/${roll.id}/apply`, player.token, {
      characterId: critTargetId, mode: 'damage', critical: true,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.critical, true);
    assert.deepEqual(body.criticalDice, [1, 1]);
    assert.equal(body.applied, 13);
    assert.equal(body.hp_current, 50 - 13);
  });

  await t.test('without critical:true the same roll applies its plain total, not doubled', async () => {
    const roll = (await request('POST', rollsPath(), player.token, {formula: '2d1+9'})).json();
    const response = await request('POST', `${rollsPath()}/${roll.id}/apply`, player.token, {
      characterId: critTargetId, mode: 'damage',
    });
    const body = response.json();
    assert.equal(body.critical, false);
    assert.equal(body.applied, 11);
  });

  await t.test('a campaign_rules flag can turn crit doubling off for this table', async () => {
    assert.equal(
      (await request('POST', `/campaigns/${campaignId}/rules`, owner.token, {
        key: 'crit_doubles_dice', kind: 'flag', label: 'Крит удваивает кости', value: false,
      })).statusCode,
      201,
    );

    const roll = (await request('POST', rollsPath(), player.token, {formula: '2d1+9'})).json();
    const response = await request('POST', `${rollsPath()}/${roll.id}/apply`, player.token, {
      characterId: critTargetId, mode: 'damage', critical: true,
    });
    const body = response.json();
    assert.equal(body.critical, false, 'the flag disabled crit doubling, even though critical:true was requested');
    assert.equal(body.applied, 11);
  });

  await t.test('critical:true is rejected outright for a heal — a crit is only meaningful for damage', async () => {
    const roll = (await request('POST', rollsPath(), player.token, {formula: '1d1'})).json();
    const response = await request('POST', `${rollsPath()}/${roll.id}/apply`, player.token, {
      characterId: critTargetId, mode: 'heal', critical: true,
    });
    assert.equal(response.statusCode, 400);
  });

  await t.test('critical:true on a roll that is not a plain dice formula (e.g. an advantage check) is rejected clearly, not silently applied as-is', async () => {
    const rule = (await request('GET', `/campaigns/${campaignId}/rules`, owner.token)).json().rules.find((r: any) => r.key === 'crit_doubles_dice');
    await request('PUT', `/campaigns/${campaignId}/rules/${rule.id}`, owner.token, {
      label: 'Крит удваивает кости', value: true, revision: rule.revision,
    });

    const checkRoll = (await request('POST', checkPath(), player.token, {characterId: checkerId, kind: 'ability', key: 'dexterity', advantage: 'adv'})).json();
    const response = await request('POST', `${rollsPath()}/${checkRoll.id}/apply`, player.token, {
      characterId: critTargetId, mode: 'damage', critical: true,
    });
    assert.equal(response.statusCode, 400);
  });

  const wsAddress = (await app.listen({host: '127.0.0.1', port: 0})).replace('http', 'ws');

  await t.test('a campaign-wide roll notification reaches a client subscribed to any scene', async () => {
    const socket = new WebSocket(`${wsAddress}/live`);
    t.after(() => socket.close());

    const nextMessage = () => new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for a websocket message')), 3000);
      socket.once('message', raw => {
        clearTimeout(timer);
        resolve(JSON.parse(raw.toString()));
      });
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    socket.send(JSON.stringify({token: bystander.token, campaignId, sceneId}));
    assert.equal((await nextMessage()).type, 'ready');

    const roll = request('POST', rollsPath(), player.token, {formula: '1d4'});
    assert.equal((await nextMessage()).type, 'rolls');
    assert.equal((await roll).statusCode, 201);
  });
});
