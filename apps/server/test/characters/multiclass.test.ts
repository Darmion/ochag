import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';
import {XP_THRESHOLDS} from '../../../../packages/domain/character/experience.ts';

test('multiclass', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 100_000});
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
  const gm = await register('gm_multi'), alice = await register('alice_multi');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Multiclass'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;

  const hero = async (name: string, className: string, level: number, extra: any = {}) => {
    const created = (await request('POST', `${base}/characters`, alice.token, {
      kind: 'character', name, strength: 15, dexterity: 14, constitution: 14, intelligence: 9, wisdom: 10, charisma: 14,
      hpMax: 40, hpCurrent: 40, armorClass: 14, speedFeet: 30, level, ...extra,
    })).json();
    await pg.query('UPDATE characters SET class_name=$2, experience=$3 WHERE id=$1', [created.id, className, XP_THRESHOLDS[level - 1]]);
    return created;
  };
  const sheet = async (id: string) => (await request('GET', `${base}/characters/${id}`, alice.token)).json();
  const rest = (id: string, body: any) => request('POST', `${base}/characters/${id}/rest`, alice.token, body);

  await t.test('the sheet reads the class text: classes, hit dice per die, Extra Attack that does not stack', async () => {
    const lira = await hero('Лира', 'Воин 3 / Волшебник 2', 5);
    const view = await sheet(lira.id);
    assert.deepEqual(view.class_info.classes.map((entry: any) => `${entry.label} ${entry.level}`), ['Воин 3', 'Волшебник 2']);
    assert.equal(view.class_info.multiclass, true);
    assert.equal(view.class_info.attacksPerAction, 1, 'fighter 3 — no Extra Attack yet');
    assert.deepEqual(view.hit_dice.pools, [{die: 10, total: 3, left: 3}, {die: 6, total: 2, left: 2}]);

    await pg.query('UPDATE characters SET level=6 WHERE id=$1', [lira.id]);
    const wrong = await sheet(lira.id);
    assert.equal(wrong.class_info.problem, 'сумма уровней классов (5) не равна уровню персонажа (6)');
    assert.deepEqual(wrong.class_info.classes.map((entry: any) => entry.level), [6], 'not understood — the first class with the whole level');
    await pg.query('UPDATE characters SET level=5 WHERE id=$1', [lira.id]);
  });

  await t.test('rests: d10s spent first, a long rest gives the d10s back first', async () => {
    const bran = await hero('Бран', 'Воин 3 / Волшебник 2', 5, {hpCurrent: 1});
    const short = await rest(bran.id, {kind: 'short', hitDice: 4});
    assert.equal(short.statusCode, 200, short.body);
    assert.deepEqual(short.json().result.hitDice.spentDice, [10, 10, 10, 6]);
    assert.match(short.json().summary, /костей хитов: 3 d10 \+ 1 d6/);
    const roll = (await request('GET', `${base}/rolls`, alice.token)).json().rolls[0];
    assert.match(roll.formula, /^3d10\+1d6\+8$/, 'CON +2 per die');
    assert.deepEqual((await sheet(bran.id)).hit_dice.pools.map((pool: any) => pool.left), [0, 1]);

    const long = await rest(bran.id, {kind: 'long'});
    assert.equal(long.json().result.hitDice.recovered, 2, 'half of five');
    assert.deepEqual((await sheet(bran.id)).hit_dice.pools.map((pool: any) => pool.left), [2, 1], 'two d10s back, not d6');
  });

  await t.test('slots of a multiclass spellcaster (PHB p. 165)', async () => {
    const mira = await hero('Мира', 'Волшебник 3 / Жрец 2', 5);
    const slots = await request('POST', `${base}/characters/${mira.id}/spell-slots/by-class`, alice.token);
    assert.equal(slots.statusCode, 200, slots.body);
    assert.deepEqual(slots.json().slots.slice(0, 3).map((slot: any) => slot.max), [4, 3, 2], 'caster level 5');
  });

  const learn = async (characterId: string, srdIndex: string) => (
    await pg.query<any>(`INSERT INTO character_spells (campaign_id, character_id, source, srd_index, prepared) VALUES ($1,$2,'srd',$3,true) RETURNING id`, [campaignId, characterId, srdIndex])
  ).rows[0].id as string;
  const slotRows = async (id: string) => Object.fromEntries((await pg.query<any>('SELECT level, current, max FROM character_spell_slots WHERE character_id=$1 ORDER BY level', [id])).rows.map(row => [row.level, `${row.current}/${row.max}`]));
  const setRule = async (value: string) => {
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='pact_slots'`, [campaignId]);
    const response = await request('POST', `${base}/rules`, gm.token, {key: 'pact_slots', kind: 'text', label: 'Ячейки договора', value});
    assert.equal(response.statusCode, 201, response.body);
  };

  await t.test('pact slots, merged (default): added to the shared slots, a short rest returns up to their number', async () => {
    const kael = await hero('Каэль', 'Колдун 3 / Чародей 2', 5);
    assert.equal((await request('POST', `${base}/characters/${kael.id}/spell-slots/by-class`, alice.token)).statusCode, 200);
    assert.deepEqual(await slotRows(kael.id), {1: '3/3', 2: '2/2'}, 'sorcerer 2 — three 1st; pact — two 2nd');
    await pg.query('UPDATE character_spell_slots SET current=CASE level WHEN 1 THEN 1 ELSE 0 END WHERE character_id=$1', [kael.id]);
    assert.equal((await rest(kael.id, {kind: 'short', hitDice: 0})).statusCode, 200);
    assert.deepEqual(await slotRows(kael.id), {1: '1/3', 2: '2/2'}, 'the pact level is back, sorcerer slots wait for a long rest');
  });

  await t.test('pact slots, separate: their own counter, spent when asked, at their level, back on a short rest', async () => {
    await setRule('separate');
    const nyx = await hero('Никс', 'Колдун 3 / Чародей 2', 5);
    assert.equal((await request('POST', `${base}/characters/${nyx.id}/spell-slots/by-class`, alice.token)).statusCode, 200);
    assert.deepEqual(await slotRows(nyx.id), {1: '3/3'}, 'only the sorcerer slots are shared');
    const listed = (await request('GET', `${base}/characters/${nyx.id}/spell-slots`, alice.token)).json();
    assert.deepEqual(listed.pact, {current: 2, max: 2, slotLevel: 2});

    const armor = await learn(nyx.id, 'mage-armor');
    const cast = await request('POST', `${base}/characters/${nyx.id}/spells/${armor}/cast`, alice.token, {pact: true});
    assert.equal(cast.statusCode, 201, cast.body);
    assert.deepEqual(cast.json().slot, {level: 2, current: 1, max: 2, pact: true}, 'a 1st-level spell from a 2nd-level pact slot');
    assert.deepEqual(await slotRows(nyx.id), {1: '3/3'}, 'shared slots untouched');
    const plain = await request('POST', `${base}/characters/${nyx.id}/spells/${armor}/cast`, alice.token, {});
    assert.deepEqual(plain.json().slot, {level: 1, current: 2, max: 3}, 'without pact — a shared slot');

    assert.equal((await rest(nyx.id, {kind: 'short', hitDice: 0})).statusCode, 200);
    assert.deepEqual((await request('GET', `${base}/characters/${nyx.id}/spell-slots`, alice.token)).json().pact, {current: 2, max: 2, slotLevel: 2});
    assert.deepEqual(await slotRows(nyx.id), {1: '2/3'}, 'the short rest gave back only the pact slot');

    const bard = await hero('Бардо', 'Бард 3', 3);
    const noPact = await request('POST', `${base}/characters/${bard.id}/spells/${await learn(bard.id, 'healing-word')}/cast`, alice.token, {pact: true});
    assert.equal(noPact.statusCode, 400);
    assert.match(noPact.json().message, /Отдельных ячеек договора нет/);
  });

  await t.test('pact slots, manual: the automation leaves the slots alone', async () => {
    await setRule('manual');
    const vex = await hero('Векс', 'Колдун 2 / Волшебник 1', 3);
    const byClass = await request('POST', `${base}/characters/${vex.id}/spell-slots/by-class`, alice.token);
    assert.equal(byClass.statusCode, 400);
    assert.match(byClass.json().message, /вручную/);
    assert.deepEqual(await slotRows(vex.id), {});
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='pact_slots'`, [campaignId]);
  });

  await t.test('the level-up window: a new class at its 1st level, 13+ only warns, the class text follows', async () => {
    const tor = await hero('Тор', 'Воин', 3);
    await pg.query('UPDATE characters SET experience=$2 WHERE id=$1', [tor.id, XP_THRESHOLDS[3]]);
    const plan = (await request('GET', `${base}/characters/${tor.id}/level-up?classId=wizard`, alice.token)).json().plan;
    assert.deepEqual([plan.newClass, plan.classLevel, plan.hitDie, plan.cantrips, plan.spells, plan.classText], [true, 1, 6, 3, 6, 'Воин 3 / Волшебник 1']);
    assert.deepEqual(plan.prerequisites, ['Волшебник: нужна Интеллект 13+']);

    const raised = await request('POST', `${base}/characters/${tor.id}/level-up`, alice.token, {
      hp: 'average', classId: 'wizard',
      cantrips: ['fire-bolt', 'light', 'mage-hand'],
      spells: ['magic-missile', 'shield', 'mage-armor', 'sleep', 'burning-hands', 'detect-magic'],
    });
    assert.equal(raised.statusCode, 201, raised.body);
    assert.equal(raised.json().className, 'Воин 3 / Волшебник 1');
    const after = await sheet(tor.id);
    assert.deepEqual([after.level, after.class_name, after.hp_max], [4, 'Воин 3 / Волшебник 1', 40 + 4 + 2], 'd6 average 4 + CON 2');
    assert.deepEqual(after.hit_dice.pools.map((pool: any) => `${pool.total}d${pool.die}`), ['3d10', '1d6']);
    assert.match(after.sheet_extra.text.levels.value, /Уровень 4 \(Волшебник 1\)\. Новый класс: Волшебник \(мультикласс\)/);

    await pg.query(`UPDATE characters SET class_name='Воин 3 / Волшебник 3', level=5, experience=$2 WHERE id=$1`, [tor.id, XP_THRESHOLDS[5]]);
    const refused = await request('POST', `${base}/characters/${tor.id}/level-up`, alice.token, {hp: 'average', classId: 'cleric'});
    assert.equal(refused.statusCode, 400);
    assert.match(refused.json().message, /Сначала поправьте запись класса/);
  });

  await t.test('a new class brings only its multiclass proficiencies (PHB p. 164) and its 1st-level features', async () => {
    const mira = await hero('Мира', 'Волшебник', 2);
    await pg.query('UPDATE characters SET experience=$2 WHERE id=$1', [mira.id, XP_THRESHOLDS[2]]);
    await pg.query(`INSERT INTO character_skills (campaign_id, character_id, skill_index, proficient) VALUES ($1,$2,'arcana',true)`, [campaignId, mira.id]);
    const sword = (await request('POST', `${base}/characters/${mira.id}/weapons`, alice.token, {name: 'Длинный меч', ability: 'strength', proficient: false, damageFormula: '1d8'})).json();
    const plan = (await request('GET', `${base}/characters/${mira.id}/level-up?classId=rogue`, alice.token)).json().plan;
    assert.equal(plan.multiclassGain.skills.count, 1);
    assert.match(plan.multiclassGain.text, /лёгкие доспехи, навык на выбор из списка класса, воровские инструменты/);
    assert.equal(plan.expertise, 2, 'a rogue’s 1st level brings expertise');
    assert.ok(plan.features.includes('Скрытая атака'), JSON.stringify(plan.features));

    const noSkill = await request('POST', `${base}/characters/${mira.id}/level-up`, alice.token, {hp: 'average', classId: 'rogue', expertise: ['arcana', 'stealth']});
    assert.equal(noSkill.statusCode, 400);
    assert.match(noSkill.json().message, /Навык нового класса/);
    const raised = await request('POST', `${base}/characters/${mira.id}/level-up`, alice.token, {hp: 'average', classId: 'rogue', skills: ['stealth'], expertise: ['arcana', 'stealth']});
    assert.equal(raised.statusCode, 201, raised.body);
    const skills = (await pg.query<any>('SELECT skill_index, proficient, expertise FROM character_skills WHERE character_id=$1 ORDER BY skill_index', [mira.id])).rows;
    assert.deepEqual(skills.map((row: any) => [row.skill_index, row.proficient, row.expertise]), [['arcana', true, true], ['stealth', true, true]]);
    const after = await sheet(mira.id);
    assert.match(after.sheet_extra.text.prof.value, /Мультикласс — Плут: лёгкие доспехи.*навык: Скрытность/);
    assert.equal((await pg.query<any>('SELECT proficient FROM character_weapons WHERE id=$1', [sword.id])).rows[0].proficient, false, 'a multiclass rogue gains no weapons');

    await pg.query('UPDATE characters SET experience=$2 WHERE id=$1', [mira.id, XP_THRESHOLDS[3]]);
    const fighter = (await request('GET', `${base}/characters/${mira.id}/level-up?classId=fighter`, alice.token)).json().plan;
    assert.equal(fighter.fightingStyles.length, 6, 'a fighter picks any style at 1st level');
    const asFighter = await request('POST', `${base}/characters/${mira.id}/level-up`, alice.token, {hp: 'average', classId: 'fighter', fightingStyle: 'dueling'});
    assert.equal(asFighter.statusCode, 201, asFighter.body);
    assert.equal((await pg.query<any>('SELECT proficient FROM character_weapons WHERE id=$1', [sword.id])).rows[0].proficient, true);
    assert.equal((await sheet(mira.id)).class_name, 'Волшебник 2 / Плут 1 / Воин 1');
  });

  await t.test('auto level-up keeps the class text in step: the first class grows', async () => {
    await request('POST', `${base}/rules`, gm.token, {key: 'level_choices', kind: 'flag', label: 'Окно', value: false});
    const ina = await hero('Ина', 'Плут 2 / Воин 1', 3);
    const award = await request('POST', `${base}/experience`, gm.token, {characterIds: [ina.id], amount: XP_THRESHOLDS[3]! - XP_THRESHOLDS[2]!});
    assert.equal(award.statusCode, 201, award.body);
    const after = await sheet(ina.id);
    assert.deepEqual([after.level, after.class_name], [4, 'Плут 3 / Воин 1']);
    assert.equal(after.class_info.multiclass, true);
  });

  await t.test('class features at their own class levels', async () => {
    const shade = await hero('Тень', 'Плут 3 / Воин 5', 8);
    const features = (await request('GET', `${base}/characters/${shade.id}/features`, alice.token)).json().features;
    const detail = (id: string) => features.find((feature: any) => feature.id === id)?.detail;
    assert.equal(detail('sneak-attack'), '2d6', 'rogue 3, not level 8');
    assert.equal(detail('second-wind'), '1d10+5 хитов', 'fighter 5');
    assert.ok(features.some((feature: any) => feature.id === 'cunning-action'));
    assert.equal((await sheet(shade.id)).class_info.attacksPerAction, 2, 'fighter 5 — Extra Attack');
  });
});
