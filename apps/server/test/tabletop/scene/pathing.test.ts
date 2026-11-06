import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

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
    assert.equal((await move(0.5, -0.5)).statusCode, 200, 'the straight line crosses the wall, the way round is free');
    assert.equal((await move(-0.5, -0.5)).statusCode, 200);
  });

  const initiative = `${scenePath}/initiative`;
  let heroEntry = '';
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
