import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('hit point bars: who sees whose hit points on the table', async t => {
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

  const gm = await register('gm_hp'), owner = await register('owner_hp'), other = await register('other_hp');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'HP'})).json().id;
  for (const member of [owner, other]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Арена'})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const characters = `/campaigns/${campaignId}/characters`;

  const hero = (await request('POST', characters, owner.token, {kind: 'character', name: 'Герой', hpMax: 20, hpCurrent: 12})).json();
  const orc = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Орк', disposition: 'hostile', hpMax: 15})).json();
  const door = (await request('POST', characters, gm.token, {kind: 'object', name: 'Дверь', hpMax: 18})).json();
  await request('POST', `${scenePath}/objects`, owner.token, {characterId: hero.id, x: 0.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: orc.id, x: 2.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: door.id, x: 4.5, z: 0.5});

  const hpSeenBy = async (token: string) => Object.fromEntries(
    (await request('GET', scenePath, token)).json().objects.map((o: any) => [o.name, o.hp]),
  );

  await t.test('the GM sees everyone’s hit points', async () => {
    assert.deepEqual(await hpSeenBy(gm.token), {
      'Герой': {current: 12, max: 20, temp: 0},
      'Орк': {current: 15, max: 15, temp: 0},
      'Дверь': {current: 18, max: 18, temp: 0},
    });
  });

  await t.test('a player sees player characters’ hit points, not NPCs’ or objects’', async () => {
    assert.deepEqual(await hpSeenBy(other.token), {'Герой': {current: 12, max: 20, temp: 0}, 'Орк': null, 'Дверь': null});
  });

  await t.test('hiding hit points on the sheet hides the bar from others, not from the owner', async () => {
    const visibility = await request('PUT', `${characters}/${hero.id}/visibility/hp_current`, owner.token, {mode: 'hidden'});
    assert.equal(visibility.statusCode, 200, visibility.body);
    assert.equal((await hpSeenBy(other.token))['Герой'], null);
    assert.deepEqual((await hpSeenBy(owner.token))['Герой'], {current: 12, max: 20, temp: 0});

    await request('PUT', `${characters}/${hero.id}/visibility/hp_current`, owner.token, {mode: 'allowlist', allowedUserIds: [other.user.id]});
    assert.deepEqual((await hpSeenBy(other.token))['Герой'], {current: 12, max: 20, temp: 0});
  });

  await t.test('damage applied from the roll log shows up on the bar', async () => {
    const roll = (await request('POST', `/campaigns/${campaignId}/rolls`, gm.token, {formula: '1d1+4'})).json();
    const applied = await request('POST', `/campaigns/${campaignId}/rolls/${roll.id}/apply`, gm.token, {characterId: orc.id, mode: 'damage'});
    assert.equal(applied.statusCode, 200, applied.body);
    assert.equal(applied.json().applied, 5);
    assert.deepEqual((await hpSeenBy(gm.token))['Орк'], {current: 10, max: 15, temp: 0});
  });
});
