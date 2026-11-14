import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('what a hero holds: the scene shows it, and a torch in hand lights the dark', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db);
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({
    method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {}),
  }));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_held'), alice = await register('alice_held'), bob = await register('bob_held');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Held'})).json().id;
  for (const member of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Коридор', widthCells: 10, heightCells: 1})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  await request('PATCH', scenePath, gm.token, {lighting: 'dark'});
  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Хельга', className: 'Воин', level: 1})).json();
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: -4.5, z: 0});

  const scene = async (token = bob.token) => (await request('GET', scenePath, token)).json();
  const figure = async (token = bob.token) => (await scene(token)).objects.find((entry: any) => entry.character_id === hero.id);
  const lit = async () => ((await scene(alice.token)).fog?.visibleCells ?? []).map((cell: any) => `${cell.x}:${cell.light}`).sort();
  const take = async (ref: string, name: string, slot: string) => {
    assert.equal((await request('POST', `${base}/characters/${hero.id}/inventory`, alice.token, {ref, quantity: 1})).statusCode, 201);
    const item = (await request('GET', `${base}/characters/${hero.id}/inventory`, alice.token)).json().items.find((entry: any) => entry.name === name);
    const equipped = await request('POST', `${base}/characters/${item.id}/equip-slot`, alice.token, {slot});
    assert.equal(equipped.statusCode, 200, equipped.body);
    return item.id as string;
  };

  await t.test('nothing in hand: no held items, the hero sees only his own cell', async () => {
    const plain = await figure();
    assert.equal(plain.held, undefined);
    assert.deepEqual(await lit(), ['-4.5:dark']);
  });

  let torch = '';
  await t.test('a torch taken in hand from the pack: everyone sees it, and it lights 20 feet bright and 20 dim', async () => {
    torch = await take('gear:torch', 'Факел', 'off_hand');
    const shown = await figure();
    assert.deepEqual(shown.held, [{hand: 'off', name: 'Факел', srd: 'gear:torch', imageAssetId: null, look: 'torch', twoHanded: false}]);
    assert.deepEqual(shown.heldLight, {bright: 20, dim: 20, cone: false, openFlame: true});
    const cells = await lit();
    assert.ok(cells.includes('-4.5:bright') && cells.includes('-1.5:bright'), cells.join(' '));
    assert.ok(cells.some((cell: string) => cell.endsWith(':dim')), 'dim light beyond the bright');
  });

  await t.test('a sword in the main hand comes first; a doused torch gives no light', async () => {
    await take('weapon:longsword', 'Длинный меч', 'main_hand');
    assert.deepEqual((await figure()).held.map((item: any) => [item.hand, item.look]), [['main', 'sword'], ['off', 'torch']]);
    await pg.query(
      `INSERT INTO object_states (campaign_id, character_id, light_bright_feet, light_dim_feet, lit) VALUES ($1,$2,20,20,false)`,
      [campaignId, torch],
    );
    assert.equal((await figure()).heldLight, undefined);
    assert.deepEqual(await lit(), ['-4.5:dark']);
  });
});
