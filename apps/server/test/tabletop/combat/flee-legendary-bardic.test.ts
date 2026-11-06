import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('flight, NPC opportunity attacks, legendary areas and moves, bardic saves, fuller combat summary', async t => {
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
  const gm = await register('gm_flee'), alice = await register('alice_flee');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Flee'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const hero = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 200, hpCurrent: 200, speedFeet: 30, ...extra})).json();
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 100, hpCurrent: 100, speedFeet: 30, ...extra,
  })).json();
  const weapon = (id: string, body: any) => request('POST', `${base}/characters/${id}/weapons`, gm.token, {ability: 'strength', proficient: false, damageFormula: '1d1', ...body});
  const effect = (id: string, code: string, parameters: any) =>
    pg.query('INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,$3,$4::jsonb)', [campaignId, id, code, JSON.stringify(parameters)]);
  const hasEffect = async (id: string, code: string) => (await pg.query<any>('SELECT 1 FROM character_effects WHERE character_id=$1 AND effect_code=$2 AND active', [id, code])).rows.length > 0;
  const hp = async (id: string) => (await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current as number;
  const spot = async (id: string) => (await pg.query<any>('SELECT x::float8 AS x, z::float8 AS z FROM scene_objects WHERE character_id=$1', [id])).rows[0] as {x: number; z: number};
  const arena = async (name: string, members: Array<[string, string, number, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 30, heightCells: 10})).json().id;
    const scenePath = `${base}/scenes/${sceneId}`;
    for (const [token, characterId, x, z] of members) await request('POST', `${scenePath}/objects`, token, {characterId, x, z});
    const entries: Record<string, string> = {};
    for (const [, characterId, , , score] of members) {
      const id = (await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId})).json().id;
      await request('PATCH', `${scenePath}/initiative/${id}`, gm.token, {score});
      entries[characterId] = id;
    }
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    return {sceneId, scenePath, entries, auto: async () => (await request('POST', `${scenePath}/initiative/auto`, gm.token, {advance: false})).json()};
  };
  const entryRow = async (id: string) => (await pg.query<any>('SELECT action_used, dashes, reaction_used, legendary_used FROM initiative_entries WHERE character_id=$1', [id])).rows[0];

  await t.test('turned: flees as far as it can with a Dash and does not attack', async () => {
    const cleric = await hero('Отец Ян');
    const zombie = await npc('Зомби', {speedFeet: 20});
    await weapon(zombie.id, {name: 'Удар'});
    await effect(zombie.id, 'turned', {source: 'feature', sourceCharacterId: cleric.id, sourceName: 'Отец Ян', remainingRounds: 10, endsOnDamage: true});
    const {auto} = await arena('Изгнание', [[gm.token, zombie.id, -0.5, 0.5, 30], [alice.token, cleric.id, -1.5, 0.5, 5]]);
    const result = await auto();
    assert.ok(result.fled, result.summary);
    assert.equal(result.fled.dashed, true);
    assert.equal(result.attack, null);
    assert.match(result.summary, /изгнан — бежит от «Отец Ян» \(Рывок\)/);
    assert.equal((await spot(zombie.id)).x, 7.5, '40 feet (speed 20 and a Dash) straight away');
    const row = await entryRow(zombie.id);
    assert.deepEqual([row.action_used, row.dashes], [true, 1]);
  });

  await t.test('frightened, cannot come closer to strike: flees from the source in sight', async () => {
    const knight = await hero('Рыцарь');
    const goblin = await npc('Трус');
    await weapon(goblin.id, {name: 'Кинжал'});
    await effect(goblin.id, 'frightened', {source: 'apply', sourceCharacterId: knight.id, sourceName: 'Рыцарь'});
    const {auto} = await arena('Испуг', [[gm.token, goblin.id, 0.5, 0.5, 30], [alice.token, knight.id, 3.5, 0.5, 5]]);
    const result = await auto();
    assert.ok(result.fled, result.summary);
    assert.match(result.summary, /испуган — бежит от «Рыцарь»/);
    assert.ok((await spot(goblin.id)).x < 0.5 - 5, 'well away from the knight');
  });

  await t.test('an NPC strikes by itself when a hero leaves its reach; off by the flag', async () => {
    const runner = await hero('Бегун');
    const orc = await npc('Орк');
    await weapon(orc.id, {name: 'Секира', attackBonus: 20, damageFormula: '1d1+2'});
    const {scenePath} = await arena('Уход', [[alice.token, runner.id, 0.5, 0.5, 30], [gm.token, orc.id, 1.5, 0.5, 5]]);
    const walk = async (x: number) => {
      const place = (await request('GET', scenePath, gm.token)).json().objects.find((object: any) => object.character_id === runner.id);
      return request('PUT', `${scenePath}/objects/${place.id}`, alice.token, {
        x, y: place.y, z: 0.5, rotationY: place.rotation_y, scale: place.scale, snapToGrid: place.snap_to_grid,
        parentObjectId: null, animationName: place.animation_name, revision: place.revision,
      });
    };
    assert.equal((await walk(-1.5)).statusCode, 200);
    const swing = (await pg.query<any>(`SELECT outcome FROM roll_log WHERE character_id=$1 AND outcome->>'kind'='attack' ORDER BY created_at DESC LIMIT 1`, [orc.id])).rows[0];
    assert.equal(swing?.outcome.target.name, 'Бегун', 'the orc swung at once');
    assert.equal((await entryRow(orc.id)).reaction_used, true);
    assert.equal((await pg.query<any>('SELECT count(*)::int AS n FROM scene_opportunities WHERE mover_id=$1', [runner.id])).rows[0].n, 0, 'used');

    await request('POST', `${base}/rules`, gm.token, {key: 'npc_opportunity', kind: 'flag', label: 'НПС сами', value: false});
    await pg.query('UPDATE initiative_entries SET reaction_used=false WHERE character_id=$1', [orc.id]);
    await pg.query('UPDATE scene_objects SET x=0.5 WHERE character_id=$1', [runner.id]);
    await pg.query('UPDATE initiative_entries SET moved_feet=0 WHERE character_id=$1', [runner.id]);
    assert.equal((await walk(-1.5)).statusCode, 200);
    assert.equal((await pg.query<any>('SELECT count(*)::int AS n FROM scene_opportunities WHERE mover_id=$1', [runner.id])).rows[0].n, 1, 'left for the GM button');
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='npc_opportunity'`, [campaignId]);
  });

  await t.test('an opportunity attack happens as the hero leaves — a wall where he ends up does not stop it', async () => {
    const sneak = await hero('Ловкач');
    const ogre = await npc('Огр');
    await weapon(ogre.id, {name: 'Дубина', attackBonus: 20});
    const {scenePath} = await arena('За угол', [[alice.token, sneak.id, 0.5, 0.5, 30], [gm.token, ogre.id, 1.5, 0.5, 5]]);
    assert.equal((await request('POST', `${scenePath}/walls`, gm.token, {x1: 1, z1: -2, x2: 1, z2: 0})).statusCode, 201);
    const place = (await request('GET', scenePath, gm.token)).json().objects.find((object: any) => object.character_id === sneak.id);
    const moved = await request('PUT', `${scenePath}/objects/${place.id}`, alice.token, {
      x: 0.5, y: place.y, z: -1.5, rotationY: place.rotation_y, scale: place.scale, snapToGrid: place.snap_to_grid, parentObjectId: null, animationName: place.animation_name, revision: place.revision,
    });
    assert.equal(moved.statusCode, 200, moved.body);
    const swing = (await pg.query<any>(`SELECT outcome FROM roll_log WHERE character_id=$1 AND outcome->>'kind'='attack' ORDER BY created_at DESC LIMIT 1`, [ogre.id])).rows[0];
    assert.equal(swing?.outcome.target.name, 'Ловкач');
    assert.equal(swing.outcome.cover, undefined, 'no cover — it struck as he left');
  });

  await t.test('legendary area: a wing beat around the boss — not with an ally in it; legendary move closes in', async () => {
    const dragon = await npc('Дракон', {hpMax: 300, hpCurrent: 300, speedFeet: 40});
    await weapon(dragon.id, {name: 'Укус'});
    await request('PUT', `${base}/characters/${dragon.id}/boss`, gm.token, {
      legendaryActions: 3,
      options: [{name: 'Удар крыльями', cost: 2, text: 'Каждое существо в 10 фт. — спасбросок Ловкости СЛ 30, иначе 15 (2к6 + 8) дробящего урона и сбито с ног.'}],
      phases: [],
    });
    const near = await hero('Близкий');
    const far = await hero('Дальний');
    const kobold = await npc('Кобольд', {hpMax: 30, hpCurrent: 30});
    const {scenePath, entries} = await arena('Крылья', [
      [alice.token, near.id, 1.5, 0.5, 20], [alice.token, far.id, 9.5, 5.5, 15], [gm.token, kobold.id, -0.5, 1.5, 12], [gm.token, dragon.id, 0.5, 0.5, 10],
    ]);
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {entryId: entries[near.id]});
    assert.equal(await hp(near.id), 200);
    assert.equal((await entryRow(dragon.id)).legendary_used, 0);
    await pg.query('UPDATE scene_objects SET x=-9.5, z=4.5 WHERE character_id=$1', [kobold.id]);
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {entryId: entries[far.id]});
    assert.ok(await hp(near.id) <= 190, 'at least 10 from 2d6+8');
    assert.ok(await hasEffect(near.id, 'prone'));
    assert.equal(await hp(far.id), 200);
    const chat = (await pg.query<any>(`SELECT body FROM chat_messages WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 1`, [campaignId])).rows[0].body;
    assert.match(chat, /Легендарное действие: Удар крыльями \(стоит 2\)/);
    assert.equal((await entryRow(dragon.id)).legendary_used, 0, 'its own turn began right after — the actions are back');

    const wyrm = await npc('Змей', {speedFeet: 40});
    await weapon(wyrm.id, {name: 'Хвост'});
    await request('PUT', `${base}/characters/${wyrm.id}/boss`, gm.token, {
      legendaryActions: 1, options: [{name: 'Перемещение', cost: 1, text: 'Перемещается на половину скорости, не провоцируя атак при уходе.'}], phases: [],
    });
    const prey = await hero('Добыча');
    const second = await hero('Второй');
    const hunt = await arena('Погоня', [[alice.token, prey.id, 5.5, 0.5, 20], [gm.token, kobold.id, 9.5, 4.5, 15], [gm.token, wyrm.id, -9.5, 0.5, 10], [alice.token, second.id, 9.5, 2.5, 5]]);
    await request('POST', `${hunt.scenePath}/initiative/advance`, gm.token, {entryId: hunt.entries[prey.id]});
    assert.equal((await spot(wyrm.id)).x, -5.5, 'four cells closer');
    await request('POST', `${hunt.scenePath}/initiative/advance`, gm.token, {});
    const manual = await request('POST', `${hunt.scenePath}/initiative/${hunt.entries[wyrm.id]}/legendary`, gm.token, {option: 0});
    assert.equal(manual.statusCode, 200, manual.body);
    assert.match(manual.json().summary, /подходит к «Добыча»/);
    assert.equal((await spot(wyrm.id)).x, -1.5);
  });

  await t.test('bardic die on a save the server rolls: spent by itself when it can help; «manual» keeps it', async () => {
    const singer = await hero('Слушатель', {constitution: 10});
    const give = () => effect(singer.id, 'bardic_inspiration', {source: 'feature', die: 12, sourceName: 'Лира', remainingRounds: 100});
    const poison = () => request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [singer.id], code: 'poisoned', save: {ability: 'constitution', dc: 12}});
    await give();
    let used = false;
    for (let i = 0; i < 60 && !used; i++) {
      await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code='poisoned'`, [singer.id]);
      assert.equal((await poison()).statusCode, 200);
      used = !(await hasEffect(singer.id, 'bardic_inspiration'));
    }
    assert.ok(used, 'a failed save came up and the die went in');
    const save = (await pg.query<any>(`SELECT outcome, total FROM roll_log WHERE character_id=$1 AND outcome->>'kind'='save' ORDER BY created_at DESC LIMIT 1`, [singer.id])).rows[0];
    assert.ok(save.outcome.reasons.some((reason: string) => /^вдохновение барда \(Лира\) \+к12: \+\d+ — (спасбросок удался|не хватило)$/.test(reason)), JSON.stringify(save.outcome));

    await request('POST', `${base}/rules`, gm.token, {key: 'bardic_saves', kind: 'text', label: 'Кость барда', value: 'manual'});
    await give();
    let failed = false;
    for (let i = 0; i < 60 && !failed; i++) {
      await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code='poisoned'`, [singer.id]);
      await poison();
      failed = await hasEffect(singer.id, 'poisoned');
    }
    assert.ok(failed);
    assert.ok(await hasEffect(singer.id, 'bardic_inspiration'), 'kept for a roll of her own');
  });

  await t.test('combat summary: hidden rolls, traps and the GM’s own hit point edits count too', async () => {
    const fighter = await hero('Боец');
    const brute = await npc('Громила', {hpMax: 50, hpCurrent: 50});
    const {sceneId, scenePath} = await arena('Итоги', [[alice.token, fighter.id, 0.5, 0.5, 20], [gm.token, brute.id, 4.5, 0.5, 10]]);
    const sheet = (await request('GET', `${base}/characters/${brute.id}`, gm.token)).json();
    assert.equal((await request('PATCH', `${base}/characters/${brute.id}`, gm.token, {hpCurrent: 43, revision: sheet.revision})).statusCode, 200);
    await request('POST', `${scenePath}/triggers`, gm.token, {kind: 'enter', shape: 'circle', x: -1.5, z: 0.5, direction: 0, sizeFeet: 5, name: 'Шипы', damageFormula: '1d1+4', damageType: 'piercing'});
    const place = (await request('GET', scenePath, gm.token)).json().objects.find((object: any) => object.character_id === fighter.id);
    const moved = await request('PUT', `${scenePath}/objects/${place.id}`, alice.token, {
      x: -1.5, y: place.y, z: 0.5, rotationY: place.rotation_y, scale: place.scale, snapToGrid: place.snap_to_grid, parentObjectId: null, animationName: place.animation_name, revision: place.revision,
    });
    assert.equal(moved.statusCode, 200, moved.body);
    const secret = (await request('POST', `${base}/rolls`, gm.token, {formula: '1d1+8', characterId: brute.id, hidden: true})).json();
    await request('POST', `${base}/rolls/${secret.id}/apply`, gm.token, {characterId: fighter.id, mode: 'damage'});
    assert.equal((await request('DELETE', `${scenePath}/initiative`, gm.token)).statusCode, 204);
    const summary = (await request('GET', `${scenePath}/combat-summary`, alice.token)).json().summary;
    const by = (name: string) => summary.participants.find((entry: any) => entry.name === name);
    assert.equal(by('Громила').damageTaken, 7, 'the GM edit');
    assert.equal(by('Громила').damageDealt, 9, 'the hidden roll');
    assert.equal(by('Боец').damageTaken, 14, 'trap 5 + hidden 9');
    assert.deepEqual(summary.unrolled, {trap: 5, zone: 0, hazard: 0, manual: 7});
    assert.equal((await pg.query<any>('SELECT count(*)::int AS n FROM combat_events WHERE scene_id=$1', [sceneId])).rows[0].n, 2);
  });
});
