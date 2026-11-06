import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('round 26: buffs that change the numbers, and healing without a formula', async t => {
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
  const gm = await register('gm_r26'), alice = await register('alice_r26');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Круг 26'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Поле', widthCells: 20, heightCells: 20})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const hero = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 30, hpCurrent: 30, level: 9, ...extra})).json();
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 200, hpCurrent: 200, armorClass: 1, ...extra,
  })).json();
  const place = (characterId: string, x: number, z: number, token = gm.token) => request('POST', `${scenePath}/objects`, token, {characterId, x, z});
  const effect = async (characterId: string, effectCode: string) =>
    (await pg.query<any>('SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code=$2 AND active', [characterId, effectCode])).rows[0]?.parameters ?? null;
  const learn = async (characterId: string, srdIndex: string) => {
    const made = await request('POST', `${base}/characters/${characterId}/spells`, gm.token, {source: 'srd', srdIndex});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const cast = async (characterId: string, entry: string, body: any) => {
    const done = await request('POST', `${base}/characters/${characterId}/spells/${entry}/cast`, alice.token, {sceneId, ...body});
    return done;
  };
  const row = async (id: string) => (await pg.query<any>('SELECT hp_current, death_successes, death_failures FROM characters WHERE id=$1', [id])).rows[0];
  const hurt = async (characterId: string, amount: number, damageType?: string) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: `1d1+${amount - 1}`})).json();
    return (await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId, mode: 'damage', ...(damageType ? {damageType} : {})})).json();
  };

  const cleric = await hero('Жрица', {wisdom: 16, intelligence: 16});
  const ally = await hero('Соратник');
  const goblin = await npc('Гоблин');
  await place(cleric.id, 0.5, 0.5, alice.token);
  await place(ally.id, 1.5, 0.5, alice.token);
  await place(goblin.id, 0.5, 1.5);
  await pg.query(
    `INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,9,9), ($1,$2,2,9,9), ($1,$2,3,9,9), ($1,$2,4,9,9), ($1,$2,5,9,9)`,
    [campaignId, cleric.id],
  );

  await t.test('the spell view asks for a target and for the element', async () => {
    await learn(cleric.id, 'protection-from-energy');
    const list = (await request('GET', `${base}/characters/${cleric.id}/spells`, alice.token)).json().spells;
    const found = list.find((entry: any) => entry.spell?.index === 'protection-from-energy' || entry.srd_index === 'protection-from-energy' || entry.spell?.name === 'Protection from Energy');
    assert.ok(found, JSON.stringify(list.map((entry: any) => [entry.srd_index, entry.spell?.index, entry.spell?.name])));
    const ward = found.spell;
    assert.equal(ward.needsTarget, true);
    assert.deepEqual(ward.element, ['acid', 'cold', 'fire', 'lightning', 'thunder']);
  });

  await t.test('«Указание»: +d4 to the next ability check, then gone', async () => {
    assert.ok((await cast(cleric.id, await learn(cleric.id, 'guidance'), {targetIds: [ally.id]})).statusCode < 300);
    assert.ok(await effect(ally.id, 'guidance'));
    const check = await request('POST', `${base}/rolls/check`, alice.token, {characterId: ally.id, kind: 'skill', key: 'athletics'});
    assert.equal(check.statusCode, 201, check.body);
    assert.ok(JSON.stringify(check.json().outcome).includes('указание'), JSON.stringify(check.json().outcome));
    assert.equal(await effect(ally.id, 'guidance'), null);
  });

  await t.test('«Сопротивление»: +d4 to the next saving throw', async () => {
    assert.ok((await cast(cleric.id, await learn(cleric.id, 'resistance'), {targetIds: [ally.id]})).statusCode < 300);
    const save = await request('POST', `${base}/rolls/check`, alice.token, {characterId: ally.id, kind: 'save', key: 'constitution'});
    assert.ok(JSON.stringify(save.json().outcome).includes('сопротивление'), JSON.stringify(save.json().outcome));
    assert.equal(await effect(ally.id, 'resistance_die'), null);
  });

  await t.test('«Меткий удар»: advantage on the first attack against that target', async () => {
    const strike = await learn(cleric.id, 'true-strike');
    assert.equal((await cast(cleric.id, strike, {})).statusCode, 400, 'needs a target');
    assert.ok((await cast(cleric.id, strike, {targetIds: [goblin.id]})).statusCode < 300);
    assert.equal((await effect(cleric.id, 'true_strike')).targetId, goblin.id);
    const club = (await request('POST', `${base}/characters/${cleric.id}/weapons`, alice.token, {name: 'Палка', ability: 'strength', proficient: false, damageFormula: '1d1'})).json();
    const swing = await request('POST', `${base}/rolls/check`, alice.token, {characterId: cleric.id, kind: 'attack', key: club.id, targetCharacterId: goblin.id, sceneId});
    assert.ok(swing.json().outcome.reasons.includes('преимущество: меткий удар'), JSON.stringify(swing.json().outcome));
    assert.equal(await effect(cleric.id, 'true_strike'), null);
  });

  await t.test('«Размытый образ»: attacks against her are made with disadvantage', async () => {
    assert.ok((await cast(cleric.id, await learn(cleric.id, 'blur'), {})).statusCode < 300);
    const bite = (await request('POST', `${base}/characters/${goblin.id}/weapons`, gm.token, {name: 'Укус', ability: 'strength', proficient: false, damageFormula: '1d1'})).json();
    const swing = await request('POST', `${base}/rolls/check`, gm.token, {characterId: goblin.id, kind: 'attack', key: bite.id, targetCharacterId: cleric.id, sceneId});
    assert.ok(swing.json().outcome.reasons.includes('помеха: размытый образ'), JSON.stringify(swing.json().outcome));
  });

  await t.test('«Дубовая кора»: AC at least 16 against attacks', async () => {
    await pg.query('UPDATE characters SET armor_class=11 WHERE id=$1', [ally.id]);
    assert.ok((await cast(cleric.id, await learn(cleric.id, 'barkskin'), {targetIds: [ally.id]})).statusCode < 300);
    const bite = (await pg.query<any>('SELECT id FROM character_weapons WHERE character_id=$1', [goblin.id])).rows[0];
    const swing = await request('POST', `${base}/rolls/check`, gm.token, {characterId: goblin.id, kind: 'attack', key: bite.id, targetCharacterId: ally.id, sceneId});
    assert.equal(swing.statusCode, 201, swing.body);
    const preview = (await request('GET', `${base}/rolls/attack-preview?characterId=${goblin.id}&key=${bite.id}&targetCharacterId=${ally.id}&sceneId=${sceneId}`, gm.token)).json();
    assert.ok(Math.abs(Number(preview.hitChance) - 0.25) < 0.051, JSON.stringify(preview));
  });

  await t.test('«Защита от энергии» resists the chosen element; «Каменная кожа» — nonmagical weapons', async () => {
    const ward = (await pg.query<any>(`SELECT id FROM character_spells WHERE character_id=$1 AND srd_index='protection-from-energy'`, [cleric.id])).rows[0].id;
    assert.equal((await cast(cleric.id, ward, {targetIds: [ally.id]})).statusCode, 400, 'the element is required');
    assert.ok((await cast(cleric.id, ward, {targetIds: [ally.id], element: 'fire'})).statusCode < 300);
    assert.equal((await hurt(ally.id, 10, 'fire')).applied, 5);
    assert.equal((await hurt(ally.id, 4, 'cold')).applied, 4);
    await pg.query('UPDATE characters SET hp_current=30 WHERE id=$1', [ally.id]);
    assert.ok((await cast(cleric.id, await learn(cleric.id, 'stoneskin'), {targetIds: [ally.id]})).statusCode < 300);
    assert.equal((await hurt(ally.id, 10, 'slashing')).applied, 5);
  });

  await t.test('«Скороход»: +10 ft of speed', async () => {
    await pg.query('UPDATE characters SET speed_feet=30 WHERE id=$1', [ally.id]);
    assert.ok((await cast(cleric.id, await learn(cleric.id, 'longstrider'), {targetIds: [ally.id]})).statusCode < 300);
    assert.ok(await effect(ally.id, 'longstrider'));
    await request('POST', `${scenePath}/initiative/join`, alice.token, {characterId: ally.id});
    await pg.query('UPDATE initiative_entries SET is_current = (character_id = $1) WHERE scene_id=$2', [ally.id, sceneId]);
    const placement = (await pg.query<any>('SELECT id FROM scene_objects WHERE character_id=$1', [ally.id])).rows[0].id;
    const reach = (await request('GET', `${scenePath}/objects/${placement}/reach`, alice.token)).json();
    assert.equal(reach.budget, 40, JSON.stringify(reach));
    assert.ok(reach.reasons.some((reason: string) => /Скороход/.test(reason)), JSON.stringify(reach.reasons));
    await pg.query('DELETE FROM initiative_entries WHERE scene_id=$1', [sceneId]);
  });

  await t.test('«Защита от смерти»: the first drop to 0 leaves 1 hit point', async () => {
    await pg.query('UPDATE characters SET hp_current=30 WHERE id=$1', [ally.id]);
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code IN ('energy_ward', 'stoneskin')`, [ally.id]);
    assert.ok((await cast(cleric.id, await learn(cleric.id, 'death-ward'), {targetIds: [ally.id]})).statusCode < 300);
    await hurt(ally.id, 40);
    assert.equal((await row(ally.id)).hp_current, 1);
    assert.equal(await effect(ally.id, 'death_ward'), null);
  });

  await t.test('«Уход за умирающим» stabilizes, «Возрождение» brings back, «Высшее восстановление» lifts exhaustion', async () => {
    await hurt(ally.id, 5);
    assert.equal((await row(ally.id)).hp_current, 0);
    const spare = await cast(cleric.id, await learn(cleric.id, 'spare-the-dying'), {targetIds: [ally.id]});
    assert.ok(spare.statusCode < 300, spare.body);
    assert.ok(await effect(ally.id, 'stable'));
    assert.ok(spare.json().targets[0].notes.includes('стабилен'));
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'dead','{"source":"hp"}')`, [campaignId, ally.id]);
    const back = await cast(cleric.id, await learn(cleric.id, 'revivify'), {targetIds: [ally.id]});
    assert.ok(back.statusCode < 300, back.body);
    assert.equal(await effect(ally.id, 'dead'), null);
    assert.equal((await row(ally.id)).hp_current, 1);
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'exhaustion_2','{}')`, [campaignId, ally.id]);
    const restore = await cast(cleric.id, await learn(cleric.id, 'greater-restoration'), {targetIds: [ally.id]});
    assert.ok(restore.statusCode < 300, restore.body);
    assert.ok(await effect(ally.id, 'exhaustion_1'));
    assert.equal(await effect(ally.id, 'exhaustion_2'), null);
  });
});
