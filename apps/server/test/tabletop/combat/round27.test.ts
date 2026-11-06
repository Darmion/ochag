import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('round 27: mirror image, hypnotic pattern, haste and slow', async t => {
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
  const gm = await register('gm_r27'), alice = await register('alice_r27');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Круг 27'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Поле', widthCells: 20, heightCells: 20})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const initiative = `${scenePath}/initiative`;

  const hero = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 30, hpCurrent: 30, level: 9, ...extra})).json();
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 200, hpCurrent: 200, armorClass: 1, wisdom: 1, ...extra,
  })).json();
  const place = (characterId: string, x: number, z: number, token = gm.token) => request('POST', `${scenePath}/objects`, token, {characterId, x, z});
  const effect = async (characterId: string, effectCode: string) =>
    (await pg.query<any>('SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code=$2 AND active', [characterId, effectCode])).rows[0]?.parameters ?? null;
  const codes = async (characterId: string) =>
    (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active', [characterId])).rows.map(row => row.effect_code as string);
  const learn = async (characterId: string, srdIndex: string) => {
    const made = await request('POST', `${base}/characters/${characterId}/spells`, gm.token, {source: 'srd', srdIndex});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const cast = (characterId: string, entry: string, body: any) =>
    request('POST', `${base}/characters/${characterId}/spells/${entry}/cast`, alice.token, {sceneId, ...body});
  const hurt = async (characterId: string, amount: number) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: `1d1+${amount - 1}`})).json();
    return (await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId, mode: 'damage'})).json();
  };
  const weapon = async (characterId: string, token: string) =>
    (await request('POST', `${base}/characters/${characterId}/weapons`, token, {name: 'Палка', ability: 'strength', proficient: false, damageFormula: '1d1'})).json().id as string;
  const preview = async (attackerId: string, key: string, targetId: string, token: string) =>
    (await request('GET', `${base}/rolls/attack-preview?characterId=${attackerId}&key=${key}&targetCharacterId=${targetId}&sceneId=${sceneId}&advantage=none`, token)).json();
  const reach = async (characterId: string, token: string) => {
    const placement = (await pg.query<any>('SELECT id FROM scene_objects WHERE character_id=$1', [characterId])).rows[0].id;
    return (await request('GET', `${scenePath}/objects/${placement}/reach`, token)).json();
  };

  const cleric = await hero('Жрица', {wisdom: 20});
  const mage = await hero('Маг', {intelligence: 20, wisdom: 20});
  const ally = await hero('Соратник');
  const goblin = await npc('Гоблин');
  const dreamer = await npc('Мечтатель');
  await place(cleric.id, 0.5, 0.5, alice.token);
  await place(mage.id, 2.5, 0.5, alice.token);
  await place(ally.id, 1.5, 0.5, alice.token);
  await place(goblin.id, 0.5, 1.5);
  await place(dreamer.id, 1.5, 1.5);
  for (const caster of [cleric.id, mage.id]) {
    await pg.query(
      `INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,9,9), ($1,$2,2,9,9), ($1,$2,3,9,9), ($1,$2,4,9,9)`,
      [campaignId, caster],
    );
  }
  const bite = await weapon(goblin.id, gm.token);
  const club = await weapon(ally.id, alice.token);

  await t.test('«Зеркальные отражения»: blows go into the images until they are broken; truesight sees through', async () => {
    assert.ok((await cast(cleric.id, await learn(cleric.id, 'mirror-image'), {})).statusCode < 300);
    assert.equal((await effect(cleric.id, 'mirror_images')).images, 3);
    const swing = async () => {
      const done = await request('POST', `${base}/rolls/check`, gm.token, {characterId: goblin.id, kind: 'attack', key: bite, targetCharacterId: cleric.id, sceneId});
      assert.equal(done.statusCode, 201, done.body);
      return (done.json().outcome.reasons ?? []) as string[];
    };
    await pg.query(`INSERT INTO character_effects(campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'truesight','{}')`, [campaignId, goblin.id]);
    assert.ok(!(await swing()).some(reason => /зеркальные отражения/.test(reason)), 'truesight ignores the images');
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code='truesight'`, [goblin.id]);
    const seen: string[] = [];
    for (let i = 0; i < 60 && await effect(cleric.id, 'mirror_images'); i++) seen.push(...(await swing()).filter(reason => /зеркальные отражения/.test(reason)));
    assert.ok(seen.some(reason => /удар в двойника/.test(reason)), JSON.stringify(seen));
    assert.ok(seen.some(reason => /разбит последний/.test(reason)), JSON.stringify(seen));
    assert.equal(await effect(cleric.id, 'mirror_images'), null, 'all three images are broken');
  });

  await t.test('«Гипнотический узор»: charmed, incapacitated, speed 0 — and damage wakes it', async () => {
    const result = await cast(mage.id, await learn(mage.id, 'hypnotic-pattern'), {targetIds: [dreamer.id]});
    assert.ok(result.statusCode < 300, result.body);
    for (const condition of ['charmed', 'incapacitated', 'stupor']) {
      const held = await effect(dreamer.id, condition);
      assert.ok(held, `${condition}: ${await codes(dreamer.id)}`);
      assert.equal(held.endsOnDamage, true, condition);
    }
    await hurt(dreamer.id, 3);
    const left = await codes(dreamer.id);
    assert.ok(!left.includes('charmed') && !left.includes('incapacitated') && !left.includes('stupor'), JSON.stringify(left));
  });

  await request('POST', `${initiative}/start`, gm.token, {});
  const turnTo = (id: string) => pg.query(
    `UPDATE initiative_entries SET is_current = (character_id = $2), action_used=false, bonus_used=false, reaction_used=false, attacks_made=0, disengaged=false, moved_feet=0, dashes=0, turn_flags='{}' WHERE scene_id=$1`,
    [sceneId, id],
  );
  const entryOf = async (id: string) => (await pg.query<any>('SELECT id FROM initiative_entries WHERE character_id=$1', [id])).rows[0].id as string;

  await t.test('«Ускорение»: +2 AC, double speed, advantage on DEX saves and one more action', async () => {
    await pg.query('UPDATE characters SET armor_class=11, speed_feet=30 WHERE id=$1', [ally.id]);
    const before = Number((await preview(goblin.id, bite, ally.id, gm.token)).hitChance);
    await turnTo(cleric.id);
    assert.ok((await cast(cleric.id, await learn(cleric.id, 'haste'), {targetIds: [ally.id]})).statusCode < 300);
    assert.ok(await effect(ally.id, 'hasted'));
    const after = Number((await preview(goblin.id, bite, ally.id, gm.token)).hitChance);
    assert.ok(Math.abs(before - after - 0.1) < 0.051, `${before} → ${after}`);
    const save = await request('POST', `${base}/rolls/check`, alice.token, {characterId: ally.id, kind: 'save', key: 'dexterity'});
    assert.ok(JSON.stringify(save.json().outcome).includes('ускорение'), JSON.stringify(save.json().outcome));

    await turnTo(ally.id);
    const speed = await reach(ally.id, alice.token);
    assert.equal(speed.budget, 60, JSON.stringify(speed));
    assert.ok(speed.reasons.some((reason: string) => /Ускорение/.test(reason)), JSON.stringify(speed.reasons));
    const swing = () => request('POST', `${base}/rolls/check`, alice.token, {characterId: ally.id, kind: 'attack', key: club, targetCharacterId: goblin.id, sceneId});
    assert.equal((await swing()).statusCode, 201, 'the Attack action');
    assert.equal((await swing()).statusCode, 201, 'the haste action: one more weapon attack');
    assert.equal((await swing()).statusCode, 400, 'nothing more');
    await turnTo(ally.id);
    const entry = await entryOf(ally.id);
    assert.equal((await request('POST', `${initiative}/${entry}/dash`, alice.token, {})).statusCode < 300, true, 'Dash as the action');
    assert.equal((await request('POST', `${initiative}/${entry}/act`, alice.token, {action: 'dodge'})).statusCode, 400, 'Dodge is not a haste action');
    assert.equal((await request('POST', `${initiative}/${entry}/dash`, alice.token, {})).statusCode < 300, true, 'Dash as the haste action');
    assert.equal((await request('POST', `${initiative}/${entry}/dash`, alice.token, {})).statusCode, 400);
  });

  await t.test('the end of «Ускорение»: a wave of lethargy — no moving and no actions', async () => {
    const focus = (await pg.query<any>(`SELECT id FROM character_effects WHERE character_id=$1 AND effect_code='concentration'`, [cleric.id])).rows[0];
    assert.equal((await request('DELETE', `${base}/characters/${cleric.id}/effects/${focus.id}`, alice.token)).statusCode, 204);
    assert.equal(await effect(ally.id, 'hasted'), null);
    const lethargy = await effect(ally.id, 'lethargic');
    assert.ok(lethargy, JSON.stringify(await codes(ally.id)));
    assert.equal(lethargy.expires.skip, 1, 'ended on its own turn — the next one too');
    await turnTo(ally.id);
    assert.equal((await reach(ally.id, alice.token)).budget, 0);
    const dash = await request('POST', `${initiative}/${await entryOf(ally.id)}/dash`, alice.token, {});
    assert.equal(dash.statusCode, 400);
    assert.match(dash.json().message, /вял после «Ускорения»/);
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code='lethargic'`, [ally.id]);
  });

  await t.test('«Гипнотический узор» in combat: speed 0 on its own turn', async () => {
    await turnTo(mage.id);
    const pattern = (await pg.query<any>(`SELECT id FROM character_spells WHERE character_id=$1 AND srd_index='hypnotic-pattern'`, [mage.id])).rows[0].id;
    assert.ok((await cast(mage.id, pattern, {targetIds: [dreamer.id]})).statusCode < 300);
    await turnTo(dreamer.id);
    const speed = await reach(dreamer.id, gm.token);
    assert.equal(speed.budget, 0, JSON.stringify(speed));
    assert.ok(speed.reasons.some((reason: string) => /Гипнотический узор/.test(reason)), JSON.stringify(speed.reasons));
  });

  await t.test('«Замедление»: −2 AC and DEX saves, half speed, action or bonus action, no reactions', async () => {
    await pg.query('UPDATE characters SET armor_class=15, speed_feet=30 WHERE id=$1', [goblin.id]);
    const before = Number((await preview(ally.id, club, goblin.id, alice.token)).hitChance);
    await turnTo(mage.id);
    const result = await cast(mage.id, await learn(mage.id, 'slow'), {targetIds: [goblin.id]});
    assert.ok(result.statusCode < 300, result.body);
    const slowed = await effect(goblin.id, 'slow_spell');
    assert.ok(slowed, JSON.stringify(await codes(goblin.id)));
    assert.deepEqual([slowed.repeatSave, slowed.save?.ability], ['end', 'wisdom']);
    const after = Number((await preview(ally.id, club, goblin.id, alice.token)).hitChance);
    assert.ok(Math.abs(after - before - 0.1) < 0.051, `${before} → ${after}`);
    const save = await request('POST', `${base}/rolls/check`, gm.token, {characterId: goblin.id, kind: 'save', key: 'dexterity'});
    assert.ok(save.json().outcome.reasons.includes('замедление: −2'), JSON.stringify(save.json().outcome));

    await turnTo(goblin.id);
    assert.equal((await reach(goblin.id, gm.token)).budget, 15);
    await pg.query(`INSERT INTO character_effects(campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'expeditious','{}')`, [campaignId, goblin.id]);
    const entry = await entryOf(goblin.id);
    assert.ok((await request('POST', `${initiative}/${entry}/dash`, gm.token, {})).statusCode < 300);
    const bonus = await request('POST', `${initiative}/${entry}/dash`, gm.token, {using: 'bonus'});
    assert.equal(bonus.statusCode, 400);
    assert.match(bonus.json().message, /замедлен: в ход — действие или бонусное действие/);
  });
});
