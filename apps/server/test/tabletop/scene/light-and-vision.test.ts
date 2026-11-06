import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('light and vision: party sight, a torch in hand, the GM’s light map', async t => {
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

  const gm = await register('gm_lv'), alice = await register('alice_lv'), bob = await register('bob_lv');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Light'})).json().id;
  for (const member of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Коридор', widthCells: 10, heightCells: 1})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const characters = `/campaigns/${campaignId}/characters`;
  await request('PATCH', scenePath, gm.token, {lighting: 'dark'});

  const hero = (await request('POST', characters, alice.token, {kind: 'character', name: 'Герой'})).json();
  const goblin = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile'})).json();
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: -4.5, z: 0});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 4.5, z: 0});

  const sceneFor = async (token: string, query = '') => (await request('GET', `${scenePath}${query}`, token)).json();
  const cells = (scene: any) => (scene.fog?.visibleCells ?? []).map((cell: any) => `${cell.x}:${cell.light}`).sort();

  await t.test('in the dark the hero knows only his own cell; Bob sees through the party’s eyes', async () => {
    assert.deepEqual(cells(await sceneFor(alice.token)), ['-4.5:dark']);
    assert.deepEqual(cells(await sceneFor(bob.token)), ['-4.5:dark'], 'no own token — the party’s view, not a black map');
  });

  await t.test('a torch in the hero’s hand: only the light, set and lit by whoever controls him', async () => {
    assert.equal((await request('PUT', `${characters}/${hero.id}/state`, alice.token, {openable: true})).statusCode, 400, 'a creature has no door state');
    assert.equal((await request('PUT', `${characters}/${hero.id}/state`, bob.token, {lightBrightFeet: 5, lightDimFeet: 5})).statusCode, 403);
    const lit = await request('PUT', `${characters}/${hero.id}/state`, alice.token, {lightBrightFeet: 5, lightDimFeet: 5, lit: true});
    assert.equal(lit.statusCode, 200, lit.body);
    assert.deepEqual(cells(await sceneFor(alice.token)), ['-2.5:dim', '-3.5:bright', '-4.5:bright']);
    assert.deepEqual(cells(await sceneFor(bob.token)), ['-2.5:dim', '-3.5:bright', '-4.5:bright']);
    const token = (await sceneFor(bob.token)).objects.find((o: any) => o.character_id === hero.id);
    assert.deepEqual(token.state.light, {bright: 5, dim: 5, lit: true, openFlame: false, cone: false}, 'everyone sees the torch burn');

    assert.equal((await request('POST', `${characters}/${hero.id}/interact`, bob.token, {action: 'douse'})).statusCode, 403);
    assert.equal((await request('POST', `${characters}/${hero.id}/interact`, alice.token, {action: 'douse'})).json().outcome, 'doused');
    assert.deepEqual(cells(await sceneFor(alice.token)), ['-4.5:dark']);
    assert.equal((await request('POST', `${characters}/${hero.id}/interact`, alice.token, {action: 'light'})).json().outcome, 'lit');
  });

  await t.test('the GM gets the light map and can look through the party’s eyes', async () => {
    const scene = await sceneFor(gm.token);
    assert.equal(scene.fog, null, 'no fog for the GM');
    assert.equal(scene.illumination, '0000000122'.split('').reverse().join(''), 'bright at the torch, dim at its edge, dark beyond');
    assert.deepEqual(scene.vision, {fogEnabled: true, partyVision: true, alliedChoice: null});
    assert.equal(scene.fogPreview, null);
    const preview = await sceneFor(gm.token, '?fogAs=party');
    assert.deepEqual(preview.fogPreview.visibleCells.map((cell: any) => cell.x).sort((a: number, b: number) => a - b), [-4.5, -3.5, -2.5], 'not through the goblin’s eyes');
    assert.equal((await sceneFor(alice.token, '?fogAs=party')).fogPreview, null, 'a player gets no preview');
    const xs = (scene: any) => scene.fogPreview.visibleCells.map((cell: any) => cell.x).sort((a: number, b: number) => a - b);
    assert.deepEqual(xs(await sceneFor(gm.token, `?fogOf=${goblin.id}`)), [-4.5, -3.5, -2.5, 4.5], 'the goblin’s own eyes');
    assert.deepEqual(xs(await sceneFor(gm.token, `?fogOf=${hero.id}`)), [-4.5, -3.5, -2.5]);
    assert.equal((await sceneFor(gm.token, `?fogOf=${goblin.id}`)).fog, null, 'the GM still sees the whole map under the preview');
    assert.equal((await sceneFor(alice.token, `?fogOf=${goblin.id}`)).fogPreview, null, 'a player cannot look through the goblin’s eyes');
    const names = (scene: any) => scene.objects.map((o: any) => o.name).sort();
    assert.deepEqual(names(await sceneFor(gm.token, `?fogOf=${hero.id}`)), ['Герой'], 'the goblin in the dark is not on the hero’s map');
    assert.deepEqual(names(await sceneFor(gm.token, `?fogOf=${goblin.id}`)), ['Гоблин', 'Герой'].sort(), 'the hero by the torch is seen');
    assert.deepEqual(names(await sceneFor(gm.token)), ['Гоблин', 'Герой'].sort(), 'without the preview the GM sees everything');
  });

  await t.test('dusk: everything in sight, in half-light', async () => {
    await request('PATCH', scenePath, gm.token, {lighting: 'dim'});
    const seen = (await sceneFor(alice.token)).fog.visibleCells;
    assert.equal(seen.length, 10);
    assert.equal(seen.filter((cell: any) => cell.light === 'dim').length, 8, 'the torch brightens two cells, the rest is dim');
    assert.equal((await sceneFor(gm.token)).illumination, '2211111111');
    await request('PATCH', scenePath, gm.token, {lighting: 'bright'});
    assert.equal((await sceneFor(gm.token)).illumination, null, 'a bright scene needs no light map');
    await request('PATCH', scenePath, gm.token, {lighting: 'dark'});
  });

  await t.test('party_vision = false: each player sees only with his own creatures', async () => {
    await pg.query(
      `INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'party_vision','flag','Обзор отряда','false'::jsonb,$2)`,
      [campaignId, gm.user.id],
    );
    assert.deepEqual(cells(await sceneFor(bob.token)), []);
    assert.equal(cells(await sceneFor(alice.token)).length, 3);
  });

  await t.test('the GM switches the campaign fog off and on', async () => {
    assert.equal((await request('PUT', `/campaigns/${campaignId}/fog`, alice.token, {enabled: false})).statusCode, 403);
    assert.equal((await request('PUT', `/campaigns/${campaignId}/fog`, gm.token, {enabled: false})).statusCode, 200);
    const open = await sceneFor(bob.token);
    assert.equal(open.fog, null);
    assert.equal(open.illumination.length, 10, 'without fog the player gets the light map too');
    assert.equal((await request('PUT', `/campaigns/${campaignId}/fog`, gm.token, {enabled: true})).statusCode, 200);
    assert.notEqual((await sceneFor(bob.token)).fog, null);
  });
});
