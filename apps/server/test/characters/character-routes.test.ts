import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('character sheet: read and direct edit', async t => {
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

  const owner = await register('gm_sheet'), player = await register('player_sheet'), stranger = await register('stranger_sheet');

  const campaignId = (await request('POST', '/campaigns', owner.token, {name: 'Sheet test'})).json().id;

  const join = async (token: string) => {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, owner.token)).json().code;
    assert.equal((await request('POST', '/campaigns/join', token, {code})).statusCode, 201);
  };
  await join(player.token);
  await join(stranger.token);

  const characterId = (await pg.query<{id: string}>(
    `INSERT INTO characters(campaign_id, owner_user_id, name, dexterity, sheet_extra)
     VALUES ($1,$2,'Sheet character',14,'{"skills":{"stealth":3}}'::jsonb) RETURNING id`,
    [campaignId, player.user.id],
  )).rows[0]!.id;

  const path = () => `/campaigns/${campaignId}/characters/${characterId}`;

  await t.test('a fellow campaign member (not owner/manager) can now read the sheet — everything public by default', async () => {
    const response = await request('GET', path(), stranger.token);
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.privileged, false);
    assert.deepEqual(body.hiddenFields, []);
    assert.equal(body.dexterity, 14);
    assert.equal(body.visibility, undefined);
  });

  await t.test('the owner can read their own full sheet, including sheet_extra', async () => {
    const response = await request('GET', path(), player.token);
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.name, 'Sheet character');
    assert.equal(body.dexterity, 14);
    assert.deepEqual(body.sheet_extra, {skills: {stealth: 3}});
    // pg returns numeric columns as strings unless cast; the client sends this value back to Ajv, which expects a number.
    assert.equal(typeof body.speed_feet, 'number');
    assert.deepEqual(body.effects, []);
    assert.deepEqual(body.resources, []);
    assert.equal(body.privileged, true);
    assert.deepEqual(body.visibility, {});
  });

  await t.test('the campaign owner (GM) can read any character sheet', async () => {
    assert.equal((await request('GET', path(), owner.token)).statusCode, 200);
  });

  await t.test('a stranger cannot edit the sheet', async () => {
    assert.equal(
      (await request('PATCH', path(), stranger.token, {revision: 1, hpCurrent: 1})).statusCode,
      403,
    );
  });

  await t.test('a stale revision is rejected', async () => {
    assert.equal(
      (await request('PATCH', path(), player.token, {revision: 99, hpCurrent: 5})).statusCode,
      409,
    );
  });

  await t.test('the owner can directly edit hp without going through the import flow', async () => {
    const response = await request('PATCH', path(), player.token, {revision: 1, hpCurrent: 7, hpMax: 12});
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.hp_current, 7);
    assert.equal(body.hp_max, 12);
    assert.equal(body.revision, 2);
    assert.equal(body.dexterity, 14);
  });

  await t.test('sheet_extra is replaced wholesale, not merged key by key', async () => {
    const response = await request('PATCH', path(), player.token, {
      revision: 2,
      sheetExtra: {notes: 'new only'},
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().sheet_extra, {notes: 'new only'});
  });

  await t.test('an unknown field in the body is rejected', async () => {
    assert.equal(
      (await request('PATCH', path(), player.token, {revision: 3, unknownField: 1})).statusCode,
      400,
    );
  });

  await t.test('a manager (GM) can edit a character they do not own', async () => {
    const response = await request('PATCH', path(), owner.token, {revision: 3, hpCurrent: 0});
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().hp_current, 0);
  });

  await t.test('reading or editing an unknown character is a 404', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    assert.equal((await request('GET', `/campaigns/${campaignId}/characters/${unknown}`, player.token)).statusCode, 404);
  });

  await t.test('a PATCH that round-trips speedFeet as read from GET is accepted, not rejected as the wrong type', async () => {
    const current = (await request('GET', path(), player.token)).json();
    const response = await request('PATCH', path(), player.token, {
      revision: current.revision,
      speedFeet: current.speed_feet,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(typeof response.json().speed_feet, 'number');
  });

  await t.test('level starts unset and can be set within 1–20, not outside it', async () => {
    const before = (await request('GET', path(), player.token)).json();
    assert.equal(before.level, null);

    const set = await request('PATCH', path(), player.token, {revision: before.revision, level: 5});
    assert.equal(set.statusCode, 200, set.body);
    assert.equal(set.json().level, 5);
    assert.equal(set.json().dexterity, 14);

    const current = (await request('GET', path(), player.token)).json();
    const tooHigh = await request('PATCH', path(), player.token, {revision: current.revision, level: 21});
    assert.equal(tooHigh.statusCode, 400);
    const tooLow = await request('PATCH', path(), player.token, {revision: current.revision, level: 0});
    assert.equal(tooLow.statusCode, 400);
  });

  const effectsPath = () => `${path()}/effects`;

  await t.test('a stranger cannot add an effect to someone else\'s character', async () => {
    assert.equal((await request('POST', effectsPath(), stranger.token, {effectCode: 'poisoned'})).statusCode, 403);
  });

  let effectId = '';

  await t.test('the owner adds an effect, and it appears on the sheet', async () => {
    const response = await request('POST', effectsPath(), player.token, {effectCode: 'poisoned'});
    assert.equal(response.statusCode, 201, response.body);
    effectId = response.json().id;
    assert.equal(response.json().alreadyActive, false);

    const sheet = (await request('GET', path(), player.token)).json();
    assert.deepEqual(sheet.effects, [{id: effectId, effect_code: 'poisoned', parameters: {}, active: true}]);
  });

  await t.test('adding the same active effect again is idempotent', async () => {
    const response = await request('POST', effectsPath(), player.token, {effectCode: 'poisoned'});
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), {id: effectId, alreadyActive: true});
  });

  await t.test('a manager (GM) can toggle the effect off without deleting it', async () => {
    const response = await request('PATCH', `${effectsPath()}/${effectId}`, owner.token, {active: false});
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().active, false);

    const sheet = (await request('GET', path(), player.token)).json();
    assert.equal(sheet.effects.length, 1);
    assert.equal(sheet.effects[0].active, false);
  });

  await t.test('deleting the effect removes it entirely', async () => {
    assert.equal((await request('DELETE', `${effectsPath()}/${effectId}`, player.token)).statusCode, 204);
    assert.deepEqual((await request('GET', path(), player.token)).json().effects, []);
  });

  const resourcesPath = () => `${path()}/resources`;

  await t.test('a stranger cannot add a resource to someone else\'s character', async () => {
    assert.equal(
      (await request('POST', resourcesPath(), stranger.token, {name: 'Rage', current: 2, max: 2})).statusCode,
      403,
    );
  });

  let resourceId = '';

  await t.test('the owner creates a resource', async () => {
    const response = await request('POST', resourcesPath(), player.token, {name: 'Rage', current: 2, max: 2});
    assert.equal(response.statusCode, 201, response.body);
    resourceId = response.json().id;
    assert.deepEqual(response.json(), {id: resourceId, name: 'Rage', current: 2, max: 2, recharge: 'none'});
  });

  await t.test('spending the resource is a PATCH with the new absolute value', async () => {
    const response = await request('PATCH', `${resourcesPath()}/${resourceId}`, player.token, {current: 1});
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().current, 1);
    assert.equal(response.json().max, 2);
  });

  await t.test('current is not clamped to max in the database — a temporary bonus above max is accepted', async () => {
    const response = await request('PATCH', `${resourcesPath()}/${resourceId}`, owner.token, {current: 5});
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().current, 5);
  });

  await t.test('deleting the resource removes it entirely', async () => {
    assert.equal((await request('DELETE', `${resourcesPath()}/${resourceId}`, player.token)).statusCode, 204);
    assert.deepEqual((await request('GET', path(), player.token)).json().resources, []);
  });

  const weaponsPath = () => `${path()}/weapons`;

  await t.test('a stranger cannot add a weapon to someone else\'s character', async () => {
    assert.equal(
      (await request('POST', weaponsPath(), stranger.token, {name: 'Меч', ability: 'strength'})).statusCode,
      403,
    );
  });

  let weaponId = '';

  await t.test('the owner creates a weapon, proficient by default', async () => {
    const response = await request('POST', weaponsPath(), player.token, {name: 'Меч', ability: 'strength'});
    assert.equal(response.statusCode, 201, response.body);
    weaponId = response.json().id;
    assert.deepEqual(response.json(), {id: weaponId, name: 'Меч', ability: 'strength', proficient: true, damage_formula: null, damage_type: null, range_feet: 5, weapon_kind: 'melee', long_range_feet: null, thrown_range_feet: null, versatile_formula: null, ammo_resource_id: null, properties: [], srd_index: null, attack_bonus: 0, extra_damage_formula: null, extra_damage_type: null});
  });

  await t.test('an unknown ability is rejected by the schema', async () => {
    assert.equal(
      (await request('POST', weaponsPath(), player.token, {name: 'Лук', ability: 'wisdom'})).statusCode,
      400,
    );
  });

  await t.test('the owner can rename the weapon, change its ability, and toggle proficiency', async () => {
    const response = await request('PATCH', `${weaponsPath()}/${weaponId}`, player.token, {name: 'Кинжал', ability: 'dexterity', proficient: false});
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {id: weaponId, name: 'Кинжал', ability: 'dexterity', proficient: false, damage_formula: null, damage_type: null, range_feet: 5, weapon_kind: 'melee', long_range_feet: null, thrown_range_feet: null, versatile_formula: null, ammo_resource_id: null, properties: [], srd_index: null, attack_bonus: 0, extra_damage_formula: null, extra_damage_type: null});
  });

  await t.test('the character sheet includes the weapon in its response', async () => {
    const sheet = (await request('GET', path(), player.token)).json();
    assert.deepEqual(sheet.weapons, [{id: weaponId, name: 'Кинжал', ability: 'dexterity', proficient: false, damage_formula: null, damage_type: null, range_feet: 5, weapon_kind: 'melee', long_range_feet: null, thrown_range_feet: null, versatile_formula: null, ammo_resource_id: null, properties: [], srd_index: null, attack_bonus: 0, extra_damage_formula: null, extra_damage_type: null}]);
  });

  await t.test('deleting the weapon removes it entirely', async () => {
    assert.equal((await request('DELETE', `${weaponsPath()}/${weaponId}`, player.token)).statusCode, 204);
    assert.deepEqual((await request('GET', path(), player.token)).json().weapons, []);
  });

  const visibilityPath = (fieldKey: string) => `${path()}/visibility/${fieldKey}`;

  await t.test('a stranger cannot set visibility on someone else\'s character', async () => {
    assert.equal(
      (await request('PUT', visibilityPath('strength'), stranger.token, {mode: 'hidden'})).statusCode,
      403,
    );
  });

  await t.test('an unknown field key is rejected', async () => {
    assert.equal(
      (await request('PUT', visibilityPath('not_a_real_field'), player.token, {mode: 'hidden'})).statusCode,
      400,
    );
  });

  await t.test('owner hides strength from everyone — a fellow member sees a placeholder, owner and GM still see the value', async () => {
    assert.equal((await request('PUT', visibilityPath('strength'), player.token, {mode: 'hidden'})).statusCode, 200);

    const strangerView = (await request('GET', path(), stranger.token)).json();
    assert.equal(strangerView.strength, null);
    assert.deepEqual(strangerView.hiddenFields, ['strength']);

    const ownerView = (await request('GET', path(), player.token)).json();
    assert.equal(ownerView.strength, 10);
    assert.deepEqual(ownerView.visibility, {strength: {mode: 'hidden', allowedUserIds: []}});

    assert.equal((await request('GET', path(), owner.token)).json().strength, 10);
  });

  await t.test('owner then allow-lists strength to just the GM (as an ordinary campaign member) — the stranger still cannot see it', async () => {
    assert.equal(
      (await request('PUT', visibilityPath('strength'), player.token, {mode: 'allowlist', allowedUserIds: [owner.user.id]})).statusCode,
      200,
    );

    assert.equal((await request('GET', path(), owner.token)).json().strength, 10);
    const strangerView = (await request('GET', path(), stranger.token)).json();
    assert.equal(strangerView.strength, null);
    assert.deepEqual(strangerView.hiddenFields, ['strength']);
  });

  await t.test('setting mode back to public removes the restriction', async () => {
    assert.equal((await request('PUT', visibilityPath('strength'), player.token, {mode: 'public'})).statusCode, 200);
    assert.equal((await request('GET', path(), stranger.token)).json().strength, 10);
  });

  await t.test('an omitted-bucket field (weapons) disappears entirely for a restricted viewer instead of showing a placeholder', async () => {
    await request('PATCH', path(), player.token, {
      revision: (await request('GET', path(), player.token)).json().revision,
      sheetExtra: {weapons: [{name: 'Dagger'}], saves: {str: true}},
    });
    assert.equal((await request('PUT', visibilityPath('weapons'), player.token, {mode: 'hidden'})).statusCode, 200);

    const strangerView = (await request('GET', path(), stranger.token)).json();
    assert.equal(strangerView.sheet_extra.weapons, undefined);
    assert.notEqual(strangerView.hiddenFields.includes('weapons'), true);
    assert.deepEqual(strangerView.sheet_extra.saves, {str: true});
  });

  await t.test('an effect hidden from everyone is dropped from a fellow member\'s effects list, not just nulled', async () => {
    const added = await request('POST', effectsPath(), player.token, {effectCode: 'invisible'});
    const effectId = added.json().id;

    assert.equal(
      (await request('PUT', visibilityPath(`effect:${effectId}`), player.token, {mode: 'hidden'})).statusCode,
      200,
    );

    const strangerEffects = (await request('GET', path(), stranger.token)).json().effects;
    assert.deepEqual(strangerEffects, []);
    const ownerEffects = (await request('GET', path(), player.token)).json().effects;
    assert.equal(ownerEffects.some((e: any) => e.id === effectId), true);
  });

  const accessPath = (userId: string) => `${path()}/access/${userId}`;

  await t.test('a stranger cannot grant themselves access', async () => {
    assert.equal(
      (await request('PUT', accessPath(stranger.user.id), stranger.token, {level: 'edit'})).statusCode,
      403,
    );
  });

  await t.test('granting access to a non-member is rejected', async () => {
    const nobody = '00000000-0000-4000-8000-000000000001';
    assert.equal(
      (await request('PUT', accessPath(nobody), player.token, {level: 'edit'})).statusCode,
      400,
    );
  });

  await t.test('owner denies the stranger — the character disappears from GET entirely (404, not a redacted 200)', async () => {
    assert.equal((await request('PUT', accessPath(stranger.user.id), player.token, {level: 'denied'})).statusCode, 200);
    assert.equal((await request('GET', path(), stranger.token)).statusCode, 404);
    assert.equal((await request('GET', path(), player.token)).statusCode, 200);
    assert.equal((await request('GET', path(), owner.token)).statusCode, 200);
  });

  await t.test('the denied character is also missing from the campaign roster for that user, but not for others', async () => {
    const strangerList = (await request('GET', `/campaigns/${campaignId}/characters`, stranger.token)).json().characters;
    assert.equal(strangerList.some((c: any) => c.id === characterId), false);
    const ownerList = (await request('GET', `/campaigns/${campaignId}/characters`, owner.token)).json().characters;
    assert.equal(ownerList.some((c: any) => c.id === characterId), true);
  });

  await t.test('setting level back to view removes the denial', async () => {
    assert.equal((await request('PUT', accessPath(stranger.user.id), player.token, {level: 'view'})).statusCode, 200);
    assert.equal((await request('GET', path(), stranger.token)).statusCode, 200);
  });

  await t.test('owner grants the stranger full edit rights — they can now PATCH a character they do not own', async () => {
    assert.equal((await request('PUT', accessPath(stranger.user.id), player.token, {level: 'edit'})).statusCode, 200);

    const current = (await request('GET', path(), stranger.token)).json();
    assert.equal(current.privileged, true);

    const response = await request('PATCH', path(), stranger.token, {revision: current.revision, hpCurrent: 3});
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().hp_current, 3);
  });

  await t.test('an edit grant also lets that player manage the character\'s field visibility, same as the owner', async () => {
    assert.equal(
      (await request('PUT', `${path()}/visibility/constitution`, stranger.token, {mode: 'hidden'})).statusCode,
      200,
    );
    assert.equal(
      (await request('PUT', `${path()}/visibility/constitution`, stranger.token, {mode: 'public'})).statusCode,
      200,
    );
  });

  await t.test('revoke the stranger\'s edit grant so later tests see them as an ordinary, non-privileged viewer again', async () => {
    assert.equal(
      (await request('PUT', accessPath(stranger.user.id), player.token, {level: 'view'})).statusCode,
      200,
    );
  });

  await t.test('cannot grant access to the character\'s own owner', async () => {
    assert.equal(
      (await request('PUT', accessPath(player.user.id), owner.token, {level: 'denied'})).statusCode,
      400,
    );
  });

  const savesPath = () => `${path()}/saves`;

  await t.test('saves default to not proficient, zero bonus, visible', async () => {
    const saves = (await request('GET', savesPath(), player.token)).json().saves;
    assert.equal(saves.length, 6);
    const dex = saves.find((s: any) => s.ability === 'dexterity');
    assert.deepEqual(dex, {ability: 'dexterity', hidden: false, proficient: false, customBonus: 0});
  });

  await t.test('setting proficient and a custom bonus persists', async () => {
    const response = await request(
      'PUT', `${savesPath()}/dexterity`, player.token, {proficient: true, customBonus: 2},
    );
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {ability: 'dexterity', proficient: true, customBonus: 2});

    const saves = (await request('GET', savesPath(), stranger.token)).json().saves;
    const dex = saves.find((s: any) => s.ability === 'dexterity');
    assert.deepEqual(dex, {ability: 'dexterity', hidden: false, proficient: true, customBonus: 2});
  });

  await t.test('hiding a save shows a placeholder row (hidden:true, nulled values), not an omitted one', async () => {
    assert.equal(
      (await request('PUT', visibilityPath('save:dexterity'), player.token, {mode: 'hidden'})).statusCode,
      200,
    );

    const strangerSaves = (await request('GET', savesPath(), stranger.token)).json().saves;
    assert.equal(strangerSaves.length, 6);
    const dex = strangerSaves.find((s: any) => s.ability === 'dexterity');
    assert.deepEqual(dex, {ability: 'dexterity', hidden: true, proficient: null, customBonus: null});

    const ownerSaves = (await request('GET', savesPath(), player.token)).json().saves;
    assert.deepEqual(
      ownerSaves.find((s: any) => s.ability === 'dexterity'),
      {ability: 'dexterity', hidden: false, proficient: true, customBonus: 2},
    );

    await request('PUT', visibilityPath('save:dexterity'), player.token, {mode: 'public'});
  });
});
