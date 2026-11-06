import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('obstacle kinds and one death saving throw per turn', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 100_000});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({
    method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {}),
  }));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();
  const gm = await register('gm_obstacle'), alice = await register('alice_obstacle');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Obstacles'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Коридор', widthCells: 8, heightCells: 3})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  await request('POST', `${scenePath}/walls`, gm.token, {x1: 0, z1: -1.5, x2: 0, z2: -0.5});
  await request('POST', `${scenePath}/walls`, gm.token, {x1: 0, z1: 0.5, x2: 0, z2: 1.5});

  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Герой', hpMax: 10, hpCurrent: 10})).json();
  const goblin = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 7, hpCurrent: 7})).json();
  const curtain = (await request('POST', `${base}/characters`, gm.token, {kind: 'object', name: 'Занавес'})).json();
  const heroAt = (await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: -3.5, z: 0})).json().id;
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 3.5, z: 0});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: curtain.id, x: 0.5, z: 0});

  const seen = async () => {
    const scene = (await request('GET', scenePath, alice.token)).json();
    const cells = new Set(scene.fog.visibleCells.map((cell: any) => `${cell.x}:${cell.z}`));
    return {names: scene.objects.map((o: any) => o.name).sort(), behind: cells.has('2.5:0')};
  };
  const moveHero = async (x: number) => {
    const current = (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.id === heroAt);
    return request('PUT', `${scenePath}/objects/${heroAt}`, alice.token, {
      x, y: 0, z: 0, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
    });
  };
  const setObstacle = (body: any) => request('PUT', `${base}/characters/${curtain.id}/state`, gm.token, body);

  await t.test('«sight only» (curtain, smoke): hides what is behind, but lets you walk through', async () => {
    const saved = await setObstacle({blocks: true, blockKind: 'sight'});
    assert.equal(saved.statusCode, 200, saved.body);
    const view = await seen();
    assert.ok(!view.behind && !view.names.includes('Гоблин'), 'the room behind is out of sight');
    assert.equal((await request('GET', scenePath, alice.token)).json().objects.find((o: any) => o.name === 'Занавес').state.blockKind, 'sight');
    const walked = await moveHero(2.5);
    assert.equal(walked.statusCode, 200, `walks through the curtain: ${walked.body}`);
    assert.equal((await moveHero(-3.5)).statusCode, 200);
  });

  await t.test('«movement only» (bars, glass): you see through it, but cannot pass', async () => {
    assert.equal((await setObstacle({blockKind: 'move'})).statusCode, 200);
    const view = await seen();
    assert.ok(view.behind && view.names.includes('Гоблин'), 'the goblin is in plain view');
    assert.equal((await moveHero(2.5)).statusCode, 400, 'the bars stop the hero');
  });

  await t.test('«both» is the old obstacle; bad kinds are refused', async () => {
    assert.equal((await setObstacle({blockKind: 'both'})).statusCode, 200);
    const view = await seen();
    assert.ok(!view.behind);
    assert.equal((await moveHero(2.5)).statusCode, 400);
    assert.equal((await setObstacle({blockKind: 'glass'})).statusCode, 400);
    assert.equal((await request('PUT', `${base}/characters/${curtain.id}/state`, alice.token, {blockKind: 'sight'})).statusCode, 403);
  });

  const initiative = `${scenePath}/initiative`;
  const deathRolls = async () => Number((await pg.query<any>(`SELECT count(*)::int AS n FROM roll_log WHERE character_id=$1 AND outcome->>'kind'='death'`, [hero.id])).rows[0].n);
  const dying = async () => {
    await pg.query('UPDATE characters SET hp_current=0, death_successes=0, death_failures=0 WHERE id=$1', [hero.id]);
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code IN ('stable', 'dead')`, [hero.id]);
    const down = (await pg.query(`SELECT 1 FROM character_effects WHERE character_id=$1 AND effect_code='unconscious' AND active`, [hero.id])).rows[0];
    if (!down) await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'unconscious','{"source":"hp"}'::jsonb)`, [campaignId, hero.id]);
  };
  const save = (token = alice.token) => request('POST', `${base}/characters/${hero.id}/death-save`, token, {sceneId});

  await t.test('in combat: one death save per turn, at its start; not on someone else’s turn', async () => {
    await pg.query('DELETE FROM scene_objects WHERE character_id=$1', [curtain.id]);
    const elsewhere = (await request('POST', `${base}/scenes`, gm.token, {name: 'Старый бой'})).json().id;
    await request('POST', `${base}/scenes/${elsewhere}/initiative/join`, gm.token, {characterId: hero.id});
    await pg.query(`UPDATE initiative_entries SET is_current=true, turn_flags='{death-save}' WHERE scene_id=$1`, [elsewhere]);
    await request('POST', `${base}/scenes/${elsewhere}/objects`, gm.token, {characterId: hero.id, x: 0.5, z: 0.5});
    await dying();
    for (const [id, score] of [[goblin.id, 30], [hero.id, 5]] as const) {
      const entry = (await request('POST', `${initiative}/join`, gm.token, {characterId: id})).json().id;
      await request('PATCH', `${initiative}/${entry}`, gm.token, {score});
    }
    let entries = (await request('GET', initiative, gm.token)).json().entries;
    if (!entries.find((entry: any) => entry.character_id === goblin.id).is_current) {
      await request('POST', `${initiative}/advance`, gm.token, {});
      entries = (await request('GET', initiative, gm.token)).json().entries;
    }
    assert.ok(entries.find((entry: any) => entry.character_id === goblin.id).is_current, 'the goblin goes first');
    const before = await deathRolls();
    const early = await save();
    assert.equal(early.statusCode, 400, 'not the hero’s turn');
    assert.match(early.json().message, /в начале своего хода/);

    await request('POST', `${initiative}/advance`, gm.token, {});
    assert.equal(await deathRolls(), before + 1, 'the app rolls it at the start of the hero’s turn');
    entries = (await request('GET', initiative, gm.token)).json().entries;
    assert.equal(entries.find((entry: any) => entry.character_id === hero.id).death_saved, true, 'the turn remembers it');

    await dying();
    const again = await save();
    assert.equal(again.statusCode, 400, 'a second one this turn is refused');
    assert.match(again.json().message, /уже бросил/);
    assert.equal(await deathRolls(), before + 1);

    await request('POST', `${base}/rules`, gm.token, {key: 'gm_free_move', kind: 'flag', label: 'Свободно', value: true});
    const forced = await save(gm.token);
    assert.equal(forced.statusCode, 200, forced.body);
    await request('DELETE', initiative, gm.token);
  });

  await t.test('out of combat the button rolls as before', async () => {
    await dying();
    const outside = await save();
    assert.equal(outside.statusCode, 200, outside.body);
  });
});
