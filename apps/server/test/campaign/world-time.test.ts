import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('time of day and weather', async t => {
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

  const gm = await register('gm_time'), alice = await register('alice_time');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Time'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Тракт', widthCells: 30, heightCells: 1})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const characters = `${base}/characters`;
  const hero = (await request('POST', characters, alice.token, {kind: 'character', name: 'Герой', hpMax: 10})).json();
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: -14.5, z: 0});
  const torch = (await request('POST', characters, gm.token, {kind: 'object', name: 'Факел'})).json();
  const lantern = (await request('POST', characters, gm.token, {kind: 'object', name: 'Фонарь'})).json();
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: torch.id, x: -13.5, z: 0});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: lantern.id, x: -12.5, z: 0});
  await request('PUT', `${characters}/${torch.id}/state`, gm.token, {lightBrightFeet: 20, lightDimFeet: 20, lit: true, lightOpenFlame: true});
  await request('PUT', `${characters}/${lantern.id}/state`, gm.token, {lightBrightFeet: 30, lightDimFeet: 30, lit: true});
  const time = async () => (await request('GET', `${base}/time`, alice.token)).json();
  const sceneFor = async (token: string) => (await request('GET', scenePath, token)).json();

  await t.test('the campaign clock starts on day 1 at 8:00; only the GM moves it', async () => {
    assert.deepEqual(await time(), {minutes: 480, text: 'День 1, 08:00', phase: 'day'});
    assert.equal((await request('PUT', `${base}/time`, alice.token, {advanceMinutes: 60})).statusCode, 403);
    assert.equal((await request('PUT', `${base}/time`, gm.token, {advanceMinutes: 60, minutes: 3})).statusCode, 400, 'one of the two');
    const moved = await request('PUT', `${base}/time`, gm.token, {advanceMinutes: 600});
    assert.deepEqual(moved.json(), {minutes: 1080, text: 'День 1, 18:00', phase: 'dusk'});
  });

  await t.test('a scene under the sky takes its light from the clock; a fixed one keeps its own', async () => {
    assert.equal((await sceneFor(gm.token)).scene.effective_lighting, 'bright', 'fixed scenes stay as set');
    assert.equal((await request('PATCH', scenePath, gm.token, {sky: 'clock'})).json().sky, 'clock');
    assert.equal((await sceneFor(gm.token)).scene.effective_lighting, 'dim', 'dusk');
    await request('PUT', `${base}/time`, gm.token, {minutes: 23 * 60});
    const night = await sceneFor(alice.token);
    assert.equal(night.scene.effective_lighting, 'dark');
    const seen = night.fog.visibleCells.map((cell: any) => cell.x).sort((a: number, b: number) => a - b);
    assert.equal(seen.at(-1), -0.5, 'at night only the torch (40 ft) and the lantern (60 ft from −12,5) light the road');
    await request('PUT', `${base}/time`, gm.token, {minutes: 12 * 60});
    assert.equal((await sceneFor(alice.token)).fog.visibleCells.length, 30, 'at noon the whole road is in sight');
  });

  await t.test('fog: half-light everywhere, sight up to 60 ft, Perception with disadvantage', async () => {
    assert.equal((await request('PATCH', scenePath, gm.token, {weather: 'blizzard'})).statusCode, 400);
    await request('PATCH', scenePath, gm.token, {weather: 'fog'});
    const cells = (await sceneFor(alice.token)).fog.visibleCells;
    assert.equal(cells.length, 13, 'own cell and 12 more — 60 ft');
    assert.ok(cells.every((cell: any) => cell.light === 'dim'), 'even by the torch it is no brighter than half-light');
    const look = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'skill', key: 'perception', sceneId})).json();
    assert.equal(look.outcome.advantage, 'disadv');
    assert.ok(look.outcome.reasons.includes('помеха: туман'), JSON.stringify(look.outcome));
    const away = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'skill', key: 'perception'})).json();
    assert.equal(away.outcome.advantage, 'none', 'without a scene nothing is assumed');
  });

  await t.test('a storm puts out the torch, not the lantern, and the torch cannot be relit', async () => {
    await request('PATCH', scenePath, gm.token, {weather: 'storm'});
    const objects = (await sceneFor(gm.token)).objects;
    assert.deepEqual(objects.find((o: any) => o.character_id === torch.id).state.light, {bright: 20, dim: 20, lit: false, openFlame: true, cone: false});
    assert.equal(objects.find((o: any) => o.character_id === lantern.id).state.light.lit, true);
    const relit = await request('POST', `${characters}/${torch.id}/interact`, alice.token, {action: 'light'});
    assert.equal(relit.statusCode, 400);
    assert.match(relit.json().message, /ливнем/);
    await request('PATCH', scenePath, gm.token, {weather: 'clear'});
    assert.equal((await request('POST', `${characters}/${torch.id}/interact`, alice.token, {action: 'light'})).json().outcome, 'lit');
  });

  await t.test('a party rest moves the clock: short — an hour, long — eight', async () => {
    const before = (await time()).minutes;
    assert.equal((await request('POST', `${scenePath}/rest`, gm.token, {kind: 'short', autoHitDice: false})).statusCode, 200);
    assert.equal((await time()).minutes, before + 60);
    await request('POST', `${scenePath}/rest`, gm.token, {kind: 'long'});
    assert.equal((await time()).minutes, before + 540);
  });

  await t.test('a fight of twelve rounds takes two minutes of the day', async () => {
    const initiative = `${scenePath}/initiative`;
    const entry = (await request('POST', `${initiative}/join`, alice.token, {characterId: hero.id})).json().id;
    await request('PATCH', `${initiative}/${entry}`, gm.token, {score: 10});
    await request('POST', `${initiative}/advance`, gm.token);
    await pg.query('UPDATE scenes SET combat_round=12 WHERE id=$1', [sceneId]);
    const before = (await time()).minutes;
    assert.equal((await request('DELETE', initiative, gm.token)).statusCode, 204);
    assert.equal((await time()).minutes, before + 2);
  });
});
