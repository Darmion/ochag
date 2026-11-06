import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('group turns', async t => {
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
  const gm = await register('gm_group'), alice = await register('alice_group'), bob = await register('bob_group');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Group'})).json().id;
  for (const player of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', player.token, {code});
  }
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Поляна', widthCells: 12, heightCells: 12})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const initiative = `${scenePath}/initiative`;
  const creature = async (token: string, fields: any) => (await request('POST', `${base}/characters`, token, {hpMax: 20, hpCurrent: 20, speedFeet: 30, ...fields})).json();
  const lira = await creature(alice.token, {kind: 'character', name: 'Лира'});
  const bran = await creature(bob.token, {kind: 'character', name: 'Бран'});
  const goblin = await creature(gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile'});
  const wolf = await creature(gm.token, {kind: 'npc', name: 'Волк', disposition: 'hostile'});
  const placements: Record<string, string> = {};
  for (const [entry, x, token] of [[lira, -3.5, alice.token], [bran, -2.5, bob.token], [goblin, 3.5, gm.token], [wolf, 4.5, gm.token]] as const) {
    placements[entry.id] = (await request('POST', `${scenePath}/objects`, token, {characterId: entry.id, x, z: 0.5})).json().id;
  }
  const move = async (id: string, x: number, token: string) => {
    const place = (await request('GET', scenePath, gm.token)).json().objects.find((object: any) => object.id === placements[id]);
    return request('PUT', `${scenePath}/objects/${place.id}`, token, {
      x, y: place.y, z: 0.5, rotationY: place.rotation_y, scale: place.scale, snapToGrid: place.snap_to_grid,
      parentObjectId: null, animationName: place.animation_name, revision: place.revision,
    });
  };
  const current = async () => (await request('GET', initiative, gm.token)).json().entries.filter((entry: any) => entry.is_current).map((entry: any) => entry.name).sort();
  const entryOf = async (id: string) => (await request('GET', initiative, gm.token)).json().entries.find((entry: any) => entry.character_id === id);

  for (const [entry, token] of [[lira, alice.token], [bran, bob.token], [goblin, gm.token], [wolf, gm.token]] as const) {
    assert.equal((await request('POST', `${initiative}/join`, token, {characterId: entry.id})).statusCode, 201);
  }
  for (const [entry, score] of [[lira, 20], [bran, 15], [goblin, 10], [wolf, 5]] as const) {
    await pg.query('UPDATE initiative_entries SET score=$2 WHERE character_id=$1', [entry.id, score]);
  }
  await request('POST', `${initiative}/start`, gm.token, {});

  await t.test('allies in a row move at the same time; the enemy waits', async () => {
    assert.deepEqual(await current(), ['Бран', 'Лира']);
    assert.equal((await move(lira.id, -1.5, alice.token)).statusCode, 200);
    assert.equal((await move(bran.id, -0.5, bob.token)).statusCode, 200, 'Бран moves in parallel');
    const out = await move(goblin.id, 2.5, gm.token);
    assert.equal(out.statusCode, 400, 'the GM cannot move the goblin out of its turn');
    assert.match(out.json().message, /двигаться можно в свой ход/);
  });

  await t.test('one player ending the turn does not pass it; the last one does', async () => {
    assert.equal((await request('POST', `${initiative}/advance`, alice.token)).statusCode, 204);
    assert.deepEqual(await current(), ['Бран'], 'Лира is done, Бран still acts');
    assert.equal((await request('POST', `${initiative}/advance`, alice.token)).statusCode, 403, 'not her turn any more');
    assert.equal((await request('POST', `${initiative}/advance`, bob.token)).statusCode, 204);
    assert.deepEqual(await current(), ['Волк', 'Гоблин'], 'the two goblinoids — together too');
    assert.equal((await move(goblin.id, 2.5, gm.token)).statusCode, 200, 'now it is the goblin’s turn — within its speed');
  });

  await t.test('the GM finishes one creature with entryId, or the whole group; a new round starts with the group again', async () => {
    const wolfEntry = await entryOf(wolf.id);
    assert.equal((await request('POST', `${initiative}/advance`, gm.token, {entryId: wolfEntry.id})).statusCode, 204);
    assert.deepEqual(await current(), ['Гоблин']);
    assert.equal((await request('POST', `${initiative}/advance`, gm.token)).statusCode, 204);
    assert.deepEqual(await current(), ['Бран', 'Лира']);
    const scene = (await pg.query<any>('SELECT combat_round FROM scenes WHERE id=$1', [sceneId])).rows[0];
    assert.equal(scene.combat_round, 2);
    assert.equal((await entryOf(lira.id)).moved_feet, 0, 'a fresh turn — full speed again');
  });

  await t.test('group_turns = false — one by one, as before', async () => {
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'group_turns','flag','Групповой ход','false'::jsonb,$2)`, [campaignId, gm.user.id]);
    await request('POST', `${initiative}/advance`, gm.token);
    assert.deepEqual(await current(), ['Гоблин']);
    await request('POST', `${initiative}/advance`, gm.token);
    assert.deepEqual(await current(), ['Волк']);
  });
});
