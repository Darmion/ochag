import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';
import {walkRoute} from '../../../src/tabletop/scene/movement/paths.ts';

test('paths go round walls; fear only bites while its source is in sight', async t => {
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
  const gm = await register('gm_path'), alice = await register('alice_path');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Path'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Угол', widthCells: 10, heightCells: 10})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  await request('POST', `${scenePath}/walls`, gm.token, {x1: 0, z1: -5, x2: 0, z2: 2});

  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Лира', speedFeet: 40})).json();
  const orc = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Орк', disposition: 'hostile', hpMax: 15, hpCurrent: 15, speedFeet: 30})).json();
  await request('POST', `${base}/characters/${orc.id}/weapons`, gm.token, {name: 'Секира', ability: 'strength', damageFormula: '1d12'});
  const heroAt = (await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: -0.5, z: -0.5})).json().id;
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: orc.id, x: 4.5, z: -4.5});
  const place = async (characterId: string) => (await request('GET', scenePath, gm.token)).json().objects.find((object: any) => object.character_id === characterId);
  const move = async (x: number, z: number) => {
    const current = await place(hero.id);
    return request('PUT', `${scenePath}/objects/${current.id}`, alice.token, {
      x, y: 0, z, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
    });
  };

  await t.test('out of combat: one move round the end of the wall is allowed', async () => {
    const drag = (await request('GET', `${scenePath}/objects/${heroAt}/reach?mode=drag`, alice.token)).json();
    assert.deepEqual([drag.limited, drag.cells], [false, []], 'no reach filter out of combat');
    const behind = drag.costs.find((cost: number[]) => cost[0] === 5 && cost[1] === 4);
    assert.ok(behind && behind[2] > 5, `but a drag shows the way round: ${JSON.stringify(behind)}`);
    assert.ok(drag.trail.some((step: number[]) => step[0] === 5 && step[1] === 4), 'with a trail to draw it');

    assert.equal((await move(0.5, -0.5)).statusCode, 200, 'the straight line crosses the wall, the way round is free');
    const walk = (await place(hero.id)).walk as Array<[number, number]>;
    assert.ok(walk && walk.length >= 3, `the figure walks round, not through: ${JSON.stringify(walk)}`);
    assert.deepEqual([walk[0], walk[walk.length - 1]], [[-0.5, -0.5], [0.5, -0.5]]);
    for (let index = 1; index < walk.length; index += 1) {
      const [ax, az] = walk[index - 1]!, [bx, bz] = walk[index]!;
      if (Math.sign(ax) === Math.sign(bx) || ax === bx) continue;
      const crossZ = az + (bz - az) * (0 - ax) / (bx - ax);
      assert.ok(crossZ >= 2, `the route crosses x=0 only past the wall end, at z=${crossZ}`);
    }
    const current = await place(hero.id);
    await request('PUT', `${scenePath}/objects/${current.id}`, alice.token, {
      x: 0.5, y: 0, z: -0.5, rotationY: 90, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
    });
    assert.equal((await place(hero.id)).walk, undefined, 'a turn on the spot is not a walk');
    assert.equal((await move(-0.5, -0.5)).statusCode, 200);
  });

  await t.test('under fog of war a drag route stays inside what the player has explored', async () => {
    await pg.query('UPDATE campaigns SET fog_enabled=true WHERE id=$1', [campaignId]);
    await pg.query('DELETE FROM scene_fog_state WHERE scene_id=$1', [sceneId]);
    const blind = (await request('GET', `${scenePath}/objects/${heroAt}/reach?mode=drag`, alice.token)).json();
    assert.deepEqual([blind.trail, blind.costs], [[], []], 'nothing explored yet — no route through the unknown');
    await request('GET', scenePath, alice.token);
    const explored = new Set<number>((await pg.query<{explored_cells: number[]}>('SELECT explored_cells FROM scene_fog_state WHERE scene_id=$1', [sceneId])).rows[0]!.explored_cells);
    const seen = (await request('GET', `${scenePath}/objects/${heroAt}/reach?mode=drag`, alice.token)).json();
    assert.ok(seen.trail.length > 0, 'what she sees is open to a drag');
    assert.ok(seen.trail.every((step: number[]) => explored.has(step[1]! * 10 + step[0]!)), 'and nothing beyond it');
    assert.ok((await request('GET', `${scenePath}/objects/${heroAt}/reach?mode=drag`, gm.token)).json().trail.length >= seen.trail.length, 'the GM sees every way');
    await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  });

  await t.test('a walk bends round a friend when that costs nothing extra', () => {
    const grid = {widthCells: 7, heightCells: 3, size: 1, rule: 'phb' as const, edges: [], walls: []};
    assert.equal(walkRoute(grid, {x: -3, z: 0}, {x: 3, z: 0}), null, 'an open line needs no route');
    const route = walkRoute(grid, {x: -3, z: 0}, {x: 3, z: 0}, new Set(['3:1']));
    assert.ok(route && route.length >= 3, `round the friend: ${JSON.stringify(route)}`);
    for (let index = 1; index < route.length; index += 1) {
      const a = route[index - 1]!, b = route[index]!;
      if (a.x > 0 || b.x < 0 || a.x === b.x) continue;
      const atZero = a.z + (b.z - a.z) * (0 - a.x) / (b.x - a.x);
      assert.ok(Math.abs(atZero) >= 0.5, `not through the friend's cell: z=${atZero}`);
    }
  });

  const initiative = `${scenePath}/initiative`;
  let heroEntry = '';
  await t.test('a walk does not clip the free end of a wall when a way round costs the same', () => {
    const wall = {x1: -3, z1: -2, x2: -3, z2: 1};
    const grid = {widthCells: 12, heightCells: 4, size: 1, rule: 'phb' as const, edges: [wall], walls: [wall]};
    const route = walkRoute(grid, {x: -4.5, z: 0.5}, {x: -1.5, z: 0.5});
    assert.ok(route && route.length >= 3, `round the wall: ${JSON.stringify(route)}`);
    const tip = {x: -3, z: 1};
    for (let index = 1; index < route.length; index += 1) {
      const a = route[index - 1]!, b = route[index]!;
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((tip.x - a.x) * dx + (tip.z - a.z) * dz) / (dx * dx + dz * dz)));
      const gap = Math.hypot(a.x + dx * t - tip.x, a.z + dz * t - tip.z);
      assert.ok(gap >= 0.3, `segment ${JSON.stringify([a, b])} passes ${gap.toFixed(2)} from the wall end`);
    }
  });

  await t.test('in combat the way round costs what the way round costs', async () => {
    heroEntry = (await request('POST', `${initiative}/join`, alice.token, {characterId: hero.id})).json().id;
    const orcEntry = (await request('POST', `${initiative}/join`, gm.token, {characterId: orc.id})).json().id;
    await request('PATCH', `${initiative}/${heroEntry}`, gm.token, {score: 20});
    await request('PATCH', `${initiative}/${orcEntry}`, gm.token, {score: 5});
    await request('POST', `${initiative}/advance`, gm.token, {});
    const reach = (await request('GET', `${scenePath}/objects/${heroAt}/reach`, alice.token)).json();
    assert.ok(reach.cells.some((cell: number[]) => cell[0] === 5 && cell[1] === 4), 'the cell behind the wall is lit');
    assert.ok(!reach.cells.some((cell: number[]) => cell[0] === 5 && cell[1] === 0), 'far up behind the wall is beyond 40 feet round');
    const behind = reach.costs.find((cost: number[]) => cost[0] === 5 && cost[1] === 4);
    assert.ok(behind && behind[2] > 5, `the price round the wall, not 5 feet: ${JSON.stringify(behind)}`);
    assert.deepEqual(reach.costs.find((cost: number[]) => cost[0] === 4 && cost[1] === 5), [4, 5, 5], 'one step down — 5 feet');
    const trail = new Map<string, number[]>(reach.trail.map((step: number[]) => [`${step[0]}:${step[1]}`, [step[2], step[3]]]));
    const way: string[] = ['5:4'];
    while (way.length < 20 && way[way.length - 1] !== '4:4') way.push(trail.get(way[way.length - 1]!)!.join(':'));
    assert.equal(way[way.length - 1], '4:4', `the trail leads back to her: ${way.join(' ← ')}`);
    assert.ok(way.some(cell => Number(cell.split(':')[1]) >= 7), 'and it goes round the wall end');

    assert.equal((await move(0.5, -0.5)).statusCode, 200);
    const moved = (await request('GET', initiative, gm.token)).json().entries.find((e: any) => e.id === heroEntry).moved_feet;
    assert.equal(moved, 30, 'round the wall, not 5 feet through it');
  });

  await t.test('the orc walks round the wall to reach her', async () => {
    await pg.query('UPDATE scene_objects SET x=-2.5, z=-2.5 WHERE character_id=$1', [hero.id]);
    await request('POST', `${initiative}/advance`, gm.token, {});
    const auto = await request('POST', `${initiative}/auto`, gm.token, {advance: false});
    assert.equal(auto.statusCode, 200, auto.body);
    const orcNow = await place(orc.id);
    assert.ok(orcNow.z >= 1.5, `heads for the end of the wall: ${orcNow.x}, ${orcNow.z}`);
    await pg.query('UPDATE initiative_entries SET moved_feet=0, moved_diagonals=0, action_used=false WHERE scene_id=$1', [sceneId]);
    await request('POST', `${initiative}/auto`, gm.token, {advance: false});
    const after = await place(orc.id);
    if (Math.sign(after.x) !== Math.sign(orcNow.x)) {
      assert.ok(after.walk?.length >= 3, `round the wall end the auto-turn walk is a route: ${JSON.stringify([orcNow.x, orcNow.z, after.walk])}`);
    }
    assert.ok(after.x < 0, `round the wall to her side: ${after.x}, ${after.z}`);
  });

  await t.test('frightened: disadvantage only while the source of fear is in sight', async () => {
    await pg.query('DELETE FROM initiative_entries WHERE scene_id=$1', [sceneId]);
    await pg.query('UPDATE scene_objects SET x=-2.5, z=-2.5 WHERE character_id=$1', [hero.id]);
    await pg.query('UPDATE scene_objects SET x=-2.5, z=0.5 WHERE character_id=$1', [orc.id]);
    assert.equal((await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [hero.id], code: 'frightened', sourceCharacterId: orc.id})).statusCode, 200);
    const check = () => request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'skill', key: 'athletics'});
    const seen = await check();
    assert.equal(seen.statusCode, 201, seen.body);
    assert.equal(seen.json().outcome.advantage, 'disadv', 'the orc is right there');
    await pg.query('UPDATE scene_objects SET x=2.5, z=-2.5 WHERE character_id=$1', [orc.id]);
    assert.equal((await check()).json().outcome.advantage, 'none', 'behind the wall — no disadvantage');
    await pg.query(`UPDATE character_effects SET parameters='{}'::jsonb WHERE character_id=$1 AND effect_code='frightened'`, [hero.id]);
    assert.equal((await check()).json().outcome.advantage, 'disadv', 'unknown source — always');
  });
});
