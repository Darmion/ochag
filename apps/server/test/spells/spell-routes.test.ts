import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('campaign spells: review queue', async t => {
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

  const owner = await register('gm_spells'), player = await register('player_spells'), other = await register('other_spells');

  const campaignId = (await request('POST', '/campaigns', owner.token, {name: 'Spell review test'})).json().id;

  const join = async (token: string) => {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, owner.token)).json().code;
    assert.equal((await request('POST', '/campaigns/join', token, {code})).statusCode, 201);
  };
  await join(player.token);
  await join(other.token);

  const spellsPath = `/campaigns/${campaignId}/spells`;
  const draftSpell = {
    name: 'Тестовая искра', level: 1, school: 'Evocation', castingTime: '1 action',
    range: '30 feet', components: 'V, S', duration: 'Instantaneous',
    concentration: false, ritual: false, classes: 'Wizard', description: 'Тестовое заклинание.',
  };

  let spellId: string;

  await t.test('an ordinary player\'s submission starts pending, not immediately visible campaign-wide', async () => {
    const created = await request('POST', spellsPath, player.token, draftSpell);
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().status, 'pending');
    spellId = created.json().id;

    const otherList = (await request('GET', spellsPath, other.token)).json().spells;
    assert.equal(otherList.some((s: any) => s.id === spellId), false);
  });

  await t.test('the submitter still sees their own pending spell in the list', async () => {
    const playerList = (await request('GET', spellsPath, player.token)).json().spells;
    assert.equal(playerList.some((s: any) => s.id === spellId), true);
  });

  await t.test('a manager (GM) sees the pending spell too, for review', async () => {
    const gmList = (await request('GET', spellsPath, owner.token)).json().spells;
    assert.equal(gmList.some((s: any) => s.id === spellId), true);
  });

  await t.test('a non-manager cannot review', async () => {
    assert.equal(
      (await request('PATCH', `${spellsPath}/${spellId}/review`, other.token, {status: 'approved'})).statusCode,
      403,
    );
  });

  await t.test('someone else cannot add the pending spell to their own character', async () => {
    const otherCharacterId = (await pg.query<{id: string}>(
      `INSERT INTO characters(campaign_id, owner_user_id, name) VALUES ($1,$2,'Other char') RETURNING id`,
      [campaignId, other.user.id],
    )).rows[0]!.id;

    const response = await request(
      'POST', `/campaigns/${campaignId}/characters/${otherCharacterId}/spells`, other.token,
      {source: 'custom', customSpellId: spellId},
    );
    assert.equal(response.statusCode, 403, response.body);
  });

  await t.test('the submitter can still add their own pending spell to their own character (playtesting)', async () => {
    const playerCharacterId = (await pg.query<{id: string}>(
      `INSERT INTO characters(campaign_id, owner_user_id, name) VALUES ($1,$2,'Player char') RETURNING id`,
      [campaignId, player.user.id],
    )).rows[0]!.id;

    const response = await request(
      'POST', `/campaigns/${campaignId}/characters/${playerCharacterId}/spells`, player.token,
      {source: 'custom', customSpellId: spellId},
    );
    assert.equal(response.statusCode, 201, response.body);
  });

  await t.test('the GM approves it — it becomes visible to everyone', async () => {
    const reviewed = await request('PATCH', `${spellsPath}/${spellId}/review`, owner.token, {status: 'approved'});
    assert.equal(reviewed.statusCode, 200, reviewed.body);
    assert.equal(reviewed.json().status, 'approved');
    assert.equal(reviewed.json().reviewedBy, owner.user.id);

    const otherList = (await request('GET', spellsPath, other.token)).json().spells;
    assert.equal(otherList.some((s: any) => s.id === spellId), true);
  });

  await t.test('a manager\'s own submission is auto-approved, no review needed', async () => {
    const created = await request('POST', spellsPath, owner.token, {...draftSpell, name: 'Мастерская искра'});
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().status, 'approved');
  });

  await t.test('a rejected spell stays invisible to everyone but its author and managers', async () => {
    const created = await request('POST', spellsPath, player.token, {...draftSpell, name: 'Отклонённая искра'});
    const rejectedId = created.json().id;

    assert.equal(
      (await request('PATCH', `${spellsPath}/${rejectedId}/review`, owner.token, {status: 'rejected'})).statusCode,
      200,
    );

    const otherList = (await request('GET', spellsPath, other.token)).json().spells;
    assert.equal(otherList.some((s: any) => s.id === rejectedId), false);
    const playerList = (await request('GET', spellsPath, player.token)).json().spells;
    assert.equal(playerList.some((s: any) => s.id === rejectedId), true);
  });
});

test('spell slots and casting', async t => {
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

  const owner = await register('gm_cast'), player = await register('player_cast'), bystander = await register('bystander_cast');
  const campaignId = (await request('POST', '/campaigns', owner.token, {name: 'Cast test'})).json().id;

  const join = async (token: string) => {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, owner.token)).json().code;
    assert.equal((await request('POST', '/campaigns/join', token, {code})).statusCode, 201);
  };
  await join(player.token);
  await join(bystander.token);

  const characterId = (await pg.query<{id: string}>(
    `INSERT INTO characters(campaign_id, owner_user_id, name, wisdom, level) VALUES ($1,$2,'Caster',8,5) RETURNING id`,
    [campaignId, player.user.id],
  )).rows[0]!.id;

  const slotsPath = `/campaigns/${campaignId}/characters/${characterId}/spell-slots`;
  const charSpellsPath = `/campaigns/${campaignId}/characters/${characterId}/spells`;
  const castPath = (spellId: string) => `${charSpellsPath}/${spellId}/cast`;

  await t.test('spell slots default to 0/0 at every level before anything is set', async () => {
    const slots = (await request('GET', slotsPath, player.token)).json().slots;
    assert.equal(slots.length, 9);
    assert.ok(slots.every((s: any) => s.current === 0 && s.max === 0));
    assert.deepEqual(slots.map((s: any) => s.level), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  await t.test('a bystander cannot set spell slots; the owner can', async () => {
    assert.equal((await request('PUT', `${slotsPath}/1`, bystander.token, {current: 4, max: 4})).statusCode, 403);

    const set = await request('PUT', `${slotsPath}/1`, player.token, {current: 4, max: 4});
    assert.equal(set.statusCode, 200, set.body);
    assert.deepEqual(set.json(), {level: 1, current: 4, max: 4});

    const set2 = await request('PUT', `${slotsPath}/2`, player.token, {current: 2, max: 2});
    assert.equal(set2.statusCode, 200);
  });

  await t.test('an out-of-range level (0 or 10) is rejected by the route schema', async () => {
    assert.equal((await request('PUT', `${slotsPath}/0`, player.token, {current: 1, max: 1})).statusCode, 400);
    assert.equal((await request('PUT', `${slotsPath}/10`, player.token, {current: 1, max: 1})).statusCode, 400);
  });

  let cantripId: string, leveledSpellId: string, blankSpellId: string;

  await t.test('a custom spell can carry damage/healing formulas, validated the same way as campaign_rules formulas', async () => {
    const badShape = await request('POST', `/campaigns/${campaignId}/spells`, owner.token, {
      name: 'Плохая формула', level: 1, school: 'Evocation', damageFormula: 'много кубиков',
    });
    assert.equal(badShape.statusCode, 400);

    // Deterministic: a 1-sided die always rolls 1.
    const leveled = await request('POST', `/campaigns/${campaignId}/spells`, owner.token, {
      name: 'Тестовый удар', level: 2, school: 'Evocation', damageFormula: '3d1+2',
    });
    assert.equal(leveled.statusCode, 201, leveled.body);
    leveledSpellId = leveled.json().id;
    assert.equal(leveled.json().damageFormula, '3d1+2');

    const cantrip = await request('POST', `/campaigns/${campaignId}/spells`, owner.token, {
      name: 'Тестовый заговор', level: 0, school: 'Evocation', healingFormula: '2d1+@wis',
    });
    assert.equal(cantrip.statusCode, 201, cantrip.body);
    cantripId = cantrip.json().id;

    const blank = await request('POST', `/campaigns/${campaignId}/spells`, owner.token, {
      name: 'Тестовый эффект', level: 1, school: 'Transmutation',
    });
    assert.equal(blank.statusCode, 201);
    blankSpellId = blank.json().id;
  });

  let charLeveledId: string, charCantripId: string, charBlankId: string;

  await t.test('the player learns all three test spells', async () => {
    const addLeveled = await request('POST', charSpellsPath, player.token, {source: 'custom', customSpellId: leveledSpellId});
    assert.equal(addLeveled.statusCode, 201, addLeveled.body);
    charLeveledId = addLeveled.json().id;

    const addCantrip = await request('POST', charSpellsPath, player.token, {source: 'custom', customSpellId: cantripId});
    charCantripId = addCantrip.json().id;

    const addBlank = await request('POST', charSpellsPath, player.token, {source: 'custom', customSpellId: blankSpellId});
    charBlankId = addBlank.json().id;
  });

  await t.test('casting a leveled spell with no slots available at that level is a clear 400, not a silent no-op', async () => {
    await request('PUT', `${slotsPath}/2`, player.token, {current: 0, max: 2});
    const response = await request('POST', castPath(charLeveledId), player.token, {});
    assert.equal(response.statusCode, 400);
  });

  await t.test('a bystander cannot cast someone else\'s spell', async () => {
    await request('PUT', `${slotsPath}/2`, player.token, {current: 1, max: 1});
    const response = await request('POST', castPath(charLeveledId), bystander.token, {});
    assert.equal(response.statusCode, 403);
  });

  await t.test('casting a leveled spell spends exactly one slot of its level and rolls the damage formula deterministically', async () => {
    const before = (await request('GET', slotsPath, player.token)).json().slots.find((s: any) => s.level === 2);
    assert.equal(before.current, 1);

    const response = await request('POST', castPath(charLeveledId), player.token, {});
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    assert.deepEqual(body.slot, {level: 2, current: 0, max: 1});
    assert.equal(body.damageRoll.total, 5);
    assert.equal(body.damageRoll.label, 'Заклинание: Тестовый удар (урон) — Caster');
    assert.equal(body.healingRoll, null);
  });

  await t.test('casting again with the slot now empty is rejected, not allowed to go negative', async () => {
    const response = await request('POST', castPath(charLeveledId), player.token, {});
    assert.equal(response.statusCode, 400);
    const slots = (await request('GET', slotsPath, player.token)).json().slots.find((s: any) => s.level === 2);
    assert.equal(slots.current, 0, 'a rejected cast must not have decremented the slot');
  });

  await t.test('a cantrip (level 0) never touches spell slots, even with slots at 0/0, and resolves an @-token in its formula', async () => {
    const response = await request('POST', castPath(charCantripId), player.token, {});
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    assert.equal(body.slot, null);
    assert.equal(body.damageRoll, null);
    assert.equal(body.healingRoll.total, 1);
    assert.equal(body.healingRoll.label, 'Заклинание: Тестовый заговор (лечение) — Caster');
  });

  await t.test('a spell with neither formula just spends its slot silently — not every spell deals damage or heals', async () => {
    await request('PUT', `${slotsPath}/1`, player.token, {current: 1, max: 1});
    const response = await request('POST', castPath(charBlankId), player.token, {});
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    assert.deepEqual(body.slot, {level: 1, current: 0, max: 1});
    assert.equal(body.damageRoll, null);
    assert.equal(body.healingRoll, null);
  });

  await t.test('casting an unknown character-spell id is a 404', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    assert.equal((await request('POST', castPath(unknown), player.token, {})).statusCode, 404);
  });

  await t.test('a manager (GM) can cast a spell for a character they do not own', async () => {
    await request('PUT', `${slotsPath}/1`, player.token, {current: 1, max: 1});
    const response = await request('POST', castPath(charBlankId), owner.token, {});
    assert.equal(response.statusCode, 201, response.body);
  });

  await t.test('SRD spell mechanics overlay: any authenticated user can set it (same authorization as translations), form is validated, and it is castable', async () => {
    const bad = await request('POST', '/srd/spells/fire-bolt/mechanics', player.token, {damageFormula: 'nonsense'});
    assert.equal(bad.statusCode, 400);

    const set = await request('POST', '/srd/spells/fire-bolt/mechanics', player.token, {damageFormula: '1d1'});
    assert.equal(set.statusCode, 200, set.body);
    assert.equal(set.json().damageFormula, '1d1');

    const srdList = (await request('GET', '/srd/spells', player.token)).json().spells;
    const fireBolt = srdList.find((s: any) => s.index === 'fire-bolt');
    assert.equal(fireBolt.damageFormula, '1d1');
    assert.equal(fireBolt.level, 0, 'fire-bolt is a cantrip — sanity check for the no-slot-consumption assertion below');

    const addFireBolt = await request('POST', charSpellsPath, player.token, {source: 'srd', srdIndex: 'fire-bolt'});
    assert.equal(addFireBolt.statusCode, 201, addFireBolt.body);

    const cast = await request('POST', castPath(addFireBolt.json().id), player.token, {});
    assert.equal(cast.statusCode, 201, cast.body);
    assert.equal(cast.json().slot, null);
    assert.equal(cast.json().damageRoll.total, 2);
  });

  await t.test('a formula using @prof with no level and no legacy proficiency is a clear 400 on cast, not a silent 0', async () => {
    const bareId = (await pg.query<{id: string}>(
      `INSERT INTO characters(campaign_id, owner_user_id, name) VALUES ($1,$2,'Bare caster') RETURNING id`,
      [campaignId, player.user.id],
    )).rows[0]!.id;
    const needsProfId = await request('POST', `/campaigns/${campaignId}/spells`, owner.token, {
      name: 'Требует мастерства', level: 0, school: 'Evocation', damageFormula: '1d1+@prof',
    });
    const known = await request(
      'POST', `/campaigns/${campaignId}/characters/${bareId}/spells`, player.token,
      {source: 'custom', customSpellId: needsProfId.json().id},
    );
    const response = await request(
      'POST', `/campaigns/${campaignId}/characters/${bareId}/spells/${known.json().id}/cast`, player.token, {},
    );
    assert.equal(response.statusCode, 400);
  });

  let upcastSpellId: string, charUpcastId: string;
  let mismatchedSpellId: string, charMismatchedId: string;

  await t.test('upcastFormula is validated as bare NdM — no modifier, no @-tokens', async () => {
    assert.equal(
      (await request('POST', `/campaigns/${campaignId}/spells`, owner.token, {
        name: 'Плохой апкаст 1', level: 1, school: 'Evocation', upcastFormula: '1d6+2',
      })).statusCode, 400,
    );
    assert.equal(
      (await request('POST', `/campaigns/${campaignId}/spells`, owner.token, {
        name: 'Плохой апкаст 2', level: 1, school: 'Evocation', upcastFormula: '1d6+@prof',
      })).statusCode, 400,
    );

    const created = await request('POST', `/campaigns/${campaignId}/spells`, owner.token, {
      name: 'Огненный шар теста', level: 3, school: 'Evocation', damageFormula: '2d1+1', upcastFormula: '1d1',
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().upcastFormula, '1d1');
    upcastSpellId = created.json().id;

    const mismatched = await request('POST', `/campaigns/${campaignId}/spells`, owner.token, {
      name: 'Несовместимый апкаст', level: 3, school: 'Evocation', damageFormula: '2d1+1', upcastFormula: '1d6',
    });
    assert.equal(mismatched.statusCode, 201, 'form is valid at save time — dice-type compatibility is only checked on cast');
    mismatchedSpellId = mismatched.json().id;
  });

  await t.test('the player learns the upcast test spells and gets slots at levels 3 and 5', async () => {
    charUpcastId = (await request('POST', charSpellsPath, player.token, {source: 'custom', customSpellId: upcastSpellId})).json().id;
    charMismatchedId = (await request('POST', charSpellsPath, player.token, {source: 'custom', customSpellId: mismatchedSpellId})).json().id;
    await request('PUT', `${slotsPath}/3`, player.token, {current: 2, max: 2});
    await request('PUT', `${slotsPath}/5`, player.token, {current: 1, max: 1});
  });

  await t.test('casting at the spell\'s own level (slotLevel omitted or equal) applies no upcast bonus', async () => {
    const response = await request('POST', castPath(charUpcastId), player.token, {slotLevel: 3});
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    assert.equal(body.damageRoll.total, 3);
    assert.deepEqual(body.slot, {level: 3, current: 1, max: 2});
  });

  await t.test('casting with a higher slotLevel consumes THAT level\'s slot and rolls extra upcast dice', async () => {
    const response = await request('POST', castPath(charUpcastId), player.token, {slotLevel: 5});
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    assert.equal(body.damageRoll.total, 5);
    assert.equal(body.damageRoll.formula, '4d1+1');
    assert.deepEqual(body.slot, {level: 5, current: 0, max: 1});

    const slots = (await request('GET', slotsPath, player.token)).json().slots;
    assert.equal(slots.find((s: any) => s.level === 3).current, 1, 'the level-3 slot must be untouched by a level-5 cast');
  });

  await t.test('slotLevel below the spell\'s own level is rejected', async () => {
    const response = await request('POST', castPath(charUpcastId), player.token, {slotLevel: 2});
    assert.equal(response.statusCode, 400);
  });

  await t.test('slotLevel on a cantrip is rejected — cantrips have nothing to upcast', async () => {
    const response = await request('POST', castPath(charCantripId), player.token, {slotLevel: 3});
    assert.equal(response.statusCode, 400);
  });

  await t.test('an upcast formula with dice of a different type than the base formula is rejected at cast time, not silently approximated', async () => {
    await request('PUT', `${slotsPath}/4`, player.token, {current: 1, max: 1});
    const response = await request('POST', castPath(charMismatchedId), player.token, {slotLevel: 4});
    assert.equal(response.statusCode, 400);
  });
});
