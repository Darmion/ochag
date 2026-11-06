import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('one creature per cell', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db);
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

  const gm = await register('gm_cell'), alice = await register('alice_cell');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Cells'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Коридор', widthCells: 10, heightCells: 1})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const characters = `/campaigns/${campaignId}/characters`;

  const hero = (await request('POST', characters, alice.token, {kind: 'character', name: 'Герой'})).json();
  const goblin = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile'})).json();
  const crate = (await request('POST', characters, gm.token, {kind: 'object', name: 'Ящик'})).json();
  const place = async (token: string, characterId: string, x: number) =>
    (await request('POST', `${scenePath}/objects`, token, {characterId, x, z: 0})).json().id as string;
  const position = async (placementId: string) =>
    (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.id === placementId);
  const moveTo = async (token: string, placementId: string, x: number) => {
    const current = await position(placementId);
    return request('PUT', `${scenePath}/objects/${placementId}`, token, {
      x, y: 0, z: 0, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
    });
  };

  const heroAt = await place(alice.token, hero.id, -1.5);
  let goblinAt = '';

  await t.test('a creature put onto an occupied cell stands next to it; an item may share the cell', async () => {
    goblinAt = await place(gm.token, goblin.id, -1.5);
    const placed = await position(goblinAt);
    assert.equal(Math.abs(placed.x - -1.5), 1, `the goblin stands in a neighbouring cell, not at ${placed.x}`);
    const crateAt = await place(gm.token, crate.id, -1.5);
    assert.equal((await position(crateAt)).x, -1.5, 'items are not creatures');
    await moveTo(gm.token, goblinAt, 2.5);
  });

  await t.test('nobody — not even the GM — ends a move in another creature’s cell', async () => {
    const blocked = await moveTo(alice.token, heroAt, 2.5);
    assert.equal(blocked.statusCode, 400);
    assert.match(blocked.json().message, /Клетка занята/);
    assert.equal((await moveTo(gm.token, goblinAt, -1.5)).statusCode, 400);
    const through = await moveTo(alice.token, heroAt, 3.5);
    assert.equal(through.statusCode, 400, 'not through the hostile goblin');
    assert.match(through.json().message, /Сквозь врага не пройти/);
    await pg.query(`UPDATE characters SET disposition='friendly' WHERE id=$1`, [goblin.id]);
    assert.equal((await moveTo(alice.token, heroAt, 3.5)).statusCode, 200, 'through a friendly one is fine');
    await moveTo(alice.token, heroAt, 0.5);
    await pg.query(`UPDATE characters SET disposition='hostile' WHERE id=$1`, [goblin.id]);
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'hostile_blocks','flag','Сквозь врагов','false'::jsonb,$2)`, [campaignId, gm.user.id]);
    assert.equal((await moveTo(alice.token, heroAt, 3.5)).statusCode, 200, 'the flag off — through the goblin as before');
    assert.equal((await moveTo(alice.token, heroAt, -1.5)).statusCode, 200, 'the crate cell is fine');
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='hostile_blocks'`, [campaignId]);
  });

  await t.test('a creature hidden by the GM or a dead one does not hold the cell', async () => {
    await pg.query('UPDATE scene_objects SET hidden=true WHERE id=$1', [goblinAt]);
    assert.equal((await moveTo(alice.token, heroAt, 2.5)).statusCode, 200);
    await moveTo(alice.token, heroAt, -1.5);
    await pg.query('UPDATE scene_objects SET hidden=false WHERE id=$1', [goblinAt]);
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code) VALUES ($1,$2,'dead')`, [campaignId, goblin.id]);
    assert.equal((await moveTo(alice.token, heroAt, 2.5)).statusCode, 200, 'a body lies there — you may stand on it');
    await moveTo(alice.token, heroAt, -1.5);
    await pg.query(`UPDATE character_effects SET active=false WHERE character_id=$1`, [goblin.id]);
  });

  await t.test('out of combat dragging has no reach filter at all (second complaint list, item 1)', async () => {
    const reach = (await request('GET', `${scenePath}/objects/${heroAt}/reach?mode=drag`, alice.token)).json();
    assert.deepEqual([reach.limited, reach.cells], [false, []]);
    assert.equal((await request('GET', `${scenePath}/objects/${heroAt}/reach`, alice.token)).json().limited, false, 'without mode=drag — only in combat');
    assert.equal((await request('GET', `${scenePath}/objects/${heroAt}/reach?mode=x`, alice.token)).statusCode, 400);
  });

  await t.test('the campaign flag one_per_cell = false switches the rule off', async () => {
    assert.equal((await moveTo(alice.token, heroAt, 2.5)).statusCode, 400);
    await pg.query(
      `INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'one_per_cell','flag','Одно существо на клетку','false'::jsonb,$2)`,
      [campaignId, gm.user.id],
    );
    assert.equal((await moveTo(alice.token, heroAt, 2.5)).statusCode, 200);
  });
});
