import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('champion crits, uncanny dodge, evasion, invocations, dispel magic, lesser restoration, NPC cunning action', async t => {
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
  const gm = await register('gm_rogue'), alice = await register('alice_rogue');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Rogue'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const classed = async (id: string, className: string) => pg.query('UPDATE characters SET class_name=$2 WHERE id=$1', [id, className]);
  const hero = async (name: string, className: string, level: number, extra: any = {}) => {
    const made = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 60, hpCurrent: 60, level, speedFeet: 30, ...extra})).json();
    await classed(made.id, className);
    return made;
  };
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 100, hpCurrent: 100, armorClass: 5, speedFeet: 30, ...extra,
  })).json();
  const weapon = async (id: string, body: any, token = gm.token) => (await request('POST', `${base}/characters/${id}/weapons`, token, {ability: 'strength', proficient: false, damageFormula: '1d1', ...body})).json();
  const learn = async (characterId: string, srdIndex: string) => {
    const made = await request('POST', `${base}/characters/${characterId}/spells`, gm.token, {source: 'srd', srdIndex});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const slots = (characterId: string, level: number, count: number) =>
    pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,$3,$4,$4)', [campaignId, characterId, level, count]);
  const effect = async (id: string, code: string) => (await pg.query<any>('SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code=$2 AND active', [id, code])).rows[0]?.parameters ?? null;
  const spot = async (id: string) => (await pg.query<any>('SELECT x::float8 AS x, z::float8 AS z FROM scene_objects WHERE character_id=$1', [id])).rows[0] as {x: number; z: number};
  const arena = async (name: string, members: Array<[string, string, number, number, number]>, size = {widthCells: 24, heightCells: 12}) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, ...size})).json().id;
    const scenePath = `${base}/scenes/${sceneId}`;
    for (const [token, characterId, x, z] of members) await request('POST', `${scenePath}/objects`, token, {characterId, x, z});
    for (const [, characterId, , , score] of members) {
      const id = (await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId})).json().id;
      await request('PATCH', `${scenePath}/initiative/${id}`, gm.token, {score});
    }
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    return {sceneId, scenePath, auto: async () => (await request('POST', `${scenePath}/initiative/auto`, gm.token, {advance: false})).json()};
  };

  await t.test('a Champion crits on 19 (18 from 15th level), the preview counts it', async () => {
    const champion = await hero('Чемпион', 'Воин', 3);
    const wall = await npc('Стена', {armorClass: 30});
    const sword = await weapon(champion.id, {name: 'Меч'}, alice.token);
    let seen19 = false, seen18 = false;
    for (let i = 0; i < 300 && !(seen19 && seen18); i++) {
      const blow = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: champion.id, kind: 'attack', key: sword.id, targetCharacterId: wall.id})).json();
      assert.equal(blow.outcome.critAt, 19);
      const natural = blow.dice_results[0];
      if (natural === 19) {
        seen19 = true;
        assert.deepEqual([blow.outcome.hit, blow.outcome.critical], [true, true], 'a 19 hits AC 30 and is a crit');
      }
      if (natural === 18) {
        seen18 = true;
        assert.equal(blow.outcome.hit, false, 'an 18 still misses AC 30 at 3rd level');
      }
    }
    assert.ok(seen19 && seen18);
    const preview = (await request('GET', `${base}/rolls/attack-preview?characterId=${champion.id}&key=${sword.id}&targetCharacterId=${wall.id}&advantage=none`, alice.token)).json();
    assert.equal(preview.hitChance, 0.1);
    await pg.query(`UPDATE characters SET level=15, class_name='Воин 15' WHERE id=$1`, [champion.id]);
    const later = (await request('GET', `${base}/rolls/attack-preview?characterId=${champion.id}&key=${sword.id}&targetCharacterId=${wall.id}&advantage=none`, alice.token)).json();
    assert.equal(later.hitChance, 0.15, '18–20');
    const features = (await request('GET', `${base}/characters/${champion.id}/features`, alice.token)).json();
    assert.match(features.features.find((entry: any) => entry.id === 'improved-critical').detail, /18–20/);
  });

  await t.test('uncanny dodge ready: the first hit is halved with the reaction, the next one is not', async () => {
    const rogue = await hero('Ловкач', 'Плут', 5, {hpMax: 200, hpCurrent: 200});
    const brute = await npc('Громила');
    const axe = await weapon(brute.id, {name: 'Топор', attackBonus: 20, damageFormula: '1d1+29'});
    assert.equal((await request('PUT', `${base}/characters/${rogue.id}/reactions`, alice.token, {'uncanny-dodge': true})).statusCode, 200);
    const features = (await request('GET', `${base}/characters/${rogue.id}/features`, alice.token)).json();
    assert.equal(features.features.find((entry: any) => entry.id === 'uncanny-dodge').active, true);
    const {sceneId} = await arena('Переулок', [[gm.token, brute.id, 0.5, 0.5, 30], [alice.token, rogue.id, 1.5, 0.5, 5]]);
    const swing = async () => {
      for (let i = 0; i < 20; i++) {
        await pg.query('UPDATE initiative_entries SET action_used=false, attacks_made=0 WHERE character_id=$1', [brute.id]);
        const blow = (await request('POST', `${base}/rolls/check`, gm.token, {characterId: brute.id, kind: 'attack', key: axe.id, targetCharacterId: rogue.id, sceneId})).json();
        if (blow.outcome.hit) return blow;
      }
      throw new Error('never hit');
    };
    const first = await swing();
    assert.equal(first.uncannyDodge?.name, 'Ловкач');
    assert.equal(first.damage.applied, 15, '30 (31 on a crit) halved');
    assert.match(first.damage.roll.label, /уклонение: вдвое/);
    assert.equal((await pg.query<any>('SELECT reaction_used FROM initiative_entries WHERE character_id=$1', [rogue.id])).rows[0].reaction_used, true);
    const second = await swing();
    assert.equal(second.uncannyDodge, undefined, 'the reaction is spent');
    assert.ok(second.damage.applied >= 30);
  });

  await t.test('evasion: a rogue takes nothing on a successful DEX save against Fireball and half on a failed one', async () => {
    const mage = await npc('Пиромант', {intelligence: 18, level: 5});
    // As many slots as loop attempts, otherwise a rare streak of equal saves runs out of slots first.
    await slots(mage.id, 3, 30);
    const fireball = await learn(mage.id, 'fireball');
    const rogue = await hero('Увёртливая', 'Плут', 7, {hpMax: 500, hpCurrent: 500, dexterity: 10});
    const fighter = await hero('Неуклюжий', 'Воин', 7, {hpMax: 500, hpCurrent: 500, dexterity: 10});
    let succeeded = false, failed = false;
    for (let i = 0; i < 30 && !(succeeded && failed); i++) {
      const cast = await request('POST', `${base}/characters/${mage.id}/spells/${fireball}/cast`, gm.token, {targetIds: [rogue.id, fighter.id]});
      assert.equal(cast.statusCode, 201, cast.body);
      const body = cast.json();
      const full = body.damageRoll.total;
      const mine = body.targets.find((entry: any) => entry.characterId === rogue.id);
      const theirs = body.targets.find((entry: any) => entry.characterId === fighter.id);
      assert.equal(mine.evasion, true);
      assert.equal(theirs.evasion, undefined);
      if (mine.save.success) {
        succeeded = true;
        assert.equal(mine.damage, 0);
      } else {
        failed = true;
        assert.equal(mine.damage, Math.floor(full / 2));
      }
      assert.equal(theirs.damage, theirs.save.success ? Math.floor(full / 2) : full);
    }
    assert.ok(succeeded && failed);
  });

  await t.test('invocations: Agonizing Blast adds CHA to each beam, Repelling Blast pushes the target 10 feet', async () => {
    const warlock = await hero('Колдунья', 'Колдун', 2, {charisma: 18});
    const blast = await learn(warlock.id, 'eldritch-blast');
    const dummy = await npc('Чучело', {armorClass: 1});
    const invocations = await request('PUT', `${base}/characters/${warlock.id}/invocations`, alice.token, {'agonizing-blast': true, 'repelling-blast': true});
    assert.equal(invocations.statusCode, 200, invocations.body);
    assert.deepEqual(invocations.json().invocations, ['agonizing-blast', 'repelling-blast']);
    const features = (await request('GET', `${base}/characters/${warlock.id}/features`, alice.token)).json();
    assert.deepEqual(features.features.find((entry: any) => entry.id === 'eldritch-invocations').choices.map((entry: any) => [entry.value, entry.active ?? false]),
      [['agonizing-blast', true], ['repelling-blast', true], ['devils-sight', false]]);
    const {sceneId} = await arena('Пустошь', [[alice.token, warlock.id, 0.5, 0.5, 30], [gm.token, dummy.id, 3.5, 0.5, 5]]);
    let hit: any = null;
    for (let i = 0; i < 10 && !hit; i++) {
      await pg.query('UPDATE initiative_entries SET action_used=false WHERE character_id=$1', [warlock.id]);
      await pg.query('UPDATE scene_objects SET x=3.5, z=0.5 WHERE character_id=$1', [dummy.id]);
      const cast = await request('POST', `${base}/characters/${warlock.id}/spells/${blast}/cast`, alice.token, {targetIds: [dummy.id], sceneId});
      assert.equal(cast.statusCode, 201, cast.body);
      if (cast.json().damageRoll) hit = cast.json();
    }
    assert.ok(hit, 'AC 1 — a beam lands sooner or later');
    assert.match(hit.damageRoll.formula, /d10\+4$/, hit.damageRoll.formula);
    assert.match(JSON.stringify(hit.targets), /отброшен на 10 фт\./);
    assert.equal((await spot(dummy.id)).x, 5.5);
    assert.equal((await request('PUT', `${base}/characters/${warlock.id}/invocations`, alice.token, {'repelling-blast': false})).json().invocations.join(), 'agonizing-blast');
    const fighter = await hero('Не колдун', 'Воин', 2);
    assert.equal((await request('PUT', `${base}/characters/${fighter.id}/invocations`, alice.token, {'agonizing-blast': true})).statusCode, 400);
  });

  await t.test('dispel magic ends Hold Person on an ally (and the caster’s concentration); a higher spell needs a check', async () => {
    const enemy = await npc('Чародей', {charisma: 18, wisdom: 10, level: 5});
    await slots(enemy.id, 2, 20);
    const hold = await learn(enemy.id, 'hold-person');
    const victim = await hero('Пленник', 'Воин', 3, {wisdom: 1});
    for (let i = 0; i < 20 && !(await effect(victim.id, 'paralyzed')); i++) {
      await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code='concentration'`, [enemy.id]);
      await request('POST', `${base}/characters/${enemy.id}/spells/${hold}/cast`, gm.token, {targetIds: [victim.id]});
    }
    const paralyzed = await effect(victim.id, 'paralyzed');
    assert.ok(paralyzed, 'WIS −5 against the DC — held sooner or later');
    assert.equal(paralyzed.spellLevel, 2);
    assert.equal(paralyzed.concentrationOf, enemy.id);
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'invisible','{"spellLevel":5,"sourceName":"Высшая невидимость"}')`, [campaignId, victim.id]);

    const cleric = await hero('Жрица', 'Жрец', 5, {wisdom: 16});
    await slots(cleric.id, 3, 2);
    const dispel = await learn(cleric.id, 'dispel-magic');
    const cast = await request('POST', `${base}/characters/${cleric.id}/spells/${dispel}/cast`, alice.token, {targetIds: [victim.id]});
    assert.equal(cast.statusCode, 201, cast.body);
    const mine = cast.json().targets.find((entry: any) => entry.characterId === victim.id);
    assert.ok(mine.effects.some((text: string) => /^рассеяно: (Удержание личности|Hold Person)$/.test(text)), JSON.stringify(mine));
    assert.equal(await effect(victim.id, 'paralyzed'), null);
    assert.equal(await effect(enemy.id, 'concentration'), null, 'the held spell is gone — so is the concentration');
    const checks = (await pg.query<any>(`SELECT label FROM roll_log WHERE character_id=$1 AND label LIKE '%проверка против 5 ур.%'`, [cleric.id])).rows;
    assert.equal(checks.length, 1, 'one ability check for the 5th-level spell');
  });

  await t.test('lesser restoration ends paralysis and blinds nobody', async () => {
    const cleric = await hero('Целительница', 'Жрец', 3, {wisdom: 16});
    await slots(cleric.id, 2, 2);
    const restore = await learn(cleric.id, 'lesser-restoration');
    const friend = await hero('Застывший', 'Воин', 3);
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'paralyzed','{}'), ($1,$2,'poisoned','{}')`, [campaignId, friend.id]);
    const cast = await request('POST', `${base}/characters/${cleric.id}/spells/${restore}/cast`, alice.token, {targetIds: [friend.id]});
    assert.equal(cast.statusCode, 201, cast.body);
    assert.deepEqual(cast.json().targets.find((entry: any) => entry.characterId === friend.id).effects, ['снято: парализован']);
    assert.equal(await effect(friend.id, 'paralyzed'), null);
    assert.ok(await effect(friend.id, 'poisoned'), 'one condition per casting — the worst first');
    assert.equal(await effect(friend.id, 'blinded'), null);
  });

  await t.test('an NPC healer casts lesser restoration on a paralysed ally instead of a weak swing', async () => {
    const healer = await npc('Знахарь', {wisdom: 16, level: 3});
    await slots(healer.id, 2, 2);
    await learn(healer.id, 'lesser-restoration');
    await weapon(healer.id, {name: 'Посох'});
    const ally = await npc('Окаменевший страж');
    const foe = await hero('Противник', 'Воин', 3, {hpMax: 300, hpCurrent: 300});
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'paralyzed','{}')`, [campaignId, ally.id]);
    const {auto} = await arena('Подмога', [[gm.token, healer.id, 0.5, 0.5, 30], [gm.token, ally.id, 1.5, 0.5, 20], [alice.token, foe.id, -0.5, 0.5, 5]]);
    const result = await auto();
    assert.match(result.summary, /творит «[^»]+» на «Окаменевший страж»: снято: парализован/, result.summary);
    assert.equal(result.attacks?.length ?? 0, 0, 'the action went to the spell');
    assert.equal(await effect(ally.id, 'paralyzed'), null);
  });

  await t.test('an NPC rogue strikes, then disengages with a bonus action and steps away', async () => {
    const rogue = await npc('Карманник', {dexterity: 16, level: 2});
    await classed(rogue.id, 'Плут 2');
    await weapon(rogue.id, {name: 'Кинжал', ability: 'finesse', attackBonus: 20, damageFormula: '1d4'});
    const mark = await hero('Жертва', 'Воин', 3, {hpMax: 300, hpCurrent: 300});
    const {auto} = await arena('Рынок', [[gm.token, rogue.id, 0.5, 0.5, 30], [alice.token, mark.id, 1.5, 0.5, 5]]);
    const result = await auto();
    assert.ok(result.attacks.length >= 1, result.summary);
    assert.match(result.summary, /Отход бонусным действием — отходит от «Жертва»/, result.summary);
    const at = await spot(rogue.id);
    assert.ok(Math.max(Math.abs(at.x - 1.5), Math.abs(at.z - 0.5)) > 1, `stepped away: ${JSON.stringify(at)}`);
    const entry = (await pg.query<any>('SELECT bonus_used FROM initiative_entries WHERE character_id=$1', [rogue.id])).rows[0];
    assert.equal(entry.bonus_used, true);
  });
});
