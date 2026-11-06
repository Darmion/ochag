import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {hasEvasion} from '../../../src/rules/class-features.ts';
import {createTestDatabase} from '../../helpers.ts';

test('round 20: high-level defences, subclass strikes, movement, peerless skill, pits', async t => {
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
  const gm = await register('gm_round20'), alice = await register('alice_round20');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Round 20'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const hero = async (name: string, className: string, level: number, extra: any = {}) => {
    const made = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 400, hpCurrent: 400, level, speedFeet: 30, ...extra})).json();
    await pg.query('UPDATE characters SET class_name=$2 WHERE id=$1', [made.id, className]);
    return made;
  };
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 1000, hpCurrent: 1000, armorClass: 1, speedFeet: 30, ...extra,
  })).json();
  const weapon = async (id: string, body: any, token = gm.token) => (await request('POST', `${base}/characters/${id}/weapons`, token, {ability: 'strength', proficient: false, damageFormula: '1d1', ...body})).json();
  const codes = async (id: string) => (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active', [id])).rows.map(row => row.effect_code as string);
  const hp = async (id: string) => Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current);
  const resource = async (id: string, name: string) => (await pg.query<any>('SELECT current FROM character_resources WHERE character_id=$1 AND name=$2', [id, name])).rows[0]?.current;
  const entry = async (id: string) => (await pg.query<any>('SELECT reaction_used FROM initiative_entries WHERE character_id=$1', [id])).rows[0];
  const turn = (id: string) => pg.query('UPDATE initiative_entries SET action_used=false, bonus_used=false, reaction_used=false, attacks_made=0, bonus_spell=false, leveled_action_spell=false WHERE character_id=$1', [id]);
  const arena = async (name: string, members: Array<[string, string, number, number, number]>, size: [number, number] = [24, 12]) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: size[0], heightCells: size[1]})).json().id as string;
    const scenePath = `${base}/scenes/${sceneId}`;
    const placed: Record<string, string> = {};
    for (const [token, characterId, x, z] of members) placed[characterId] = (await request('POST', `${scenePath}/objects`, token, {characterId, x, z})).json().id;
    for (const [, characterId, , , score] of members) {
      const id = (await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId})).json().id;
      await request('PATCH', `${scenePath}/initiative/${id}`, gm.token, {score});
    }
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    const advance = async () => {
      const done = await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
      assert.equal(done.statusCode, 204, done.body);
    };
    return {sceneId, scenePath, placed, advance};
  };
  const attack = (token: string, characterId: string, key: string, targetCharacterId: string, sceneId: string, extra: any = {}) =>
    request('POST', `${base}/rolls/check`, token, {characterId, kind: 'attack', key, targetCharacterId, sceneId, ...extra}).then(response => response.json());
  const hurt = async (characterId: string, amount: number, damageType: string) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: `1d1+${amount - 1}`})).json();
    const applied = await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId, mode: 'damage', damageType});
    assert.equal(applied.statusCode, 200, applied.body);
  };

  await t.test('retaliation: a berserker 14 hit from 5 feet strikes back with a reaction — only when ready', async () => {
    const berserker = await hero('Берсерк', 'Варвар', 14, {strength: 18});
    const axe = await weapon(berserker.id, {name: 'Секира', attackBonus: 20, damageFormula: '1d1'}, alice.token);
    const brute = await npc('Громила');
    const hammer = await weapon(brute.id, {name: 'Молот', attackBonus: 20, damageFormula: '1d1+4'});
    const {sceneId} = await arena('Ответ', [[gm.token, brute.id, 0.5, 0.5, 30], [alice.token, berserker.id, 1.5, 0.5, 5]]);
    const features = (await request('GET', `${base}/characters/${berserker.id}/features?sceneId=${sceneId}`, alice.token)).json().features;
    assert.ok(features.some((feature: any) => feature.id === 'retaliation'), 'berserker 14 has it');
    assert.equal((await request('PUT', `${base}/characters/${berserker.id}/reactions`, alice.token, {retaliation: true})).statusCode, 200);

    let blow: any = null;
    for (let i = 0; i < 10 && !(blow?.damage?.applied > 0); i++) {
      await turn(brute.id);
      await turn(berserker.id);
      blow = await attack(gm.token, brute.id, hammer.id, berserker.id, sceneId);
    }
    assert.ok(blow.retaliation, JSON.stringify(blow).slice(0, 300));
    assert.equal(blow.retaliation.weapon, 'Секира');
    assert.equal((await entry(berserker.id)).reaction_used, true);
    assert.ok(axe.id);

    await request('PUT', `${base}/characters/${berserker.id}/reactions`, alice.token, {retaliation: false});
    let quiet: any = null;
    for (let i = 0; i < 10 && !(quiet?.damage?.applied > 0); i++) {
      await turn(brute.id);
      await turn(berserker.id);
      quiet = await attack(gm.token, brute.id, hammer.id, berserker.id, sceneId);
    }
    assert.equal(quiet.retaliation, undefined, 'not ready — no answer');
    assert.equal((await entry(berserker.id)).reaction_used, false);
  });

  await t.test('superior hunter’s defense: evasion, uncanny dodge on a hit, stand against the tide on a miss', async () => {
    const hunter = await hero('Охотница', 'Следопыт', 15, {armorClass: 15});
    assert.equal(await hasEvasion(db, campaignId, hunter.id), false);
    assert.equal((await request('PUT', `${base}/characters/${hunter.id}/superior-hunters-defense`, alice.token, {evasion: true})).statusCode, 200);
    assert.equal(await hasEvasion(db, campaignId, hunter.id), true, '«Увёртливость» from the choice');

    const brute = await npc('Налётчик');
    const club = await weapon(brute.id, {name: 'Дубина', attackBonus: 20, damageFormula: '1d1+9'});
    const knife = await weapon(brute.id, {name: 'Кривой нож', attackBonus: -10, damageFormula: '1d1'});
    const crony = await npc('Подручный', {armorClass: 5});
    const {sceneId} = await arena('Засада', [[gm.token, brute.id, 0.5, 0.5, 30], [alice.token, hunter.id, 1.5, 0.5, 5], [gm.token, crony.id, -0.5, 0.5, 4]]);

    assert.equal((await request('PUT', `${base}/characters/${hunter.id}/superior-hunters-defense`, alice.token, {'uncanny-dodge': true})).statusCode, 200);
    let blow: any = null;
    for (let i = 0; i < 10 && !blow?.damage; i++) {
      await turn(brute.id);
      await turn(hunter.id);
      blow = await attack(gm.token, brute.id, club.id, hunter.id, sceneId);
    }
    assert.ok(blow.uncannyDodge, JSON.stringify(blow).slice(0, 300));
    assert.equal(blow.damage.applied, 5, '10 (11 on a crit) halved');

    assert.equal((await request('PUT', `${base}/characters/${hunter.id}/superior-hunters-defense`, alice.token, {'stand-against-the-tide': true})).statusCode, 200);
    let miss: any = null;
    for (let i = 0; i < 10 && !miss?.tide; i++) {
      await turn(brute.id);
      await turn(hunter.id);
      miss = await attack(gm.token, brute.id, knife.id, hunter.id, sceneId);
    }
    assert.ok(miss.tide, JSON.stringify(miss).slice(0, 300));
    assert.equal(miss.tide.victim, 'Подручный', 'the blow goes into the attacker’s own ally');
    assert.equal((await entry(hunter.id)).reaction_used, true);
    const redirected = (await pg.query<any>(`SELECT outcome FROM roll_log WHERE character_id=$1 AND outcome->>'kind'='attack' ORDER BY created_at DESC LIMIT 1`, [brute.id])).rows[0].outcome;
    assert.equal(redirected.target.name, 'Подручный');
  });

  await t.test('empty body: 4 ki — invisible and resistant to everything but force', async () => {
    const monk = await hero('Пустой', 'Монах', 18);
    const used = await request('POST', `${base}/characters/${monk.id}/features/empty-body`, alice.token, {});
    assert.equal(used.statusCode, 200, used.body);
    assert.ok((await codes(monk.id)).includes('invisible'));
    assert.ok((await codes(monk.id)).includes('empty_body'));
    assert.equal(Number(await resource(monk.id, 'Ци')), 14);
    await hurt(monk.id, 20, 'fire');
    assert.equal(await hp(monk.id), 390, 'fire halved');
    await hurt(monk.id, 20, 'force');
    assert.equal(await hp(monk.id), 370, 'force is not');
    assert.equal((await request('POST', `${base}/characters/${monk.id}/features/empty-body`, alice.token, {})).statusCode, 400, 'already on');
  });

  await t.test('quivering palm: an unarmed hit plants it for 3 ki; ending it — a CON save: 0 hit points or 10d10 necrotic', async () => {
    const monk = await hero('Ладонь', 'Монах', 17, {wisdom: 20});
    const fist = await weapon(monk.id, {name: 'Безоружный удар', ability: 'finesse', attackBonus: 20, damageFormula: '1d1'}, alice.token);
    const staff = await weapon(monk.id, {name: 'Посох', attackBonus: 20, damageFormula: '1d1'}, alice.token);
    const victim = await npc('Мишень', {constitution: 10});
    const {sceneId} = await arena('Ладонь', [[alice.token, monk.id, 0.5, 0.5, 30], [gm.token, victim.id, 1.5, 0.5, 5]]);
    let blow: any = null;
    for (let i = 0; i < 10 && !blow?.outcome?.hit; i++) {
      await turn(monk.id);
      blow = await attack(alice.token, monk.id, staff.id, victim.id, sceneId);
    }
    assert.equal(blow.quivering, undefined, 'a staff is not an unarmed strike');
    blow = null;
    for (let i = 0; i < 10 && !blow?.outcome?.hit; i++) {
      await turn(monk.id);
      blow = await attack(alice.token, monk.id, fist.id, victim.id, sceneId);
    }
    assert.ok(blow.quivering, JSON.stringify(blow).slice(0, 300));
    assert.equal(blow.outcome.unarmed, true);
    const planted = await request('POST', `${base}/rolls/${blow.quivering.rollId}/quivering-palm`, alice.token);
    assert.equal(planted.statusCode, 201, planted.body);
    assert.ok((await codes(victim.id)).includes('quivering_palm'));
    assert.equal(Number(await resource(monk.id, 'Ци')), 14);
    const view = (await request('GET', `${base}/characters/${monk.id}/features?sceneId=${sceneId}`, alice.token)).json().features.find((feature: any) => feature.id === 'quivering-palm');
    assert.equal(view.active, true);
    assert.deepEqual(view.choices.map((choice: any) => choice.label), ['Мишень']);

    await turn(monk.id);
    const before = await hp(victim.id);
    const ended = await request('POST', `${base}/characters/${monk.id}/features/quivering-palm`, alice.token, {sceneId});
    assert.equal(ended.statusCode, 200, ended.body);
    const after = await hp(victim.id);
    assert.ok(after === 0 || (before - after >= 10 && before - after <= 100), `0 hit points or 10d10: ${before} → ${after}`);
    assert.ok(!(await codes(victim.id)).includes('quivering_palm'), 'the vibrations are spent');
    assert.match(ended.json().message, /«Дрожащую ладонь»/);
  });

  await t.test('hurl through hell: gone until the end of the warlock’s next turn, then 10d10 psychic; once per long rest', async () => {
    const warlock = await hero('Колдунья', 'Колдун', 14, {charisma: 18});
    const rod = await weapon(warlock.id, {name: 'Жезл', attackBonus: 20, damageFormula: '1d1'}, alice.token);
    const victim = await npc('Жертва ада');
    const {sceneId, scenePath, placed, advance} = await arena('Ад', [[alice.token, warlock.id, 0.5, 0.5, 30], [gm.token, victim.id, 1.5, 0.5, 5]]);
    let blow: any = null;
    for (let i = 0; i < 10 && !blow?.outcome?.hit; i++) {
      await turn(warlock.id);
      blow = await attack(alice.token, warlock.id, rod.id, victim.id, sceneId);
    }
    assert.ok(blow.hurl, JSON.stringify(blow).slice(0, 300));
    const hurled = await request('POST', `${base}/rolls/${blow.hurl.rollId}/hurl-through-hell`, alice.token);
    assert.equal(hurled.statusCode, 201, hurled.body);
    assert.ok((await codes(victim.id)).includes('hurled'));
    assert.ok((await codes(victim.id)).includes('incapacitated'));
    const hidden = async () => (await pg.query<any>('SELECT hidden FROM scene_objects WHERE id=$1', [placed[victim.id]])).rows[0].hidden;
    assert.equal(await hidden(), true, 'not on the battlefield');
    assert.equal(Number(await resource(warlock.id, 'Бросок через ад')), 0);
    const before = await hp(victim.id);

    await advance();
    assert.ok((await codes(victim.id)).includes('hurled'));
    await advance();
    await advance();
    assert.ok(!(await codes(victim.id)).includes('hurled'));
    assert.ok(!(await codes(victim.id)).includes('incapacitated'));
    assert.equal(await hidden(), false);
    const lost = before - await hp(victim.id);
    assert.ok(lost >= 10 && lost <= 100, `10d10 psychic: ${lost}`);

    let again: any = null;
    for (let i = 0; i < 10 && !again?.outcome?.hit; i++) {
      await turn(warlock.id);
      again = await attack(alice.token, warlock.id, rod.id, victim.id, sceneId);
    }
    assert.equal(again.hurl, undefined, 'spent until a long rest');
    assert.ok(scenePath);
  });

  await t.test('holy nimbus: an enemy starting its turn within 30 feet takes 10 radiant', async () => {
    const paladin = await hero('Сияющий', 'Паладин', 20, {charisma: 16});
    const fiend = await npc('Бес');
    const far = await npc('Далёкий');
    const {sceneId, advance} = await arena('Нимб', [[alice.token, paladin.id, 0.5, 0.5, 30], [gm.token, fiend.id, 3.5, 0.5, 5], [gm.token, far.id, 11.5, 0.5, 4]]);
    const used = await request('POST', `${base}/characters/${paladin.id}/features/holy-nimbus`, alice.token, {sceneId});
    assert.equal(used.statusCode, 200, used.body);
    assert.ok((await codes(paladin.id)).includes('holy_nimbus'));
    assert.equal(Number(await resource(paladin.id, 'Святой нимб')), 0);
    await advance();
    assert.equal(await hp(fiend.id), 990, '15 feet away — 10 radiant');
    assert.equal(await hp(far.id), 1000, '55 feet away — untouched');
    assert.equal((await request('POST', `${base}/characters/${paladin.id}/features/holy-nimbus`, alice.token, {sceneId})).statusCode, 400);
  });

  await t.test('land’s stride and dragon wings: difficult terrain costs nothing extra', async () => {
    const druid = await hero('Друидка', 'Друид', 6, {speedFeet: 15});
    const sorcerer = await hero('Чародей', 'Чародей', 14, {speedFeet: 15});
    const walker = await hero('Пешеход', 'Воин', 6, {speedFeet: 15});
    const goblin = await npc('Гоблин');
    const {scenePath, placed, advance} = await arena('Грязь', [
      [alice.token, druid.id, -5.5, -1, 30], [alice.token, sorcerer.id, -5.5, 0, 20], [alice.token, walker.id, -5.5, 1, 10], [gm.token, goblin.id, 5.5, 0, 25],
    ], [12, 3]);
    assert.equal((await request('PUT', `${scenePath}/terrain`, gm.token, {cells: [[1, 0], [2, 0], [1, 1], [2, 1], [1, 2], [2, 2]]})).statusCode, 200);
    const moveTo = async (characterId: string, x: number) => {
      const current = (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.id === placed[characterId]);
      return request('PUT', `${scenePath}/objects/${placed[characterId]}`, alice.token, {
        x, y: 0, z: current.z, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
      });
    };
    const stride = await moveTo(druid.id, -2.5);
    assert.equal(stride.statusCode, 200, `three cells, two of them mud — 15 feet for the druid: ${stride.body}`);
    await advance();
    await advance();
    assert.equal((await request('POST', `${base}/characters/${sorcerer.id}/features/dragon-wings`, alice.token, {})).statusCode, 200);
    assert.ok((await codes(sorcerer.id)).includes('dragon_wings'));
    assert.equal((await moveTo(sorcerer.id, -2.5)).statusCode, 200, 'winged — over the mud');
    const muddy = await moveTo(walker.id, -2.5);
    assert.equal(muddy.statusCode, 400, 'no feature — mud costs double, as before');
    assert.match(muddy.json().message, /путь стоит 25 фут\./);
  });

  await t.test('peerless skill: a lore bard adds a bardic die to an ability check, spending one inspiration', async () => {
    const bard = await hero('Сказитель', 'Бард', 14, {charisma: 16});
    const fighter = await hero('Боец', 'Воин', 14);
    const rolled = await request('POST', `${base}/rolls/check`, alice.token, {characterId: bard.id, kind: 'skill', key: 'perception', peerless: true});
    assert.equal(rolled.statusCode, 201, rolled.body);
    assert.ok(rolled.json().outcome.reasons.some((reason: string) => /^непревзойдённое мастерство: к10 — \+\d+$/.test(reason)), JSON.stringify(rolled.json().outcome.reasons));
    assert.equal(Number(await resource(bard.id, 'Вдохновение барда')), 2);
    assert.equal((await request('POST', `${base}/rolls/check`, alice.token, {characterId: fighter.id, kind: 'skill', key: 'perception', peerless: true})).statusCode, 400);
  });

  await t.test('pit traps: falling in — the fall dice and prone; a successful save holds the edge; wings fly over', async () => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Ямы', widthCells: 12, heightCells: 3})).json().id;
    const scenePath = `${base}/scenes/${sceneId}`;
    const walker = await hero('Путник', 'Воин', 3, {hpMax: 100, hpCurrent: 100});
    const flyer = await hero('Летун', 'Чародей', 14, {hpMax: 100, hpCurrent: 100});
    const placedWalker = (await request('POST', `${scenePath}/objects`, alice.token, {characterId: walker.id, x: -5.5, z: 1})).json().id;
    const placedFlyer = (await request('POST', `${scenePath}/objects`, alice.token, {characterId: flyer.id, x: -5.5, z: -1})).json().id;
    const pit = await request('POST', `${scenePath}/triggers`, gm.token, {kind: 'enter', name: 'Яма', shape: 'square', x: 0.5, z: 0, sizeFeet: 15, once: false, fallFeet: 30});
    assert.equal(pit.statusCode, 201, pit.body);
    assert.equal(pit.json().fall_feet, 30);
    const step = async (placement: string, x: number, z: number) => {
      const current = (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.id === placement);
      return request('PUT', `${scenePath}/objects/${placement}`, alice.token, {
        x, y: 0, z, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
      });
    };
    assert.equal((await step(placedWalker, 0.5, 1)).statusCode, 200);
    const lost = 100 - await hp(walker.id);
    assert.ok(lost >= 3 && lost <= 18, `3d6 for 30 feet: ${lost}`);
    assert.ok((await codes(walker.id)).includes('prone'));
    assert.ok((await pg.query<any>(`SELECT 1 FROM roll_log WHERE character_id=$1 AND label LIKE 'Падение с 30 фут.%'`, [walker.id])).rows[0]);

    assert.equal((await request('POST', `${base}/characters/${flyer.id}/features/dragon-wings`, alice.token, {})).statusCode, 200);
    assert.equal((await step(placedFlyer, 0.5, -1)).statusCode, 200);
    assert.equal(await hp(flyer.id), 100, 'wings fly over the pit');

    const ledge = await request('PATCH', `${scenePath}/triggers/${pit.json().id}`, gm.token, {checkKind: 'save', checkKey: 'dexterity', dc: 1});
    assert.equal(ledge.statusCode, 200, ledge.body);
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code='dragon_wings'`, [flyer.id]);
    assert.equal((await step(placedFlyer, -5.5, -1)).statusCode, 200);
    assert.equal((await step(placedFlyer, 0.5, -1)).statusCode, 200);
    assert.equal(await hp(flyer.id), 100, 'held the edge');
  });
});
