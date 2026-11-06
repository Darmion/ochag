import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('secret doors and passages between scenes', async t => {
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

  const gm = await register('gm_secret'), alice = await register('alice_secret'), bob = await register('bob_secret');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Secrets'})).json().id;
  for (const player of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', player.token, {code});
  }
  const base = `/campaigns/${campaignId}`;
  const hall = (await request('POST', `${base}/scenes`, gm.token, {name: 'Коридор', widthCells: 10, heightCells: 1})).json().id;
  const cellar = (await request('POST', `${base}/scenes`, gm.token, {name: 'Подвал', widthCells: 6, heightCells: 6})).json().id;
  const hallPath = `${base}/scenes/${hall}`;
  const cellarPath = `${base}/scenes/${cellar}`;
  const characters = `${base}/characters`;
  const create = async (token: string, body: any) => (await request('POST', characters, token, body)).json();
  const place = async (token: string, scenePath: string, characterId: string, x: number, z: number) =>
    (await request('POST', `${scenePath}/objects`, token, {characterId, x, z})).json().id as string;

  const hero = await create(alice.token, {kind: 'character', name: 'Герой'});
  const friend = await create(bob.token, {kind: 'character', name: 'Друг'});
  const torch = await create(alice.token, {kind: 'object', name: 'Факел'});
  const heroAt = await place(alice.token, hallPath, hero.id, -4.5, 0);
  await place(bob.token, hallPath, friend.id, -1.5, 0);
  const door = await create(gm.token, {kind: 'object', name: 'Тайная дверь'});
  await place(gm.token, hallPath, door.id, 0.5, 0);
  const ladder = await create(gm.token, {kind: 'object', name: 'Лестница вниз'});
  await place(gm.token, hallPath, ladder.id, -3.5, 0);
  const landing = await create(gm.token, {kind: 'object', name: 'Лестница наверх'});
  await place(gm.token, cellarPath, landing.id, 1.5, 1.5);
  const torchAt = await place(alice.token, hallPath, torch.id, -4.5, 0);
  const torchRow = (await request('GET', hallPath, alice.token)).json().objects.find((o: any) => o.id === torchAt);
  await request('PUT', `${hallPath}/objects/${torchAt}`, alice.token, {
    x: 0, y: 0, z: 0, rotationY: 0, scale: 1, snapToGrid: false, parentObjectId: heroAt, animationName: null, revision: torchRow.revision,
  });

  const objectsFor = async (token: string, path: string) => (await request('GET', path, token)).json().objects as any[];

  await t.test('an unfound secret door is invisible to players, but still blocks the way', async () => {
    const set = await request('PUT', `${characters}/${door.id}/state`, gm.token, {openable: true, blocks: true, secretDc: 30});
    assert.equal(set.statusCode, 200, set.body);
    assert.deepEqual(set.json().state.secret, {dc: 30, found: false});
    assert.ok(!(await objectsFor(alice.token, hallPath)).some(o => o.character_id === door.id));
    assert.ok((await objectsFor(gm.token, hallPath)).some(o => o.character_id === door.id));
    assert.equal((await request('POST', `${characters}/${door.id}/interact`, alice.token, {action: 'open'})).statusCode, 404);
    const current = (await objectsFor(alice.token, hallPath)).find(o => o.id === heroAt);
    const through = await request('PUT', `${hallPath}/objects/${heroAt}`, alice.token, {
      x: 2.5, y: 0, z: 0, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
    });
    assert.equal(through.statusCode, 400, 'the hidden door is a wall');
  });

  await t.test('a search with a good roll finds it; from then on players see and open it', async () => {
    await pg.query('UPDATE object_states SET secret_dc=1 WHERE character_id=$1', [door.id]);
    const search = await request('POST', `${hallPath}/search`, bob.token, {characterId: friend.id});
    assert.equal(search.statusCode, 200, search.body);
    assert.ok(search.json().found.includes('тайное: «Тайная дверь»'), JSON.stringify(search.json()));
    assert.ok((await objectsFor(alice.token, hallPath)).some(o => o.character_id === door.id));
    assert.equal((await request('POST', `${characters}/${door.id}/interact`, alice.token, {action: 'open'})).json().outcome, 'opened');
  });

  await t.test('a passage leads to a scene in this campaign, to an item there', async () => {
    assert.equal((await request('PUT', `${characters}/${ladder.id}/state`, gm.token, {passageSceneId: '00000000-0000-4000-8000-000000000000'})).statusCode, 400);
    assert.equal((await request('PUT', `${characters}/${ladder.id}/state`, gm.token, {passageSceneId: cellar, passageTargetId: hero.id})).statusCode, 400, 'the target is an item');
    const linked = await request('PUT', `${characters}/${ladder.id}/state`, gm.token, {passageSceneId: cellar, passageTargetId: landing.id});
    assert.equal(linked.statusCode, 200, linked.body);
    const seen = (await objectsFor(alice.token, hallPath)).find(o => o.character_id === ladder.id);
    assert.deepEqual(seen.state.passage, {sceneId: cellar}, 'players see where it leads, not the target');
  });

  await t.test('walking through: own creature next to it; the torch in hand goes along', async () => {
    const travel = (token: string, body: any) => request('POST', `${characters}/${ladder.id}/travel`, token, body);
    assert.equal((await travel(alice.token, {actorIds: [friend.id]})).statusCode, 400, 'not hers');
    const far = await travel(bob.token, {actorIds: [friend.id]});
    assert.equal(far.statusCode, 400);
    assert.match(far.json().message, /далеко/);
    const went = await travel(alice.token, {actorIds: [hero.id]});
    assert.equal(went.statusCode, 200, went.body);
    assert.deepEqual([went.json().sceneName, went.json().moved], ['Подвал', ['Герой']]);
    assert.ok(!(await objectsFor(gm.token, hallPath)).some(o => o.character_id === hero.id || o.character_id === torch.id));
    const below = await objectsFor(gm.token, cellarPath);
    const arrived = below.find(o => o.character_id === hero.id);
    assert.ok(arrived, 'the hero is in the cellar');
    assert.ok(Math.abs(arrived.world_x - 1.5) <= 1 && Math.abs(arrived.world_z - 1.5) <= 1, `next to the landing: ${arrived.world_x}, ${arrived.world_z}`);
    assert.equal(below.find(o => o.character_id === torch.id)?.parent_object_id, arrived.id, 'the torch is still in his hand');
  });

  await t.test('no slipping away from a fight', async () => {
    const initiative = `${hallPath}/initiative`;
    await place(bob.token, hallPath, friend.id, -1.5, 0);
    const current = (await objectsFor(bob.token, hallPath)).find(o => o.character_id === friend.id);
    await request('PUT', `${hallPath}/objects/${current.id}`, bob.token, {
      x: -2.5, y: 0, z: 0, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
    });
    await request('POST', `${initiative}/join`, bob.token, {characterId: friend.id});
    const fled = await request('POST', `${characters}/${ladder.id}/travel`, bob.token, {actorIds: [friend.id]});
    assert.equal(fled.statusCode, 400);
    assert.match(fled.json().message, /в бою/);
  });
});
