import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('a closed door blocks sight and passage', async t => {
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

  const gm = await register('gm_block'), alice = await register('alice_block');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Block'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Коридор', widthCells: 8, heightCells: 3})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const characters = `/campaigns/${campaignId}/characters`;

  await request('POST', `${scenePath}/walls`, gm.token, {x1: 0, z1: -1.5, x2: 0, z2: -0.5});
  await request('POST', `${scenePath}/walls`, gm.token, {x1: 0, z1: 0.5, x2: 0, z2: 1.5});

  const hero = (await request('POST', characters, alice.token, {kind: 'character', name: 'Герой'})).json();
  const goblin = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile'})).json();
  const door = (await request('POST', characters, gm.token, {kind: 'object', name: 'Дверь'})).json();
  const heroPlacement = (await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: -3.5, z: 0})).json().id;
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 3.5, z: 0});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: door.id, x: 0.5, z: 0});
  const saved = await request('PUT', `${characters}/${door.id}/state`, gm.token, {openable: true, blocks: true});
  assert.equal(saved.statusCode, 200, saved.body);

  const seen = async () => {
    const scene = (await request('GET', scenePath, alice.token)).json();
    const cells = new Set(scene.fog.visibleCells.map((cell: any) => `${cell.x}:${cell.z}`));
    return {names: scene.objects.map((o: any) => o.name).sort(), cells, hero: scene.objects.find((o: any) => o.name === 'Герой')};
  };
  const move = async (x: number, z: number, token = alice.token) => {
    const current = (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.id === heroPlacement);
    return request('PUT', `${scenePath}/objects/${heroPlacement}`, token, {
      x, y: 0, z, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
    });
  };

  await t.test('the closed door hides the room behind it, but is itself in sight', async () => {
    const {names, cells} = await seen();
    assert.deepEqual(names, ['Герой', 'Дверь']);
    assert.ok(cells.has('0.5:0'), 'the door cell is visible from the corridor');
    assert.ok(!cells.has('1.5:0') && !cells.has('3.5:0'), 'behind the door is dark');
    assert.equal((await request('GET', scenePath, alice.token)).json().objects.find((o: any) => o.name === 'Дверь').state.blocks, true);
  });

  await t.test('the hero cannot walk through the closed door; the GM — only with «Свободно»', async () => {
    const through = await move(2.5, 0);
    assert.equal(through.statusCode, 400);
    assert.match(through.json().message, /стена|преграда/);
    assert.equal((await move(0.5, 0)).statusCode, 400, 'not into the door either');
    assert.equal((await move(-1.5, 0)).statusCode, 200, 'up to it is fine');
    assert.equal((await move(2.5, 0, gm.token)).statusCode, 400, 'the GM obeys doors too');
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'gm_free_move','flag','Свободно','true'::jsonb,$2)`, [campaignId, gm.user.id]);
    assert.equal((await move(2.5, 0, gm.token)).statusCode, 200, '«Свободно» — anywhere');
    assert.equal((await move(-1.5, 0, gm.token)).statusCode, 200);
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='gm_free_move'`, [campaignId]);
  });

  await t.test('an open door lets both sight and the hero through', async () => {
    assert.equal((await request('POST', `${characters}/${door.id}/interact`, alice.token, {action: 'open'})).json().outcome, 'opened');
    const {names} = await seen();
    assert.deepEqual(names, ['Герой', 'Гоблин', 'Дверь']);
    assert.equal((await move(2.5, 0)).statusCode, 200);
  });

  await t.test('a wall still stops the hero where there is no door — the open door is the way round', async () => {
    assert.equal((await move(2.5, 1)).statusCode, 200, 'step aside on the far side');
    assert.equal((await move(-1.5, 1)).statusCode, 200, 'round the wall through the open door');
    assert.equal((await move(2.5, 1)).statusCode, 200);
    assert.equal((await request('POST', `${characters}/${door.id}/interact`, alice.token, {action: 'close'})).json().outcome, 'closed');
    const back = await move(-1.5, 1);
    assert.equal(back.statusCode, 400, 'door shut — no way round');
    assert.match(back.json().message, /в обход не пройти/);
  });
});
