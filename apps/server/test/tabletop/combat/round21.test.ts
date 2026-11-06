import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('round 21: tails of every class and old mechanics', async t => {
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
  const gm = await register('gm_round21'), alice = await register('alice_round21');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Round 21'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const hero = async (name: string, className: string, level: number, extra: any = {}) => {
    const made = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 400, hpCurrent: 400, level, speedFeet: 30, ...extra})).json();
    await pg.query('UPDATE characters SET class_name=$2 WHERE id=$1', [made.id, className]);
    return made;
  };
  const npc = async (name: string, extra: any = {}, type: string | null = null) => {
    const made = (await request('POST', `${base}/characters`, gm.token, {
      kind: 'npc', name, disposition: 'hostile', hpMax: 1000, hpCurrent: 1000, armorClass: 1, speedFeet: 30, ...extra,
    })).json();
    if (type) await pg.query(`UPDATE characters SET sheet_extra = jsonb_set(COALESCE(sheet_extra, '{}'::jsonb), '{creatureType}', to_jsonb($2::text)) WHERE id=$1`, [made.id, type]);
    return made;
  };
  const weapon = async (id: string, body: any, token = gm.token) => (await request('POST', `${base}/characters/${id}/weapons`, token, {ability: 'strength', proficient: false, damageFormula: '1d1', ...body})).json();
  const codes = async (id: string) => (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active', [id])).rows.map(row => row.effect_code as string);
  const hp = async (id: string) => Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current);
  const resource = async (id: string, name: string) => (await pg.query<any>('SELECT current FROM character_resources WHERE character_id=$1 AND name=$2', [id, name])).rows[0]?.current;
  const turn = (id: string) => pg.query('UPDATE initiative_entries SET action_used=false, bonus_used=false, reaction_used=false, attacks_made=0, bonus_spell=false, leveled_action_spell=false WHERE character_id=$1', [id]);
  const scene = async (name: string, members: Array<[string, string, number, number]>, size: [number, number] = [24, 12]) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: size[0], heightCells: size[1]})).json().id as string;
    const scenePath = `${base}/scenes/${sceneId}`;
    const placed: Record<string, string> = {};
    for (const [token, characterId, x, z] of members) placed[characterId] = (await request('POST', `${scenePath}/objects`, token, {characterId, x, z})).json().id;
    return {sceneId, scenePath, placed};
  };
  const fight = async (scenePath: string, order: Array<[string, number]>) => {
    for (const [characterId, score] of order) {
      const id = (await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId})).json().id;
      await request('PATCH', `${scenePath}/initiative/${id}`, gm.token, {score});
    }
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    return async () => {
      const done = await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
      assert.equal(done.statusCode, 204, done.body);
    };
  };
  const attack = (token: string, characterId: string, key: string, targetCharacterId: string, sceneId: string, extra: any = {}) =>
    request('POST', `${base}/rolls/check`, token, {characterId, kind: 'attack', key, targetCharacterId, sceneId, ...extra}).then(response => response.json());
  const hurt = async (characterId: string, amount: number, damageType: string) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: `1d1+${amount - 1}`})).json();
    const applied = await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId, mode: 'damage', damageType});
    assert.equal(applied.statusCode, 200, applied.body);
  };
  const lastRoll = async (id: string, like: string) => (await pg.query<any>(`SELECT label, outcome FROM roll_log WHERE character_id=$1 AND label LIKE $2 ORDER BY created_at DESC LIMIT 1`, [id, like])).rows[0];

  await t.test('trap damage goes through the common damage path: resistance halves, immunity stops it', async () => {
    const {scenePath, placed} = await scene('Огненный коридор', [], [12, 3]);
    const salamander = await hero('Огнеупорный', 'Воин', 3);
    const golem = await hero('Голем', 'Воин', 3);
    await pg.query(`UPDATE characters SET damage_resistances='["fire"]'::jsonb WHERE id=$1`, [salamander.id]);
    await pg.query(`UPDATE characters SET damage_immunities='["fire"]'::jsonb WHERE id=$1`, [golem.id]);
    for (const [entry, z] of [[salamander, -1], [golem, 1]] as const) {
      placed[entry.id] = (await request('POST', `${scenePath}/objects`, alice.token, {characterId: entry.id, x: -5.5, z})).json().id;
    }
    const trap = await request('POST', `${scenePath}/triggers`, gm.token, {kind: 'enter', name: 'Огненная плита', shape: 'square', x: 0.5, z: 0, sizeFeet: 15, once: false, damageFormula: '1d1+19', damageType: 'fire'});
    assert.equal(trap.statusCode, 201, trap.body);
    const step = async (id: string, x: number, z: number) => {
      const current = (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.id === placed[id]);
      return request('PUT', `${scenePath}/objects/${placed[id]}`, alice.token, {x, y: 0, z, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision});
    };
    assert.equal((await step(salamander.id, 0.5, -1)).statusCode, 200);
    assert.equal(await hp(salamander.id), 390, '20 fire halved');
    assert.equal((await step(golem.id, 0.5, 1)).statusCode, 200);
    assert.equal(await hp(golem.id), 400, 'immune');
  });

  await t.test('countercharm: an ally in 30 feet saves against fear with advantage; intimidating presence frightens or is resisted', async () => {
    const bard = await hero('Бард', 'Бард', 6, {charisma: 16});
    const knight = await hero('Рыцарь', 'Воин', 6, {wisdom: 10});
    const berserker = await npc('Берсерк', {charisma: 18});
    await pg.query(`UPDATE characters SET class_name='Варвар', level=10 WHERE id=$1`, [berserker.id]);
    const {sceneId} = await scene('Площадь', [[alice.token, bard.id, 0.5, 0.5], [alice.token, knight.id, 1.5, 0.5], [gm.token, berserker.id, 3.5, 0.5]]);
    const sung = await request('POST', `${base}/characters/${bard.id}/features/countercharm`, alice.token, {sceneId});
    assert.equal(sung.statusCode, 200, sung.body);
    assert.ok((await codes(bard.id)).includes('countercharm'));
    const scare = await request('POST', `${base}/characters/${berserker.id}/features/intimidating-presence`, gm.token, {sceneId, targetId: knight.id});
    assert.equal(scare.statusCode, 200, scare.body);
    const save = await lastRoll(knight.id, '%Пугающего присутствия%');
    assert.ok(save.outcome.reasons.some((reason: string) => reason.includes('контрочарование')), JSON.stringify(save.outcome.reasons));
    const after = await codes(knight.id);
    assert.ok(after.includes('frightened') || after.includes('presence_resisted'), JSON.stringify(after));
    if (after.includes('presence_resisted')) {
      assert.equal((await request('POST', `${base}/characters/${berserker.id}/features/intimidating-presence`, gm.token, {sceneId, targetId: knight.id})).statusCode, 400, 'a day of immunity');
    }
  });

  await t.test('flexible casting: a slot into sorcery points and points back into a slot', async () => {
    const sorcerer = await hero('Чародейка', 'Чародей', 5, {charisma: 16});
    await pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,4,4),($1,$2,3,2,2)', [campaignId, sorcerer.id]);
    await request('GET', `${base}/characters/${sorcerer.id}/features`, alice.token);
    const full = await request('POST', `${base}/characters/${sorcerer.id}/features/flexible-casting`, alice.token, {mode: 'to-points', slotLevel: 1});
    assert.equal(full.statusCode, 400, 'points already full');
    await pg.query(`INSERT INTO character_resources (campaign_id, character_id, name, current, max, recharge) VALUES ($1,$2,'Очки чародейства',1,5,'long') ON CONFLICT DO NOTHING`, [campaignId, sorcerer.id]);
    await pg.query(`UPDATE character_resources SET current=1 WHERE character_id=$1 AND name='Очки чародейства'`, [sorcerer.id]);
    const toPoints = await request('POST', `${base}/characters/${sorcerer.id}/features/flexible-casting`, alice.token, {mode: 'to-points', slotLevel: 3});
    assert.equal(toPoints.statusCode, 200, toPoints.body);
    assert.equal(Number(await resource(sorcerer.id, 'Очки чародейства')), 4);
    const slot = async (level: number) => Number((await pg.query<any>('SELECT current FROM character_spell_slots WHERE character_id=$1 AND level=$2', [sorcerer.id, level])).rows[0].current);
    assert.equal(await slot(3), 1);
    const toSlot = await request('POST', `${base}/characters/${sorcerer.id}/features/flexible-casting`, alice.token, {mode: 'to-slot', slotLevel: 1});
    assert.equal(toSlot.statusCode, 200, toSlot.body);
    assert.equal(Number(await resource(sorcerer.id, 'Очки чародейства')), 2);
    assert.equal(await slot(1), 5, 'a created slot over the maximum — gone on a long rest');
    assert.equal((await request('POST', `${base}/characters/${sorcerer.id}/features/flexible-casting`, alice.token, {mode: 'to-slot', slotLevel: 3})).statusCode, 400, '5 points for a 3rd-level slot');
  });

  await t.test('archdruid wild-shapes without counting; supreme sneak gives stealth advantage; tranquility — sanctuary after a long rest', async () => {
    const druid = await hero('Архидруид', 'Друид', 20);
    const beasts = (await request('GET', `${base}/characters/${druid.id}/features`, alice.token)).json().features.find((feature: any) => feature.id === 'wild-shape').choices;
    for (let i = 0; i < 3; i++) {
      const shaped = await request('POST', `${base}/characters/${druid.id}/features/wild-shape`, alice.token, {beast: beasts[0].value});
      assert.equal(shaped.statusCode, 200, shaped.body);
      assert.equal((await request('POST', `${base}/characters/${druid.id}/features/end-wild-shape`, alice.token, {})).statusCode, 200);
    }
    assert.ok([undefined, 2].includes(await resource(druid.id, 'Дикий облик')), 'uses not spent');

    const thief = await hero('Вор', 'Плут', 9);
    const sneak = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: thief.id, kind: 'skill', key: 'stealth'})).json();
    assert.ok(sneak.outcome.reasons.includes('преимущество: превосходная скрытность'), JSON.stringify(sneak.outcome.reasons));

    const monk = await hero('Спокойный', 'Монах', 11, {wisdom: 18, hpCurrent: 100});
    const rested = await request('POST', `${base}/characters/${monk.id}/rest`, alice.token, {kind: 'long'});
    assert.equal(rested.statusCode, 200, rested.body);
    assert.ok((await codes(monk.id)).includes('sanctuary'));
    const ward = (await pg.query<any>(`SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code='sanctuary'`, [monk.id])).rows[0].parameters;
    assert.equal(ward.dc, 8 + 4 + 4);
  });

  await t.test('favored enemy (limited by level) and foe slayer: +WIS once per turn on a favored enemy', async () => {
    const ranger = await hero('Следопытка', 'Следопыт', 20, {wisdom: 16});
    const bow = await weapon(ranger.id, {name: 'Лук', attackBonus: 20, damageFormula: '1d1'}, alice.token);
    assert.equal((await request('PUT', `${base}/characters/${ranger.id}/favored-enemy`, alice.token, {undead: true, fiend: true, dragon: true})).statusCode, 200);
    assert.equal((await request('PUT', `${base}/characters/${ranger.id}/favored-enemy`, alice.token, {giant: true})).statusCode, 400, 'three at most');
    const zombie = await npc('Зомби', {}, 'undead');
    const goblin = await npc('Гоблин', {}, 'humanoid');
    const {sceneId} = await scene('Кладбище', [[alice.token, ranger.id, 0.5, 0.5], [gm.token, zombie.id, 1.5, 0.5], [gm.token, goblin.id, 0.5, 1.5]]);
    let blow: any = null;
    for (let i = 0; i < 10 && !blow?.damage; i++) blow = await attack(alice.token, ranger.id, bow.id, zombie.id, sceneId);
    assert.match(blow.damage.roll.label, /убийца врагов \+3/);
    assert.equal(blow.damage.applied, (blow.outcome.critical ? 2 : 1) + 3, '1d1 (2 on a crit) + WIS 3');
    let plain: any = null;
    for (let i = 0; i < 10 && !plain?.damage; i++) plain = await attack(alice.token, ranger.id, bow.id, goblin.id, sceneId);
    assert.doesNotMatch(plain.damage.roll.label, /убийца врагов/);
  });

  await t.test('protection from evil and purity of spirit: fiends attack with disadvantage and cannot charm', async () => {
    const paladin = await hero('Чистый', 'Паладин', 15);
    const fiend = await npc('Бес', {}, 'fiend');
    const claws = await weapon(fiend.id, {name: 'Когти', attackBonus: 5, damageFormula: '1d1'});
    const {sceneId} = await scene('Чистилище', [[alice.token, paladin.id, 0.5, 0.5], [gm.token, fiend.id, 1.5, 0.5]]);
    const blow = await attack(gm.token, fiend.id, claws.id, paladin.id, sceneId);
    assert.ok(blow.outcome.reasons.some((reason: string) => reason.includes('защита от добра и зла')), JSON.stringify(blow.outcome.reasons));
    const charm = await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [paladin.id], code: 'charmed', sourceCharacterId: fiend.id});
    assert.equal(charm.statusCode, 200, charm.body);
    assert.equal(charm.json().results[0].immune, 'чистота духа');

    const cleric = await hero('Жрица', 'Жрец', 3, {wisdom: 16});
    const knight = await hero('Оруженосец', 'Воин', 3);
    const spell = await request('POST', `${base}/characters/${cleric.id}/spells`, gm.token, {source: 'srd', srdIndex: 'protection-from-evil-and-good'});
    assert.equal(spell.statusCode, 201, spell.body);
    await pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,4,4)', [campaignId, cleric.id]);
    const cast = await request('POST', `${base}/characters/${cleric.id}/spells/${spell.json().id}/cast`, alice.token, {targetIds: [knight.id]});
    assert.equal(cast.statusCode, 201, cast.body);
    assert.ok((await codes(knight.id)).includes('protected_from_evil'));
    const fear = await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [knight.id], code: 'frightened', sourceCharacterId: fiend.id});
    assert.equal(fear.json().results[0].immune, 'защита от добра и зла');
  });

  await t.test('nature’s ward: immune to poison; nature’s sanctuary: a beast must save before attacking', async () => {
    const druid = await hero('Хранитель', 'Друид', 14, {wisdom: 20});
    await hurt(druid.id, 20, 'poison');
    assert.equal(await hp(druid.id), 400, 'poison immune');
    const poisoned = await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [druid.id], code: 'poisoned'});
    assert.equal(poisoned.json().results[0].immune, 'защита природы');
    const wolf = await npc('Волк', {wisdom: 1}, 'beast');
    const bite = await weapon(wolf.id, {name: 'Укус', attackBonus: 20, damageFormula: '1d1'});
    const {sceneId} = await scene('Чаща', [[alice.token, druid.id, 0.5, 0.5], [gm.token, wolf.id, 1.5, 0.5]]);
    let stopped: any = null;
    for (let i = 0; i < 10 && !stopped?.sanctuary; i++) stopped = await attack(gm.token, wolf.id, bite.id, druid.id, sceneId);
    assert.ok(stopped.sanctuary, JSON.stringify(stopped).slice(0, 300));
    assert.match(stopped.outcome.reasons[0], /Святилище природы/);
  });

  await t.test('holy nimbus lights 30 feet bright and 30 dim', async () => {
    const paladin = await hero('Свет', 'Паладин', 20);
    const {sceneId, scenePath} = await scene('Склеп', [[alice.token, paladin.id, -5.5, 0]], [24, 1]);
    await request('PATCH', scenePath, gm.token, {lighting: 'dark'});
    const before = (await request('GET', scenePath, gm.token)).json().illumination;
    assert.ok(before && !before.includes('2'), String(before));
    assert.equal((await request('POST', `${base}/characters/${paladin.id}/features/holy-nimbus`, alice.token, {sceneId})).statusCode, 200);
    const lit = (await request('GET', scenePath, gm.token)).json().illumination as string;
    assert.equal(lit[6], '2');
    assert.equal(lit[12], '2');
    assert.equal(lit[16], '1');
    assert.equal(lit[23], '0');
  });

  await t.test('hurl through hell after a spell attack; quivering palm after a flurry', async () => {
    const warlock = await hero('Колдун', 'Колдун', 14, {charisma: 20});
    const target = await npc('Мишень ада');
    const blast = await request('POST', `${base}/characters/${warlock.id}/spells`, gm.token, {source: 'srd', srdIndex: 'eldritch-blast'});
    assert.equal(blast.statusCode, 201, blast.body);
    const {sceneId} = await scene('Ад', [[alice.token, warlock.id, 0.5, 0.5], [gm.token, target.id, 2.5, 0.5]]);
    let cast: any = null;
    for (let i = 0; i < 10 && !cast?.hurl; i++) cast = (await request('POST', `${base}/characters/${warlock.id}/spells/${blast.json().id}/cast`, alice.token, {targetIds: [target.id], sceneId})).json();
    assert.ok(cast.hurl, JSON.stringify(cast).slice(0, 300));
    const hurled = await request('POST', `${base}/rolls/${cast.hurl.rollId}/hurl-through-hell`, alice.token);
    assert.equal(hurled.statusCode, 201, hurled.body);

    const monk = await hero('Ладонь', 'Монах', 17, {wisdom: 20, dexterity: 20});
    const victim = await npc('Чучело');
    await scene('Додзё', [[alice.token, monk.id, 0.5, 0.5], [gm.token, victim.id, 1.5, 0.5]]);
    await pg.query(`INSERT INTO character_weapons (campaign_id, character_id, name, ability, proficient, damage_formula, damage_type, range_feet, weapon_kind, properties, attack_bonus) VALUES ($1,$2,'Безоружный удар','finesse',true,'1d10+@mod','bludgeoning',5,'melee','[]'::jsonb,20)`, [campaignId, monk.id]);
    let flurry: any = null;
    for (let i = 0; i < 10 && !flurry?.quivering; i++) flurry = (await request('POST', `${base}/characters/${monk.id}/features/flurry-of-blows`, alice.token, {targetId: victim.id})).json();
    assert.ok(flurry.quivering, JSON.stringify(flurry).slice(0, 300));
    const planted = await request('POST', `${base}/rolls/${flurry.quivering.rollId}/quivering-palm`, alice.token);
    assert.equal(planted.statusCode, 201, planted.body);
    assert.ok((await codes(victim.id)).includes('quivering_palm'));
  });

  await t.test('flight: a flyer takes off with its own speed, is knocked prone and falls; the fly spell gives 60 feet', async () => {
    const harpy = await npc('Гарпия');
    await pg.query(`UPDATE characters SET sheet_extra = jsonb_set(COALESCE(sheet_extra, '{}'::jsonb), '{flySpeedFeet}', '40'::jsonb) WHERE id=$1`, [harpy.id]);
    const walker = await hero('Пешеход', 'Воин', 3);
    const {scenePath} = await scene('Небо', [[gm.token, harpy.id, 0.5, 0.5], [alice.token, walker.id, 3.5, 0.5]]);
    const objects = (await request('GET', scenePath, gm.token)).json().objects;
    assert.equal(objects.find((o: any) => o.character_id === harpy.id).canFly, true);
    assert.equal(objects.find((o: any) => o.character_id === walker.id).canFly, undefined);
    assert.equal((await request('PUT', `${base}/characters/${walker.id}/flying`, alice.token, {on: true})).statusCode, 400, 'a human does not fly');
    const up = await request('PUT', `${base}/characters/${harpy.id}/flying`, gm.token, {on: true});
    assert.equal(up.statusCode, 200, up.body);
    assert.ok((await codes(harpy.id)).includes('flying'));
    const prone = await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [harpy.id], code: 'prone'});
    assert.equal(prone.statusCode, 200, prone.body);
    assert.ok(!(await codes(harpy.id)).includes('flying'), 'knocked prone — falls');
    assert.ok((await codes(harpy.id)).includes('prone'));
    const fell = 1000 - await hp(harpy.id);
    assert.ok(fell >= 1 && fell <= 6, `from the default 10 feet — 1d6: ${fell}`);

    const wizard = await hero('Маг', 'Волшебник', 5, {intelligence: 16});
    const fly = await request('POST', `${base}/characters/${wizard.id}/spells`, gm.token, {source: 'srd', srdIndex: 'fly'});
    await pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,3,2,2)', [campaignId, wizard.id]);
    const cast = await request('POST', `${base}/characters/${wizard.id}/spells/${fly.json().id}/cast`, alice.token, {targetIds: [walker.id]});
    assert.equal(cast.statusCode, 201, cast.body);
    const flight = (await pg.query<any>(`SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code='flying'`, [walker.id])).rows[0];
    assert.equal(flight?.parameters?.feet, 60);
    const higher = await request('PUT', `${base}/characters/${walker.id}/flying`, alice.token, {on: true, height: 30});
    assert.equal(higher.statusCode, 200, higher.body);
    assert.equal((await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.character_id === walker.id).flightHeight, 30);
    const before = await hp(walker.id);
    const focus = (await pg.query<any>(`SELECT id FROM character_effects WHERE character_id=$1 AND effect_code='concentration'`, [wizard.id])).rows[0];
    assert.equal((await request('DELETE', `${base}/characters/${wizard.id}/effects/${focus.id}`, alice.token)).statusCode, 204);
    assert.ok(!(await codes(walker.id)).includes('flying'), 'the spell ended with the concentration');
    const drop = before - await hp(walker.id);
    assert.ok(drop >= 3 && drop <= 18, `3d6 from 30 feet: ${drop}`);
    assert.ok((await codes(walker.id)).includes('prone'));
  });

  await t.test('portrait crests: a hero’s class is shown to the whole table, an NPC’s only to those who control it', async () => {
    const bob = await register('bob_round21_crests');
    const invite = (await request('POST', `${base}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', bob.token, {code: invite});
    const mage = await hero('Чародейка', 'Волшебник 3', 3);
    const cultist = await npc('Культист-маг');
    const acolyte = await npc('Послушник-жрец');
    await pg.query('UPDATE characters SET class_name=$2 WHERE id=$1', [cultist.id, 'Колдун 5']);
    await pg.query('UPDATE characters SET class_name=$2 WHERE id=$1', [acolyte.id, 'Жрец 2']);
    const granted = await request('PUT', `${base}/characters/${acolyte.id}/access/${alice.user.id}`, gm.token, {level: 'edit'});
    assert.equal(granted.statusCode, 200, granted.body);
    const {scenePath} = await scene('Гербы', [[alice.token, mage.id, 0.5, 0.5], [gm.token, cultist.id, 3.5, 0.5], [gm.token, acolyte.id, 5.5, 0.5]]);
    const of = (list: any[], id: string) => list.find((o: any) => o.character_id === id);
    const asAlice = (await request('GET', scenePath, alice.token)).json().objects;
    const asBob = (await request('GET', scenePath, bob.token)).json().objects;
    const asGm = (await request('GET', scenePath, gm.token)).json().objects;
    assert.equal(of(asAlice, mage.id).classId, 'wizard');
    assert.equal(of(asBob, mage.id).classId, 'wizard', 'another player’s hero: the class is known at the table');
    assert.ok(of(asBob, cultist.id) && of(asBob, acolyte.id), 'the NPCs themselves are seen');
    assert.equal(of(asBob, cultist.id).classId, undefined);
    assert.equal(of(asBob, acolyte.id).classId, undefined);
    assert.equal(of(asAlice, cultist.id).classId, undefined);
    assert.equal(of(asAlice, acolyte.id).classId, 'cleric', 'an NPC she was given control of');
    assert.equal(of(asGm, cultist.id).classId, 'warlock');
  });

  await t.test('thief’s reflexes: a second turn at initiative −10 in the first round only', async () => {
    const thief = await hero('Карманник', 'Плут', 17);
    const ogre = await npc('Огр');
    const {scenePath} = await scene('Засада', [[alice.token, thief.id, 0.5, 0.5], [gm.token, ogre.id, 5.5, 0.5]]);
    const advance = await fight(scenePath, [[thief.id, 20], [ogre.id, 15]]);
    const queue = async () => (await request('GET', `${scenePath}/initiative`, gm.token)).json().entries as any[];
    const names = async () => (await queue()).map(entry => `${entry.name}${entry.is_current ? '*' : ''}:${entry.score}`);
    assert.deepEqual(await names(), ['Карманник*:20', 'Огр:15', 'Карманник: рефлексы вора:10']);
    await advance();
    assert.deepEqual(await names(), ['Карманник:20', 'Огр*:15', 'Карманник: рефлексы вора:10']);
    await advance();
    assert.deepEqual(await names(), ['Карманник*:20', 'Огр:15', 'Карманник: рефлексы вора*:10']);
    const entry = (await queue()).find(row => row.character_id === thief.id);
    assert.equal(entry.action_used, false, 'a fresh action for the second turn');
    assert.equal((await request('POST', `${scenePath}/initiative/advance`, alice.token)).statusCode, 204);
    assert.deepEqual(await names(), ['Карманник*:20', 'Огр:15'], 'round two: one turn, the reflex entry is gone');
    const round = (await pg.query<any>('SELECT combat_round FROM scenes WHERE id=(SELECT scene_id FROM initiative_entries WHERE character_id=$1 LIMIT 1)', [thief.id])).rows[0].combat_round;
    assert.equal(round, 2);
  });

  await t.test('draconic presence: an enemy starting its turn in 60 feet saves or is frightened', async () => {
    const sorcerer = await hero('Дракон', 'Чародей', 18, {charisma: 20});
    const foe = await npc('Наёмник', {wisdom: 1});
    const {sceneId, scenePath} = await scene('Логово', [[alice.token, sorcerer.id, 0.5, 0.5], [gm.token, foe.id, 6.5, 0.5]]);
    const advance = await fight(scenePath, [[sorcerer.id, 20], [foe.id, 10]]);
    const aura = await request('POST', `${base}/characters/${sorcerer.id}/features/draconic-presence`, alice.token, {sceneId, mode: 'fear'});
    assert.equal(aura.statusCode, 200, aura.body);
    assert.ok((await codes(sorcerer.id)).includes('concentration'));
    assert.equal(Number(await resource(sorcerer.id, 'Очки чародейства')), 13);
    await advance();
    const after = await codes(foe.id);
    assert.ok(after.includes('frightened') || after.includes('presence_resisted'), JSON.stringify(after));
    assert.ok(await lastRoll(foe.id, '%Драконьего присутствия%'));
    assert.ok(turn);
  });

  await t.test('auto turn: a flyer takes off, a paladin lights the nimbus, a sorcerer raises draconic presence, a berserker frightens when it has nothing to strike with', async () => {
    const auto = async (scenePath: string) => (await request('POST', `${scenePath}/initiative/auto`, gm.token, {advance: false})).json();

    const harpy = await npc('Гарпия-налётчица');
    await pg.query(`UPDATE characters SET sheet_extra = jsonb_set(COALESCE(sheet_extra, '{}'::jsonb), '{flySpeedFeet}', '40'::jsonb) WHERE id=$1`, [harpy.id]);
    await weapon(harpy.id, {name: 'Когти'});
    const prey = await hero('Добыча', 'Воин', 3);
    const sky = await scene('Утёс', [[gm.token, harpy.id, 0.5, 0.5], [alice.token, prey.id, 3.5, 0.5]]);
    await fight(sky.scenePath, [[harpy.id, 20], [prey.id, 10]]);
    const flew = await auto(sky.scenePath);
    assert.match(flew.summary, /взлетает \(высота 5 фут\.\)/, flew.summary);
    assert.ok((await codes(harpy.id)).includes('flying'));
    assert.ok(flew.attack || flew.attacks?.length, `after taking off it still strikes: ${flew.summary}`);
    const circling = await npc('Гарпия-кружащая');
    await pg.query(`UPDATE characters SET sheet_extra = jsonb_set(COALESCE(sheet_extra, '{}'::jsonb), '{flySpeedFeet}', '40'::jsonb) WHERE id=$1`, [circling.id]);
    await weapon(circling.id, {name: 'Когти'});
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'flying','{"feet": 40, "height": 20}'::jsonb)`, [campaignId, circling.id]);
    const quarry = await hero('Дичь', 'Воин', 3);
    const cliff = await scene('Скала', [[gm.token, circling.id, 0.5, 0.5], [alice.token, quarry.id, 1.5, 0.5]]);
    await fight(cliff.scenePath, [[circling.id, 20], [quarry.id, 10]]);
    const swoop = await auto(cliff.scenePath);
    assert.match(swoop.summary, /снижается до 5 фут\./, swoop.summary);
    assert.ok(swoop.attack || swoop.attacks?.length, swoop.summary);

    const paladin = await npc('Паладин-страж', {level: 20});
    await pg.query(`UPDATE characters SET class_name='Паладин' WHERE id=$1`, [paladin.id]);
    await weapon(paladin.id, {name: 'Меч'});
    const pilgrim = await hero('Паломник', 'Воин', 3);
    const chapel = await scene('Часовня', [[gm.token, paladin.id, 0.5, 0.5], [alice.token, pilgrim.id, 3.5, 0.5]]);
    await fight(chapel.scenePath, [[paladin.id, 20], [pilgrim.id, 10]]);
    const lit = await auto(chapel.scenePath);
    assert.match(lit.summary, /зажигает «Святой нимб»/, lit.summary);
    assert.ok((await codes(paladin.id)).includes('holy_nimbus'));
    assert.equal(lit.attacks.length, 0, 'the nimbus took the action');

    const sorcerer = await npc('Чародейка-дракон', {level: 18, charisma: 20});
    await pg.query(`UPDATE characters SET class_name='Чародей' WHERE id=$1`, [sorcerer.id]);
    const first = await hero('Первый', 'Воин', 3), second = await hero('Второй', 'Воин', 3);
    const lair = await scene('Пещера', [[gm.token, sorcerer.id, 0.5, 0.5], [alice.token, first.id, 5.5, 0.5], [alice.token, second.id, 6.5, 0.5]]);
    await fight(lair.scenePath, [[sorcerer.id, 20], [first.id, 10], [second.id, 9]]);
    const awe = await auto(lair.scenePath);
    assert.match(awe.summary, /«Драконье присутствие» \(аура страха\)/, awe.summary);
    assert.ok((await codes(sorcerer.id)).includes('draconic_presence'));
    assert.equal(Number(await resource(sorcerer.id, 'Очки чародейства')), 13);

    const berserker = await npc('Безоружный берсерк', {level: 10, charisma: 18});
    await pg.query(`UPDATE characters SET class_name='Варвар' WHERE id=$1`, [berserker.id]);
    const coward = await hero('Трус', 'Воин', 3, {wisdom: 1});
    const pit = await scene('Арена', [[gm.token, berserker.id, 0.5, 0.5], [alice.token, coward.id, 3.5, 0.5]]);
    await fight(pit.scenePath, [[berserker.id, 20], [coward.id, 10]]);
    const roar = await auto(pit.scenePath);
    assert.match(roar.summary, /«Пугающее присутствие» на «Трус»/, roar.summary);
    const after = await codes(coward.id);
    assert.ok(after.includes('frightened') || after.includes('presence_resisted'), JSON.stringify(after));
  });
});
