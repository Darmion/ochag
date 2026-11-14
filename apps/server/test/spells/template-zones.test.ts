import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';
import {emptyAction, emptyEffect, emptyTemplate, type Effect, type EffectKind} from '../../../../packages/domain/spells/spell-template.ts';

test('template zones: every inner action, once a turn on entering, at the end of a turn, and difficult ground', async t => {
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
  const gm = await register('gm_zone'), alice = await register('alice_zone');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Зоны'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Чаща', widthCells: 20, heightCells: 4})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const effect = (kind: EffectKind, values: Record<string, unknown>): Effect => Object.assign(emptyEffect(kind), {values: {...emptyEffect(kind).values, ...values}});

  const thorns = emptyTemplate();
  thorns.passport = {...thorns.passport, name: 'Колючая поросль', level: 2, school: 'transmutation', description: 'Колючки'};
  thorns.casting = {...thorns.casting, rangeValue: 150};
  thorns.duration = {...thorns.duration, kind: 'minutes', value: 10, concentration: true};
  thorns.targeting = {...thorns.targeting, kind: 'area', shape: 'sphere', sizeFeet: 10, origin: 'point'};
  const prick = emptyAction('Шипы');
  prick.when = 'zone-enter';
  prick.who = 'entering';
  prick.outcomes.always = [effect('damage', {formula: '1', damageType: 'piercing'})];
  const snag = emptyAction('Цепкие корни');
  snag.when = 'zone-end';
  snag.who = 'entering';
  snag.check = {...snag.check, kind: 'save', ability: 'dexterity'};
  snag.outcomes.fail = [effect('condition', {code: 'prone', duration: 'spell'})];
  const holder = emptyAction('Поросль');
  holder.who = 'area';
  holder.outcomes.always = [effect('zone', {difficult: true}), ];
  holder.outcomes.always[0]!.actions = [prick, snag];
  thorns.actions = [holder];
  thorns.commands = [{id: 'shift', name: 'Сдвинуть поросль', cost: 'bonus', when: 'always', does: 'move-zone', feet: 30, actionId: '', limit: 'none', limitCount: 1}];

  const made = await request('POST', `${base}/spell-templates`, gm.token, {template: thorns, submit: true});
  assert.equal(made.statusCode, 201, made.body);
  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Друид', hpMax: 40, hpCurrent: 40, level: 5, wisdom: 18})).json();
  const goblin = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 100, hpCurrent: 100, dexterity: 1})).json();
  const heroAt = (await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: -9.5, z: 0.5})).json().id;
  const goblinAt = (await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 8.5, z: 0.5})).json().id;
  await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,2,9,9)`, [campaignId, hero.id]);
  await pg.query('UPDATE characters SET spell_save_dc_override=30 WHERE id=$1', [hero.id]);
  const entry = (await request('POST', `${base}/characters/${hero.id}/spells`, gm.token, {source: 'custom', customSpellId: made.json().spell.id})).json().id;
  const hp = async () => Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [goblin.id])).rows[0].hp_current);
  const move = async (placementId: string, x: number, token: string) => {
    const current = (await request('GET', scenePath, gm.token)).json().objects.find((object: any) => object.id === placementId);
    return request('PUT', `${scenePath}/objects/${placementId}`, token, {x, y: 0, z: 0.5, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision});
  };

  await t.test('the cast leaves one zone holding both inner actions; nothing goes to the GM', async () => {
    const templateId = (await request('POST', `${scenePath}/templates`, alice.token, {shape: 'circle', x: 0, z: 0, sizeFeet: 10})).json().id;
    const cast = await request('POST', `${base}/characters/${hero.id}/spells/${entry}/cast`, alice.token, {sceneId, templateId, slotLevel: 2});
    assert.ok(cast.statusCode < 300, cast.body);
    assert.deepEqual(cast.json().template.manual, [], JSON.stringify(cast.json().template.manual));
    assert.equal(cast.json().areaKept, true, 'the aimed area stays as the zone is drawn, the client must not clear it');
    const zone = (await pg.query<any>('SELECT spell, on_turn FROM scene_triggers WHERE scene_id=$1', [sceneId])).rows[0];
    assert.deepEqual(zone.spell.actions.map((action: any) => action.when), ['zone-enter', 'zone-end']);
    assert.equal(zone.spell.difficult, true);
    assert.equal(zone.on_turn, false, 'nothing at the start of a turn');
  });

  await t.test('the thorns are difficult ground for a drag route', async () => {
    const drag = (await request('GET', `${scenePath}/objects/${heroAt}/reach?mode=drag`, alice.token)).json();
    const cost = (col: number) => drag.costs.find((entry: number[]) => entry[0] === col && entry[1] === 2)?.[2];
    assert.equal(cost(6), 35 - 5, 'six steps up to the edge of the thorns');
    assert.ok(cost(11) - cost(6) > 25, `the thorns cost double: ${cost(6)} → ${cost(11)}`);
  });

  await t.test('stepping in hurts; in combat only once a turn; ending the turn inside — a save or prone', async () => {
    let before = await hp();
    assert.equal((await move(goblinAt, 0.5, gm.token)).statusCode, 200);
    assert.equal(await hp(), before - 1, 'out of combat each entry hurts');
    await move(goblinAt, 8.5, gm.token);

    const initiative = `${scenePath}/initiative`;
    const theirs = (await request('POST', `${initiative}/join`, gm.token, {characterId: goblin.id})).json().id;
    const mine = (await request('POST', `${initiative}/join`, alice.token, {characterId: hero.id})).json().id;
    await request('PATCH', `${initiative}/${theirs}`, gm.token, {score: 20});
    await request('PATCH', `${initiative}/${mine}`, gm.token, {score: 5});
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'gm_free_move','flag','Свободно','true'::jsonb,$2)`, [campaignId, gm.user.id]);
    await request('POST', `${initiative}/advance`, gm.token, {});
    before = await hp();
    await move(goblinAt, 0.5, gm.token);
    await move(goblinAt, 4.5, gm.token);
    await move(goblinAt, 0.5, gm.token);
    assert.equal(await hp(), before - 1, 'twice in, hurt once this turn');
    await request('POST', `${initiative}/advance`, gm.token, {});
    const prone = (await pg.query<any>(`SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code='prone' AND active`, [goblin.id])).rows;
    assert.equal(prone.length, 1, 'ended its turn in the roots and failed the save');
    const rolls = (await request('GET', `${base}/rolls`, gm.token)).json().rolls;
    assert.ok(rolls.some((roll: any) => /Цепкие корни — Гоблин/.test(roll.label)), JSON.stringify(rolls.slice(0, 4).map((roll: any) => roll.label)));
  });

  await t.test('a command moves the zone and its drawn area together, not farther than allowed', async () => {
    const listed = (await request('GET', `${base}/characters/${hero.id}/spell-commands?sceneId=${sceneId}`, alice.token)).json().spells;
    const effectId = listed[0].effectId;
    const shift = (x: number) => request('POST', `${base}/characters/${hero.id}/spell-commands/${effectId}`, alice.token, {commandId: 'shift', sceneId, place: {x, z: 0}});
    assert.match((await shift(9)).json().message, /не дальше 30 фт/);
    const moved = await shift(-5);
    assert.equal(moved.statusCode, 200, moved.body);
    const zone = (await pg.query<any>('SELECT x FROM scene_triggers WHERE scene_id=$1', [sceneId])).rows[0];
    const drawn = (await pg.query<any>('SELECT x FROM scene_templates WHERE scene_id=$1', [sceneId])).rows[0];
    assert.deepEqual([zone.x, drawn.x], [-5, -5]);
  });

  await t.test('the zone goes with the concentration', async () => {
    await pg.query('DELETE FROM initiative_entries WHERE scene_id=$1', [sceneId]);
    const held = (await pg.query<any>(`SELECT id FROM character_effects WHERE character_id=$1 AND effect_code='concentration' AND active`, [hero.id])).rows[0];
    assert.equal((await request('DELETE', `${base}/characters/${hero.id}/effects/${held.id}`, alice.token)).statusCode, 204);
    assert.equal((await pg.query<any>('SELECT count(*)::int AS n FROM scene_triggers WHERE scene_id=$1', [sceneId])).rows[0].n, 0);
    assert.equal((await pg.query<any>('SELECT count(*)::int AS n FROM scene_templates WHERE scene_id=$1', [sceneId])).rows[0].n, 0, 'the drawn area goes too');
    const drag = (await request('GET', `${scenePath}/objects/${heroAt}/reach?mode=drag`, alice.token)).json();
    const cost = (col: number) => drag.costs.find((entry: number[]) => entry[0] === col && entry[1] === 2)?.[2];
    assert.equal(cost(11), 55, 'plain ground again');
  });
});
