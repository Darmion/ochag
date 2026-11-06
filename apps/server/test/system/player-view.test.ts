import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('the GM sees a scene through a player’s eyes', async t => {
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

  const gm = await register('gm_view'), player = await register('player_view'), other = await register('other_view');
  const outsider = await register('outsider_view');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'View'})).json().id;
  for (const member of [player, other]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Подземелье', widthCells: 30, heightCells: 30})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  await request('PATCH', scenePath, gm.token, {defaultVisionRadiusFeet: 30});
  const characters = `/campaigns/${campaignId}/characters`;

  const hero = (await request('POST', characters, player.token, {kind: 'character', name: 'Герой', hpMax: 10})).json();
  const goblin = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 7})).json();
  const ambush = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Засада', disposition: 'hostile', hpMax: 7})).json();
  await request('POST', `${scenePath}/objects`, player.token, {characterId: hero.id, x: -14.5, z: -14.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 14.5, z: 14.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: ambush.id, x: -13.5, z: -14.5, hidden: true});
  await request('POST', `${scenePath}/drawings`, gm.token, {kind: 'text', layer: 'gm', color: '#ff0000', points: [[0, 0]], text: 'Ловушка'});
  await request('POST', `${scenePath}/drawings`, gm.token, {kind: 'text', layer: 'all', color: '#ff0000', points: [[1, 1]], text: 'Вход'});
  await request('POST', `${scenePath}/counters`, gm.token, {name: 'Подкрепление', kind: 'rounds', value: 3, hidden: true});
  await request('POST', `${scenePath}/counters`, gm.token, {name: 'Ритуал', kind: 'rounds', value: 5});

  await t.test('?viewAs gives exactly the player’s own view', async () => {
    const own = (await request('GET', scenePath, player.token)).json();
    const seen = await request('GET', `${scenePath}?viewAs=${player.user.id}`, gm.token);
    assert.equal(seen.statusCode, 200, seen.body);
    assert.deepEqual(seen.json(), own);

    const view = seen.json();
    assert.equal(view.scene.canManage, false);
    assert.ok(view.fog, 'the fog applies');
    assert.deepEqual(view.objects.map((o: any) => o.name), ['Герой'], 'no goblin in the fog, no hidden ambush');
    assert.deepEqual(view.drawings.map((d: any) => d.text), ['Вход']);
    assert.deepEqual(view.counters.map((c: any) => c.name), ['Ритуал']);
  });

  await t.test('without viewAs the GM still sees everything', async () => {
    const full = (await request('GET', scenePath, gm.token)).json();
    assert.equal(full.scene.canManage, true);
    assert.equal(full.fog, null);
    assert.deepEqual(full.objects.map((o: any) => o.name).sort(), ['Гоблин', 'Засада', 'Герой'].sort());
  });

  await t.test('only a scene GM may look through someone else’s eyes, and only a member’s', async () => {
    assert.equal((await request('GET', `${scenePath}?viewAs=${player.user.id}`, other.token)).statusCode, 403);
    assert.equal((await request('GET', `${scenePath}?viewAs=${outsider.user.id}`, gm.token)).statusCode, 400);
    assert.equal((await request('GET', `${scenePath}?viewAs=${player.user.id}`, player.token)).statusCode, 200);
  });
});
