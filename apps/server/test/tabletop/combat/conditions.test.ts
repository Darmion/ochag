import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('conditions with mechanical consequences', async t => {
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

  const gm = await register('gm_cond'), alice = await register('alice_cond'), bob = await register('bob_cond');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Cond'})).json().id;
  for (const member of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  await pg.query<any>('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  await pg.query(
    `INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'party_vision','flag','Обзор отряда','false'::jsonb,$2)`,
    [campaignId, gm.user.id],
  );
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Поляна', widthCells: 10, heightCells: 10})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const hero = (await request('POST', `${base}/characters`, alice.token, {
    kind: 'character', name: 'Лира', dexterity: 14, constitution: 12, hpMax: 20, hpCurrent: 20, armorClass: 14, speedFeet: 30,
  })).json();
  const goblin = (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name: 'Гоблин', disposition: 'hostile', dexterity: 14, hpMax: 7, hpCurrent: 7, armorClass: 15, speedFeet: 30,
  })).json();
  const ally = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Страж', disposition: 'friendly', hpMax: 11, hpCurrent: 11})).json();
  const weaponId = (await pg.query<any>(
    `INSERT INTO character_weapons(campaign_id, character_id, name, ability, proficient) VALUES ($1,$2,'Кинжал','dexterity',false) RETURNING id`,
    [campaignId, hero.id],
  )).rows[0]!.id;

  await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: 0.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 1.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: ally.id, x: -4.5, z: -4.5});

  const effect = (characterId: string, effectCode: string, token = gm.token) =>
    request('POST', `${base}/characters/${characterId}/effects`, token, {effectCode});
  const clearEffects = (characterId: string) => pg.query<any>('DELETE FROM character_effects WHERE character_id=$1', [characterId]);
  const codes = async (characterId: string) =>
    (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active ORDER BY effect_code', [characterId])).rows.map(r => r.effect_code);
  const check = (token: string, payload: any) => request('POST', `${base}/rolls/check`, token, payload);
  const setHp = (characterId: string, hp: number) => pg.query<any>('UPDATE characters SET hp_current=$2, hp_temp=0 WHERE id=$1', [characterId, hp]);
  const damage = async (characterId: string, formula: string, critical = false) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula})).json();
    return request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId, mode: 'damage', ...(critical ? {critical} : {})});
  };

  await t.test('own conditions: poisoned attacker rolls with disadvantage; chosen advantage cancels it', async () => {
    await effect(hero.id, 'poisoned', alice.token);
    const plain = await check(alice.token, {characterId: hero.id, kind: 'attack', key: weaponId});
    assert.equal(plain.statusCode, 201, plain.body);
    assert.equal(plain.json().outcome.advantage, 'disadv');
    assert.match(plain.json().formula, /^2d20dis/);
    assert.deepEqual(plain.json().outcome.reasons, ['помеха: отравлен']);
    assert.equal(plain.json().total, Math.min(...plain.json().dice_results) + plain.json().modifier);

    const chosen = await check(alice.token, {characterId: hero.id, kind: 'attack', key: weaponId, advantage: 'adv'});
    assert.equal(chosen.json().outcome.advantage, 'none');
    assert.equal(chosen.json().dice_results.length, 1, 'cancelled out — a plain single d20 (PHB p. 173)');
    assert.ok(chosen.json().outcome.reasons.includes('преимущество и помеха гасят друг друга'));
    await clearEffects(hero.id);
  });

  await t.test('an attack against a target: hit by AC, advantage and an automatic crit against the paralyzed within 5 ft', async () => {
    const plain = (await check(alice.token, {characterId: hero.id, kind: 'attack', key: weaponId, targetCharacterId: goblin.id, sceneId})).json();
    const natural = plain.dice_results[0];
    assert.equal(plain.outcome.target.name, 'Гоблин');
    assert.equal(plain.outcome.hit, natural === 20 || (natural !== 1 && plain.total >= 15));
    assert.match(plain.label, /→ Гоблин$/);

    await effect(goblin.id, 'paralyzed');
    const helpless = (await check(alice.token, {characterId: hero.id, kind: 'attack', key: weaponId, targetCharacterId: goblin.id, sceneId})).json();
    assert.equal(helpless.outcome.advantage, 'adv');
    const kept = Math.max(...helpless.dice_results);
    assert.equal(helpless.total, kept + helpless.modifier);
    if (helpless.outcome.hit) assert.equal(helpless.outcome.critical, true, 'a hit on a paralyzed target within 5 ft is a crit');
    assert.equal((await check(alice.token, {characterId: hero.id, kind: 'skill', key: 'perception', targetCharacterId: goblin.id})).statusCode, 400);
    await clearEffects(goblin.id);
  });

  await t.test('incapacitated creatures cannot attack or Dash; charmed cannot attack the charmer', async () => {
    await effect(hero.id, 'stunned', alice.token);
    const stunned = await check(alice.token, {characterId: hero.id, kind: 'attack', key: weaponId});
    assert.equal(stunned.statusCode, 400);
    assert.match(stunned.json().message, /не может атаковать: ошеломлён/);
    const save = (await check(alice.token, {characterId: hero.id, kind: 'save', key: 'dexterity'})).json();
    assert.equal(save.outcome.autoFail, true, 'stunned auto-fails DEX saves');
    await clearEffects(hero.id);

    await pg.query<any>(
      `INSERT INTO character_effects(campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'charmed',$3::jsonb)`,
      [campaignId, hero.id, JSON.stringify({sourceCharacterId: goblin.id})],
    );
    const charmed = await check(alice.token, {characterId: hero.id, kind: 'attack', key: weaponId, targetCharacterId: goblin.id});
    assert.equal(charmed.statusCode, 400);
    assert.match(charmed.json().message, /очарован/);
    await clearEffects(hero.id);
  });

  await t.test('applying a condition with a save: DC 40 always fails, DC 1 always succeeds; players need their own source', async () => {
    const strong = await request('POST', `${base}/conditions/apply`, gm.token, {
      targetIds: [goblin.id], code: 'frightened', save: {ability: 'wisdom', dc: 40}, durationRounds: 1, sourceName: 'Страх',
    });
    assert.equal(strong.statusCode, 200, strong.body);
    assert.equal(strong.json().results[0].applied, true);
    assert.deepEqual(await codes(goblin.id), ['frightened']);
    const params = (await pg.query<any>(`SELECT parameters FROM character_effects WHERE character_id=$1`, [goblin.id])).rows[0]!.parameters;
    assert.deepEqual([params.remainingRounds, params.sourceName, params.source], [1, 'Страх', 'apply']);

    const weak = await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [ally.id], code: 'poisoned', save: {ability: 'constitution', dc: 1}});
    assert.equal(weak.json().results[0].applied, false);
    assert.deepEqual(await codes(ally.id), []);

    assert.equal((await request('POST', `${base}/conditions/apply`, bob.token, {targetIds: [goblin.id], code: 'prone'})).statusCode, 403);
    assert.equal((await request('POST', `${base}/conditions/apply`, bob.token, {targetIds: [goblin.id], code: 'prone', sourceCharacterId: hero.id})).statusCode, 403);
    const own = await request('POST', `${base}/conditions/apply`, alice.token, {targetIds: [goblin.id], code: 'prone', sourceCharacterId: hero.id});
    assert.equal(own.statusCode, 200, 'Alice applies a condition with her own creature');
    assert.equal((await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [goblin.id], code: 'exhaustion'})).statusCode, 400);
    await clearEffects(goblin.id);
  });

  const initiative = `${scenePath}/initiative`;
  const advance = (token = gm.token) => request('POST', `${initiative}/advance`, token);

  await t.test('durations run out at the end of the bearer’s turn; a repeat save at the end of the turn can end it', async () => {
    const heroEntry = (await request('POST', `${initiative}/join`, alice.token, {characterId: hero.id})).json().id;
    const goblinEntry = (await request('POST', `${initiative}/join`, gm.token, {characterId: goblin.id})).json().id;
    await request('PATCH', `${initiative}/${heroEntry}`, gm.token, {score: 20});
    await request('PATCH', `${initiative}/${goblinEntry}`, gm.token, {score: 10});

    await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [goblin.id], code: 'blinded', durationRounds: 1});
    await request('POST', `${base}/conditions/apply`, gm.token, {
      targetIds: [goblin.id], code: 'frightened', save: {ability: 'wisdom', dc: 40}, repeatSave: 'end',
    });
    await pg.query<any>(`UPDATE character_effects SET parameters = jsonb_set(parameters, '{save,dc}', '1') WHERE character_id=$1 AND effect_code='frightened'`, [goblin.id]);

    await advance();
    assert.deepEqual(await codes(goblin.id), ['blinded', 'frightened'], 'nothing happens on someone else’s turn');
    await advance();
    assert.deepEqual(await codes(goblin.id), ['blinded', 'frightened']);
    await advance();
    assert.deepEqual(await codes(goblin.id), [], 'the 1-round blindness ran out, the fear was saved against');
    const repeat = (await request('GET', `${base}/rolls`, gm.token)).json().rolls.find((r: any) => r.label.includes('против «испуган»'));
    assert.equal(repeat.outcome.dc, 1);
    assert.equal(repeat.outcome.success, true);
    await request('DELETE', initiative, gm.token);
  });

  await t.test('movement: grappled stops, prone crawls at double cost, standing up costs half the speed', async () => {
    const heroEntry = (await request('POST', `${initiative}/join`, alice.token, {characterId: hero.id})).json().id;
    await request('POST', `${initiative}/join`, gm.token, {characterId: goblin.id});
    await request('PATCH', `${initiative}/${heroEntry}`, gm.token, {score: 25});
    await advance();
    const heroPlacement = (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.character_id === hero.id);
    const move = async (x: number, z: number) => {
      const current = (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.id === heroPlacement.id);
      return request('PUT', `${scenePath}/objects/${heroPlacement.id}`, alice.token, {
        x, y: 0, z, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
      });
    };

    await effect(hero.id, 'grappled', alice.token);
    const stuck = await move(0.5, 1.5);
    assert.equal(stuck.statusCode, 400);
    assert.match(stuck.json().message, /не может двигаться: скорость 0: схвачен/);
    await clearEffects(hero.id);

    await effect(hero.id, 'prone', alice.token);
    assert.equal((await move(0.5, 1.5)).statusCode, 200, 'crawling 5 ft');
    let entry = (await request('GET', initiative, gm.token)).json().entries.find((e: any) => e.id === heroEntry);
    assert.equal(entry.moved_feet, 10, 'crawling costs double');
    const stand = await request('POST', `${base}/characters/${hero.id}/stand`, alice.token);
    assert.equal(stand.statusCode, 200, stand.body);
    assert.equal(stand.json().spentMovement, true);
    entry = (await request('GET', initiative, gm.token)).json().entries.find((e: any) => e.id === heroEntry);
    assert.equal(entry.moved_feet, 25, 'half of 30 ft to stand up');
    assert.deepEqual(await codes(hero.id), []);
    assert.equal((await request('POST', `${base}/characters/${hero.id}/stand`, alice.token)).statusCode, 400, 'not prone any more');
    await request('DELETE', initiative, gm.token);
  });

  await t.test('0 HP: a character falls unconscious and prone, damage at 0 is a death-save failure, healing wakes', async () => {
    await clearEffects(hero.id);
    await setHp(hero.id, 3);
    const down = await damage(hero.id, '1d1+4');
    assert.equal(down.statusCode, 200, down.body);
    assert.equal(down.json().hp_current, 0);
    assert.deepEqual(await codes(hero.id), ['prone', 'unconscious']);
    assert.ok(down.json().notices.some((n: any) => /без сознания/.test(n.title)));

    const hit = await damage(hero.id, '1d1+1', true);
    assert.equal(hit.statusCode, 200);
    let sheet = (await pg.query<any>('SELECT death_successes, death_failures FROM characters WHERE id=$1', [hero.id])).rows[0]!;
    assert.equal(sheet.death_failures, 2, 'a crit at 0 HP counts twice');

    const save = await request('POST', `${base}/characters/${hero.id}/death-save`, alice.token);
    assert.equal(save.statusCode, 200, save.body);
    assert.ok(['success', 'failure', 'stable', 'dead', 'revived'].includes(save.json().result));
    assert.equal(save.json().roll.outcome.kind, 'death');
    assert.equal((await request('POST', `${base}/characters/${hero.id}/death-save`, bob.token)).statusCode, 403);

    if (save.json().result !== 'dead') {
      if (save.json().result !== 'revived') {
        const healRoll = (await request('POST', `${base}/rolls`, gm.token, {formula: '1d1+4'})).json();
        const healed = await request('POST', `${base}/rolls/${healRoll.id}/apply`, gm.token, {characterId: hero.id, mode: 'heal'});
        assert.equal(healed.json().hp_current, 5);
      }
      assert.deepEqual(await codes(hero.id), ['prone'], 'awake, still prone');
      sheet = (await pg.query<any>('SELECT death_successes, death_failures FROM characters WHERE id=$1', [hero.id])).rows[0]!;
      assert.deepEqual([sheet.death_successes, sheet.death_failures], [0, 0]);
    }
    await clearEffects(hero.id);
    await pg.query<any>('UPDATE characters SET death_successes=0, death_failures=0 WHERE id=$1', [hero.id]);
  });

  await t.test('massive damage kills outright; NPCs at 0 HP are dead; the dead are not healed', async () => {
    await setHp(hero.id, 5);
    const massive = await damage(hero.id, '1d1+24');
    assert.ok(massive.json().notices.some((n: any) => /погибает/.test(n.title)));
    assert.deepEqual(await codes(hero.id), ['dead']);
    const healRoll = (await request('POST', `${base}/rolls`, gm.token, {formula: '1d1+4'})).json();
    const healed = await request('POST', `${base}/rolls/${healRoll.id}/apply`, gm.token, {characterId: hero.id, mode: 'heal'});
    assert.equal(healed.json().hp_current, 0);
    assert.equal(healed.json().blocked, 'dead');
    await clearEffects(hero.id);
    await setHp(hero.id, 20);

    await setHp(goblin.id, 2);
    await damage(goblin.id, '1d1+2');
    assert.deepEqual(await codes(goblin.id), ['dead']);
    await clearEffects(goblin.id);
    await setHp(goblin.id, 7);
  });

  await t.test('exhaustion 4 halves the hit point maximum for healing', async () => {
    await setHp(hero.id, 2);
    await effect(hero.id, 'exhaustion_4', alice.token);
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: '1d1+30'})).json();
    const healed = await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId: hero.id, mode: 'heal'});
    assert.equal(healed.json().hp_current, 10);
    await clearEffects(hero.id);
    await setHp(hero.id, 20);
  });

  await t.test('concentration: a concentration spell starts it, damage forces a CON save at DC max(10, half)', async () => {
    const spellId = (await pg.query<any>(
      `INSERT INTO campaign_spells(campaign_id, created_by, name, level, school, concentration, status)
       VALUES ($1,$2,'Благословение',0,'Enchantment',true,'approved') RETURNING id`,
      [campaignId, alice.user.id],
    )).rows[0]!.id;
    const entryId = (await pg.query<any>(
      `INSERT INTO character_spells(campaign_id, character_id, source, custom_spell_id) VALUES ($1,$2,'custom',$3) RETURNING id`,
      [campaignId, hero.id, spellId],
    )).rows[0]!.id;
    const cast = await request('POST', `${base}/characters/${hero.id}/spells/${entryId}/cast`, alice.token, {});
    assert.equal(cast.statusCode, 201, cast.body);
    assert.deepEqual(cast.json().concentrating, {spellName: 'Благословение', replaced: null});
    assert.deepEqual(await codes(hero.id), ['concentration']);

    await pg.query<any>('UPDATE characters SET hp_max=40, hp_current=40 WHERE id=$1', [hero.id]);
    await damage(hero.id, '1d1+23');
    const save = (await request('GET', `${base}/rolls`, gm.token)).json().rolls.find((r: any) => r.label?.startsWith('Концентрация'));
    assert.ok(save, 'a concentration save was rolled');
    assert.equal(save.outcome.dc, 12, 'half of 24');
    assert.equal(await codes(hero.id).then(list => list.includes('concentration')), save.outcome.success);

    await effect(hero.id, 'unconscious', alice.token);
    const unable = await request('POST', `${base}/characters/${hero.id}/spells/${entryId}/cast`, alice.token, {});
    assert.equal(unable.statusCode, 400);
    assert.match(unable.json().message, /не может сотворить заклинание: без сознания/);
    await clearEffects(hero.id);
    await pg.query<any>('UPDATE characters SET hp_max=20, hp_current=20 WHERE id=$1', [hero.id]);
  });

  await t.test('an area save applies its condition to those who failed', async () => {
    const templateId = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: 1, z: 1, direction: 0, sizeFeet: 10, label: 'Паутина'})).json().id;
    const saves = await request('POST', `${scenePath}/templates/${templateId}/saves`, gm.token, {ability: 'dexterity', dc: 40, effect: {code: 'restrained', repeatSave: 'end'}});
    assert.equal(saves.statusCode, 200, saves.body);
    const results = saves.json().results;
    assert.deepEqual(results.map((r: any) => r.name).sort(), ['Гоблин', 'Лира']);
    assert.ok(results.every((r: any) => !r.success && r.conditionApplied));
    assert.deepEqual(await codes(goblin.id), ['restrained']);
    const params = (await pg.query<any>(`SELECT parameters FROM character_effects WHERE character_id=$1`, [goblin.id])).rows[0]!.parameters;
    assert.deepEqual(params.save, {ability: 'dexterity', dc: 40});
    assert.equal(params.sourceName, 'Паутина');
    await clearEffects(goblin.id);
    await clearEffects(hero.id);
  });

  await t.test('the scene shows conditions on creatures, except effects hidden from this viewer', async () => {
    await effect(goblin.id, 'prone');
    const secret = (await effect(goblin.id, 'poisoned')).json().id;
    await request('PUT', `${base}/characters/${goblin.id}/visibility/${encodeURIComponent(`effect:${secret}`)}`, gm.token, {mode: 'hidden'});
    const forAlice = (await request('GET', scenePath, alice.token)).json().objects.find((o: any) => o.character_id === goblin.id);
    assert.deepEqual(forAlice.conditions, ['prone']);
    const forGm = (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.character_id === goblin.id);
    assert.deepEqual(forGm.conditions.sort(), ['poisoned', 'prone']);
    await clearEffects(goblin.id);
  });

  await t.test('2.6: with shared vision, friendly NPCs see for the party', async () => {
    await pg.query<any>('UPDATE campaigns SET fog_enabled=true WHERE id=$1', [campaignId]);
    await pg.query<any>('UPDATE scenes SET default_vision_radius_feet=5 WHERE id=$1', [sceneId]);
    await pg.query<any>(`UPDATE campaign_members SET may_choose_allied_vision=true WHERE campaign_id=$1 AND user_id=$2`, [campaignId, alice.user.id]);
    const visibleCount = async () => (await request('GET', scenePath, alice.token)).json().fog.visibleCells.length;
    await request('PUT', `${base}/me/vision`, alice.token, {mode: 'own'});
    const own = await visibleCount();
    await request('PUT', `${base}/me/vision`, alice.token, {mode: 'allies'});
    const allies = await visibleCount();
    assert.ok(allies > own, `the friendly guard adds its cells (${own} → ${allies})`);
    await pg.query<any>(`UPDATE characters SET disposition='hostile' WHERE id=$1`, [ally.id]);
    assert.equal(await visibleCount(), own, 'a hostile NPC is not the party’s eyes');
  });
});
