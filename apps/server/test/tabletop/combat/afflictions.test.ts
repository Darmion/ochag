import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('diseases and poisons: stages, the campaign clock, damage on a failed save, cures by spell', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({
    method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {}),
  }));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_afflict'), alice = await register('alice_afflict');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Afflictions'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'action_economy','flag','Экономия действий','false'::jsonb,$2), ($1,'long_rest_daily','flag','Долгий отдых раз в сутки','false'::jsonb,$2)`, [campaignId, gm.user.id]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Болото', widthCells: 10, heightCells: 3})).json().id;
  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Тиль', level: 5, hpMax: 60, hpCurrent: 60, speedFeet: 30})).json();
  const cleric = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Аста', level: 11, hpMax: 60, hpCurrent: 60, speedFeet: 30, wisdom: 16})).json();
  await pg.query('UPDATE characters SET class_name=$2 WHERE id=$1', [cleric.id, 'Жрец']);
  const dummy = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Чучело', disposition: 'hostile', hpMax: 90, hpCurrent: 90, armorClass: 1})).json();
  const golem = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Голем', disposition: 'hostile', hpMax: 90, hpCurrent: 90, armorClass: 1})).json();
  await pg.query(`UPDATE characters SET sheet_extra = COALESCE(sheet_extra, '{}'::jsonb) || '{"conditionImmunities":"отравление"}'::jsonb WHERE id=$1`, [golem.id]);
  for (const [token, id, x] of [[alice.token, hero.id, -0.5], [gm.token, dummy.id, 0.5]] as const) {
    assert.equal((await request('POST', `${base}/scenes/${sceneId}/objects`, token, {characterId: id, x, z: 0})).statusCode, 201);
  }
  const dagger = (await request('POST', `${base}/characters/${hero.id}/weapons`, alice.token, {name: 'Кинжал', ability: 'dexterity', proficient: true, damageFormula: '1d4+@mod', damageType: 'piercing'})).json();
  const attackReasons = async () => (await request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'attack', key: dagger.id, targetCharacterId: dummy.id, sceneId})).json().outcome.reasons as string[];
  const apply = (targetId: string, conditionCode: string, extra: any = {}) => request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [targetId], code: conditionCode, ...extra});
  const effect = async (id: string, conditionCode: string) => (await pg.query<any>('SELECT id, parameters FROM character_effects WHERE character_id=$1 AND effect_code=$2 AND active', [id, conditionCode])).rows[0] ?? null;
  const rest = () => request('POST', `${base}/characters/${hero.id}/rest`, alice.token, {kind: 'long'});
  const advance = (minutes: number) => request('PUT', `${base}/time`, gm.token, {advanceMinutes: minutes});
  const learn = async (srdIndex: string, level: number) => {
    await pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,$3,2,2) ON CONFLICT DO NOTHING', [campaignId, cleric.id, level]);
    const made = await request('POST', `${base}/characters/${cleric.id}/spells`, gm.token, {source: 'srd', srdIndex});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const cast = async (spellId: string, slotLevel?: number) => {
    const done = await request('POST', `${base}/characters/${cleric.id}/spells/${spellId}/cast`, alice.token, {targetIds: [hero.id], ...(slotLevel ? {slotLevel} : {})});
    assert.equal(done.statusCode, 201, done.body);
    return done.json().targets.find((entry: any) => entry.characterId === hero.id).effects as string[];
  };

  await t.test('the SRD diseases and poisons sit next to the conditions and can be changed like them', async () => {
    const view = (await request('GET', `${base}/condition-rules`, alice.token)).json();
    assert.equal(view.rules.length, 27);
    const rot = view.rules.find((rule: any) => rule.code === 'sight_rot');
    assert.deepEqual([rot.kind, rot.standard, rot.changed, rot.stages.length], ['disease', true, false, 5]);
    const saved = (await request('PUT', `${base}/condition-rules/sight_rot`, gm.token, {clauses: rot.clauses, stages: rot.stages.slice(0, 3)})).json();
    assert.deepEqual([saved.changed, saved.stages.length], [true, 3]);
    const back = (await request('PUT', `${base}/condition-rules/sight_rot`, gm.token, {clauses: rot.clauses, stages: rot.stages})).json();
    assert.equal(back.changed, false, 'the same stages again — the SRD rule');
  });

  await t.test('sight rot: −1 to attacks, a long rest worsens it, the GM moves the stage, the last one blinds; lesser restoration cures it', async () => {
    assert.equal((await apply(hero.id, 'sight_rot')).json().results[0].applied, true);
    assert.ok((await attackReasons()).some(reason => reason.startsWith('Глазная гниль −1')), 'the stage penalty joins the roll');
    const rested = await rest();
    assert.equal(rested.statusCode, 200, rested.body);
    assert.match(rested.json().summary, /«Глазная гниль»: стадия 2/);
    const sick = await effect(hero.id, 'sight_rot');
    assert.equal(sick.parameters.stage, 1);
    assert.equal((await request('PUT', `${base}/characters/${hero.id}/effects/${sick.id}/stage`, alice.token, {stage: 4})).statusCode, 403, 'the GM moves stages');
    const moved = await request('PUT', `${base}/characters/${hero.id}/effects/${sick.id}/stage`, gm.token, {stage: 4});
    assert.deepEqual(moved.json(), {stage: 4, name: 'слепота'});
    const reasons = await attackReasons();
    assert.ok(reasons.includes('помеха: ослеплён'), reasons.join('; '));
    assert.ok(reasons.some(reason => reason.startsWith('Глазная гниль −5')), reasons.join('; '));
    assert.deepEqual(await cast(await learn('lesser-restoration', 2)), ['снято: Глазная гниль'], 'blindness that comes from the disease ends with it');
    assert.equal(await effect(hero.id, 'sight_rot'), null);
  });

  await t.test('a poison that brings «poisoned» along: immunity to poisoned keeps it off, it runs out by the clock, protection from poison ends it early', async () => {
    const immune = (await apply(golem.id, 'malice')).json().results[0];
    assert.deepEqual([immune.applied, /отравлен/.test(immune.immune)], [false, true]);
    await apply(hero.id, 'malice');
    const now = Number((await pg.query<any>('SELECT world_minutes FROM campaigns WHERE id=$1', [campaignId])).rows[0].world_minutes);
    assert.equal((await effect(hero.id, 'malice')).parameters.untilMinute, now + 60);
    assert.equal((await advance(30)).statusCode, 200);
    assert.ok(await effect(hero.id, 'malice'), 'half an hour is not enough');
    await advance(31);
    assert.equal(await effect(hero.id, 'malice'), null, 'an hour later it is gone');
    await apply(hero.id, 'malice');
    assert.ok((await cast(await learn('protection-from-poison', 2))).includes('яд снят: Злоба'));
    assert.equal(await effect(hero.id, 'malice'), null);
  });

  await t.test('pale tincture: a daily save by the campaign clock, poison damage on a failure, wins count up', async () => {
    await apply(hero.id, 'pale_tincture');
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code='spell_mod'`, [hero.id]);
    await pg.query('UPDATE characters SET constitution=1, hp_current=60 WHERE id=$1', [hero.id]);
    const day = await advance(1440);
    assert.equal(day.statusCode, 200, day.body);
    const hp = Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [hero.id])).rows[0].hp_current);
    assert.ok(hp >= 54 && hp <= 59, `1d6 poison damage, got ${60 - hp}`);
    const thrown = (await request('GET', `${base}/rolls`, gm.token)).json().rolls.find((roll: any) => roll.label.includes('против «Бледная настойка»'));
    assert.deepEqual([thrown.outcome.dc, thrown.outcome.success], [16, false]);
    const rule = (await request('GET', `${base}/condition-rules`, gm.token)).json().rules.find((entry: any) => entry.code === 'pale_tincture');
    const easier = rule.clauses.map((entry: any) => (entry.kind === 'repeat-save' ? {...entry, values: {...entry.values, dc: '8'}} : entry));
    assert.equal((await request('PUT', `${base}/condition-rules/pale_tincture`, gm.token, {clauses: easier})).statusCode, 200);
    await pg.query('UPDATE characters SET constitution=30 WHERE id=$1', [hero.id]);
    await advance(1440);
    assert.equal((await effect(hero.id, 'pale_tincture')).parameters.saveWins, 1, 'the GM’s easier DC holds for the daily course too');
  });

  await t.test('heal ends every disease, remove curse every curse; a custom curse is cured by its kind', async () => {
    await apply(hero.id, 'sewer_plague');
    const curse = (await request('POST', `${base}/condition-rules`, gm.token, {name: 'Метка ведьмы', kind: 'curse', icon: 'skull', clauses: [{kind: 'roll-bonus', values: {rolls: 'saves', value: '-2'}}]})).json();
    await apply(hero.id, curse.code);
    await pg.query('UPDATE characters SET hp_current=10 WHERE id=$1', [hero.id]);
    const healed = await cast(await learn('heal', 6), 6);
    assert.ok(healed.includes('снято: Сточная чума'), healed.join('; '));
    assert.equal(await effect(hero.id, 'sewer_plague'), null);
    assert.equal(Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [hero.id])).rows[0].hp_current), 60, '70 hit points');
    assert.ok(await effect(hero.id, curse.code), 'heal does not lift curses');
    assert.deepEqual(await cast(await learn('remove-curse', 3)), ['снято: Метка ведьмы']);
    assert.equal(await effect(hero.id, curse.code), null);
  });
});
