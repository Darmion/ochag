import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';
import {emptyAction, emptyEffect, emptyTemplate, type Effect, type EffectKind} from '../../../../packages/domain/spells/spell-template.ts';

test('template chains and walls', async t => {
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
  const gm = await register('gm_shape'), alice = await register('alice_shape');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Формы'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Ущелье', widthCells: 30, heightCells: 10})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const effect = (kind: EffectKind, values: Record<string, unknown>): Effect => Object.assign(emptyEffect(kind), {values: {...emptyEffect(kind).values, ...values}});
  const approved = async (template: ReturnType<typeof emptyTemplate>) => {
    const made = await request('POST', `${base}/spell-templates`, gm.token, {template, submit: true});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().spell.id as string;
  };

  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Чародейка', hpMax: 40, hpCurrent: 40, level: 5, charisma: 18})).json();
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: 0.5, z: 0.5});
  await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,9,9), ($1,$2,2,9,9)`, [campaignId, hero.id]);
  const goblins: string[] = [];
  for (const [name, x] of [['Гоблин А', 4.5], ['Гоблин Б', 6.5], ['Гоблин В', 12.5]] as const) {
    const goblin = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name, disposition: 'hostile', hpMax: 50, hpCurrent: 50})).json();
    await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x, z: 0.5});
    goblins.push(goblin.id);
  }
  const learn = async (customSpellId: string) => (await request('POST', `${base}/characters/${hero.id}/spells`, gm.token, {source: 'custom', customSpellId})).json().id as string;
  const cast = (entry: string, body: any) => request('POST', `${base}/characters/${hero.id}/spells/${entry}/cast`, alice.token, {sceneId, ...body});

  await t.test('a chain hops only as far as the template allows, in the given order', async () => {
    const spark = emptyTemplate();
    spark.passport = {...spark.passport, name: 'Цепная искра', level: 1, school: 'evocation', description: 'Искра'};
    spark.casting = {...spark.casting, rangeValue: 60};
    spark.targeting = {...spark.targeting, kind: 'chain', count: 1, hops: 2, hopFeet: 10};
    const zap = emptyAction('Искра');
    zap.outcomes.always = [effect('damage', {formula: '1', damageType: 'lightning'})];
    spark.actions = [zap];
    const entry = await learn(await approved(spark));
    const near = await cast(entry, {targetIds: goblins.slice(0, 2)});
    assert.ok(near.statusCode < 300, near.body);
    assert.deepEqual(near.json().template.manual, [], 'the chain is not a manual note any more');
    const broken = await cast(entry, {targetIds: goblins});
    assert.equal(broken.statusCode, 400);
    assert.match(broken.json().message, /от «Гоблин Б» до «Гоблин В» дальше 10 фт/);
  });

  await t.test('a wall stands on the scene along the drawn line and goes with the concentration', async () => {
    const stone = emptyTemplate();
    stone.passport = {...stone.passport, name: 'Каменная преграда', level: 2, school: 'evocation', description: 'Стена'};
    stone.casting = {...stone.casting, rangeValue: 120};
    stone.duration = {...stone.duration, kind: 'minutes', value: 10, concentration: true};
    stone.targeting = {...stone.targeting, kind: 'wall', segments: 2, segmentFeet: 10};
    const raise = emptyAction('Подъём');
    raise.who = 'area';
    raise.outcomes.always = [effect('wall', {blocks: ['move', 'sight'], hp: 30})];
    stone.actions = [raise];
    const entry = await learn(await approved(stone));
    const view = (await request('GET', `${base}/characters/${hero.id}/spells`, alice.token)).json().spells.find((row: any) => row.id === entry).spell;
    assert.deepEqual([view.area.shape, view.area.sizeFeet], ['line', 20], 'the client aims a 20-foot line');
    const templateId = (await request('POST', `${scenePath}/templates`, alice.token, {shape: 'line', x: 2.2, z: -3.1, direction: 90, sizeFeet: 20, widthFeet: 5})).json().id;
    const done = await cast(entry, {templateId, slotLevel: 2});
    assert.ok(done.statusCode < 300, done.body);
    assert.deepEqual(done.json().template.manual, []);
    const walls = (await pg.query<any>('SELECT x1, z1, x2, z2, kind, hp, hp_max FROM scene_walls WHERE scene_id=$1', [sceneId])).rows;
    assert.deepEqual(walls, [{x1: 2, z1: -3, x2: 2, z2: 1, kind: 'wall', hp: 30, hp_max: 30}], 'snapped to grid nodes, 4 cells long');
    const held = (await pg.query<any>(`SELECT id FROM character_effects WHERE character_id=$1 AND effect_code='concentration' AND active`, [hero.id])).rows[0];
    assert.equal((await request('DELETE', `${base}/characters/${hero.id}/effects/${held.id}`, alice.token)).statusCode, 204);
    assert.equal((await pg.query<any>('SELECT count(*)::int AS n FROM scene_walls WHERE scene_id=$1', [sceneId])).rows[0].n, 0, 'the wall is gone');
  });
});
