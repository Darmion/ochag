import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('more feats', async t => {
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
  const gm = await register('gm_more'), alice = await register('alice_more');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'More feats'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const hero = async (name: string, className: string, level: number, feats: string[], extra: any = {}) => {
    const made = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 60, hpCurrent: 60, level, speedFeet: 30, ...extra})).json();
    await pg.query('UPDATE characters SET class_name=$2, sheet_extra=$3::jsonb WHERE id=$1', [made.id, className, JSON.stringify({feats})]);
    return made;
  };
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 100000, hpCurrent: 100000, armorClass: 1, speedFeet: 30, ...extra,
  })).json();
  const weapon = async (characterId: string, body: any, token = alice.token) => {
    const made = await request('POST', `${base}/characters/${characterId}/weapons`, token, {ability: 'strength', proficient: false, attackBonus: 20, ...body});
    assert.equal(made.statusCode, 201, made.body);
    return made.json();
  };
  const check = async (characterId: string, kind: string, key: string, extra: any = {}, token = alice.token) => {
    const response = await request('POST', `${base}/rolls/check`, token, {characterId, kind, key, ...extra});
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };
  const scene = async (name: string, members: Array<[string, string, number, number]>, width = 24) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: width, heightCells: 12})).json().id;
    for (const [token, characterId, x, z] of members) {
      const placed = await request('POST', `${base}/scenes/${sceneId}/objects`, token, {characterId, x, z});
      assert.equal(placed.statusCode, 201, placed.body);
    }
    return sceneId as string;
  };
  const hurt = async (characterId: string, amount: number, damageType: string) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: `1d1+${amount - 1}`})).json();
    return (await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId, mode: 'damage', damageType})).json();
  };

  await t.test('sentinel: Disengage does not save from it; its opportunity hit stops the target', async () => {
    const guard = await hero('Страж', 'Воин', 4, ['sentinel'], {strength: 10});
    const plain = await hero('Простой', 'Воин', 4, [], {strength: 10});
    const goblin = await npc('Гоблин-беглец');
    const sword = await weapon(guard.id, {name: 'Меч', damageFormula: '1d1'});
    await weapon(plain.id, {name: 'Меч', damageFormula: '1d1'});
    const sceneId = await scene('Застава', [[alice.token, guard.id, 0.5, 0.5], [alice.token, plain.id, 0.5, 2.5], [gm.token, goblin.id, 0.5, 1.5]]);
    const path = `${base}/scenes/${sceneId}`;
    const entryIds: Record<string, string> = {};
    for (const [id, score] of [[goblin.id, 30], [guard.id, 10], [plain.id, 5]] as const) {
      entryIds[id] = (await request('POST', `${path}/initiative/join`, gm.token, {characterId: id})).json().id;
      await request('PATCH', `${path}/initiative/${entryIds[id]}`, gm.token, {score});
    }
    await request('POST', `${path}/initiative/advance`, gm.token, {});
    const walk = async (x: number, z: number) => {
      const object = (await request('GET', path, gm.token)).json().objects.find((entry: any) => entry.character_id === goblin.id);
      return request('PUT', `${path}/objects/${object.id}`, gm.token, {
        x, y: object.y, z, rotationY: object.rotation_y, scale: object.scale, snapToGrid: object.snap_to_grid, parentObjectId: null, animationName: object.animation_name, revision: object.revision,
      });
    };
    assert.equal((await request('POST', `${path}/initiative/${entryIds[goblin.id]}/act`, gm.token, {action: 'disengage'})).statusCode, 200);
    const left = await walk(3.5, 1.5);
    assert.equal(left.statusCode, 200, left.body);
    const opportunities = (await pg.query<any>('SELECT reactor_name FROM scene_opportunities WHERE scene_id=$1', [sceneId])).rows.map(row => row.reactor_name);
    assert.deepEqual(opportunities, ['Страж'], 'Disengage — only the sentinel may strike');
    let swing = await check(guard.id, 'attack', sword.id, {targetCharacterId: goblin.id, sceneId, opportunity: true});
    for (let i = 0; i < 5 && !swing.outcome.hit; i++) {
      await pg.query('UPDATE initiative_entries SET reaction_used=false, moved_feet=0 WHERE character_id = ANY($1::uuid[])', [[guard.id, goblin.id]]);
      await pg.query('UPDATE scene_objects SET x=1.5, z=1.5 WHERE character_id=$1', [goblin.id]);
      await walk(3.5, 1.5);
      swing = await check(guard.id, 'attack', sword.id, {targetCharacterId: goblin.id, sceneId, opportunity: true});
    }
    assert.equal(swing.outcome.hit, true);
    assert.ok(swing.outcome.reasons.includes('часовой: скорость цели 0 до конца её хода'));
    await pg.query('UPDATE initiative_entries SET moved_feet=0 WHERE character_id=$1', [goblin.id]);
    const stuck = await walk(4.5, 1.5);
    assert.equal(stuck.statusCode, 400, 'speed 0');
    await request('POST', `${path}/initiative/advance`, gm.token, {});
    assert.equal((await pg.query<any>(`SELECT count(*)::int AS n FROM character_effects WHERE character_id=$1 AND effect_code='slowed'`, [goblin.id])).rows[0].n, 0, 'ends with its turn');
  });

  await t.test('crossbow expert, spell sniper; alert takes away the advantage of the unseen', async () => {
    const shooter = await hero('Арбалетчица', 'Воин', 4, ['crossbow-expert'], {dexterity: 10});
    const plain = await hero('Лучник', 'Воин', 4, [], {dexterity: 10});
    const brute = await npc('Громила');
    await scene('Тесно', [[alice.token, shooter.id, 0.5, 0.5], [alice.token, plain.id, 0.5, 2.5], [gm.token, brute.id, 1.5, 1.5]]);
    const sceneId = (await pg.query<any>(`SELECT id FROM scenes WHERE campaign_id=$1 AND name='Тесно'`, [campaignId])).rows[0].id;
    const crossbow = (id: string) => weapon(id, {name: 'Арбалет', ability: 'dexterity', damageFormula: '1d1', weaponKind: 'ranged', rangeFeet: 80, longRangeFeet: 320});
    const near = await check(plain.id, 'attack', (await crossbow(plain.id)).id, {targetCharacterId: brute.id, sceneId});
    assert.ok(near.outcome.reasons.some((reason: string) => reason.startsWith('помеха: враг рядом')));
    const expert = await check(shooter.id, 'attack', (await crossbow(shooter.id)).id, {targetCharacterId: brute.id, sceneId});
    assert.ok(!(expert.outcome.reasons ?? []).some((reason: string) => reason.startsWith('помеха: враг рядом')));
    assert.ok(expert.outcome.reasons.includes('эксперт по арбалетам: враг рядом не мешает'));

    const sniper = await hero('Снайпер', 'Волшебник', 5, ['spell-sniper'], {intelligence: 16});
    const mage = await hero('Маг', 'Волшебник', 5, [], {intelligence: 16});
    const far = await npc('Дальний голем');
    const range = await scene('Поле', [[alice.token, sniper.id, -29.5, 0.5], [alice.token, mage.id, -29.5, 2.5], [gm.token, far.id, 10.5, 0.5]], 60);
    const learn = async (id: string) => (await request('POST', `${base}/characters/${id}/spells`, gm.token, {source: 'srd', srdIndex: 'fire-bolt'})).json().id as string;
    const cast = async (id: string, entry: string) => request('POST', `${base}/characters/${id}/spells/${entry}/cast`, alice.token, {sceneId: range, targetIds: [far.id]});
    const blocked = await cast(mage.id, await learn(mage.id));
    assert.equal(blocked.statusCode, 400, '200 feet — past 120');
    assert.match(blocked.json().message, /дальше дистанции/);
    assert.equal((await cast(sniper.id, await learn(sniper.id))).statusCode, 201, 'spell sniper doubles it to 240');

    const watcher = await hero('Чуткий', 'Плут', 4, ['alert']);
    const careless = await hero('Беспечный', 'Плут', 4, []);
    const stalker = await npc('Невидимка', {strength: 10});
    const knife = await weapon(stalker.id, {name: 'Нож', damageFormula: '1d1'}, gm.token);
    await scene('Тьма', [[alice.token, watcher.id, 0.5, 0.5], [alice.token, careless.id, 2.5, 0.5], [gm.token, stalker.id, 1.5, 0.5]]);
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code) VALUES ($1,$2,'invisible')`, [campaignId, stalker.id]);
    const unseen = await check(stalker.id, 'attack', knife.id, {targetCharacterId: careless.id}, gm.token);
    assert.equal(unseen.outcome.advantage, 'adv');
    const noticed = await check(stalker.id, 'attack', knife.id, {targetCharacterId: watcher.id}, gm.token);
    assert.equal(noticed.outcome.advantage, 'none', 'alert');
  });

  await t.test('savage attacker once a turn, lucky on a miss, heavy armor master', async () => {
    const savage = await hero('Дикарь', 'Варвар', 4, ['savage-attacker'], {strength: 10});
    const dummy = await npc('Мешок', {armorClass: 1});
    const axe = await weapon(savage.id, {name: 'Топор', damageFormula: '1d12'});
    let blow = await check(savage.id, 'attack', axe.id, {targetCharacterId: dummy.id});
    for (let i = 0; i < 10 && !blow.outcome.hit; i++) blow = await check(savage.id, 'attack', axe.id, {targetCharacterId: dummy.id});
    assert.match(blow.damage.roll.label, /дикарь: лучший из двух бросков/);

    const lucky = await hero('Счастливчик', 'Плут', 4, ['lucky'], {dexterity: 10});
    const wall = await npc('Стена', {armorClass: 30});
    const stick = await weapon(lucky.id, {name: 'Палка', damageFormula: '1d1', attackBonus: -10});
    let miss = await check(lucky.id, 'attack', stick.id, {targetCharacterId: wall.id, lucky: true});
    for (let i = 0; i < 5 && miss.outcome.critical && !miss.outcome.lucky; i++) miss = await check(lucky.id, 'attack', stick.id, {targetCharacterId: wall.id, lucky: true});
    assert.ok((miss.outcome.reasons ?? []).some((reason: string) => /^везунчик \(очко удачи, осталось 2\): ещё к20 — \d+, (промах|попадание)$/.test(reason)), JSON.stringify(miss));
    assert.equal((await pg.query<any>(`SELECT current FROM character_resources WHERE character_id=$1 AND name='Очки удачи'`, [lucky.id])).rows[0].current, 2);
    const without = await check(lucky.id, 'attack', stick.id, {targetCharacterId: wall.id});
    assert.ok(!(without.outcome.reasons ?? []).some((reason: string) => reason.startsWith('везунчик')), 'only with the checkbox');

    const knight = await hero('Рыцарь', 'Воин', 4, ['heavy-armor-master']);
    assert.equal((await hurt(knight.id, 10, 'slashing')).applied, 7);
    assert.equal((await hurt(knight.id, 2, 'piercing')).applied, 0);
    assert.equal((await hurt(knight.id, 10, 'fire')).applied, 10);
  });

  await t.test('durable: a hit die heals at least twice CON; tough: +2 per level', async () => {
    const durable = await hero('Двужильный', 'Волшебник', 6, ['durable'], {constitution: 16, hpCurrent: 1});
    await pg.query('UPDATE characters SET hit_die=6 WHERE id=$1', [durable.id]);
    const rested = (await request('POST', `${base}/characters/${durable.id}/rest`, alice.token, {kind: 'short', hitDice: 6})).json();
    assert.equal(rested.result.hitDice.rolls.length, 6);
    assert.ok(rested.result.healed >= 6 * 6, `each die heals at least 6 (2 × CON +3): ${rested.result.healed}`);

    const tough = await hero('Крепыш', 'Воин', 4, ['tough'], {constitution: 10, hpMax: 40, hpCurrent: 40});
    const plain = await hero('Обычный', 'Воин', 4, [], {constitution: 10, hpMax: 40, hpCurrent: 40});
    for (const id of [tough.id, plain.id]) await request('POST', `${base}/experience`, gm.token, {characterIds: [id], amount: 6500});
    const gainOf = async (id: string) => (await request('POST', `${base}/characters/${id}/level-up`, alice.token, {hp: 'average'})).json().hpGain;
    assert.equal(await gainOf(tough.id), (await gainOf(plain.id)) + 2);
    const late = await hero('Новичок', 'Воин', 3, [], {constitution: 10, hpMax: 30, hpCurrent: 30});
    await request('POST', `${base}/experience`, gm.token, {characterIds: [late.id], amount: 2700});
    const taken = (await request('POST', `${base}/characters/${late.id}/level-up`, alice.token, {hp: 'average', asi: {kind: 'feat', name: 'Крепкий'}})).json();
    assert.equal(taken.hpGain, 6 + 8, 'average 6 and 2 × 4 levels at once');
  });

  await t.test('inspiring leader: temporary hit points to friends within 30 feet, not in a fight, once per short rest', async () => {
    const leader = await hero('Вождь', 'Паладин', 5, ['inspiring-leader'], {charisma: 16});
    const friend = await hero('Друг', 'Воин', 3, []);
    const far = await hero('Далёкий', 'Воин', 3, []);
    const foe = await npc('Враг');
    const sceneId = await scene('Лагерь', [[alice.token, leader.id, 0.5, 0.5], [alice.token, friend.id, 3.5, 0.5], [alice.token, far.id, 10.5, 0.5], [gm.token, foe.id, 1.5, 1.5]]);
    const speech = await request('POST', `${base}/characters/${leader.id}/inspiring-leader`, alice.token, {sceneId});
    assert.equal(speech.statusCode, 201, speech.body);
    assert.equal(speech.json().temp, 8, 'level 5 + CHA 3');
    const temp = async (id: string) => Number((await pg.query<any>('SELECT hp_temp FROM characters WHERE id=$1', [id])).rows[0].hp_temp);
    assert.deepEqual([await temp(leader.id), await temp(friend.id), await temp(far.id), await temp(foe.id)], [8, 8, 0, 0]);
    assert.match((await request('POST', `${base}/characters/${leader.id}/inspiring-leader`, alice.token, {sceneId})).json().message, /после короткого отдыха/);
    await request('POST', `${base}/characters/${leader.id}/rest`, alice.token, {kind: 'short'});
    const id = (await request('POST', `${base}/scenes/${sceneId}/initiative/join`, gm.token, {characterId: leader.id})).json().id;
    await request('PATCH', `${base}/scenes/${sceneId}/initiative/${id}`, gm.token, {score: 10});
    await request('POST', `${base}/scenes/${sceneId}/initiative/advance`, gm.token, {});
    assert.match((await request('POST', `${base}/characters/${leader.id}/inspiring-leader`, alice.token, {sceneId})).json().message, /в бою нельзя/);
    const nobody = await hero('Без черты', 'Воин', 3, []);
    assert.equal((await request('POST', `${base}/characters/${nobody.id}/inspiring-leader`, alice.token, {sceneId})).statusCode, 400);
  });
});
