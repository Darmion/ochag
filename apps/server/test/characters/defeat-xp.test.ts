import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('experience for a defeat by a trap or by hand', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000});
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
  const gm = await register('gm_xp2'), alice = await register('alice_xp2');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'XP'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Коридор', widthCells: 10, heightCells: 2})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Лира', level: 1})).json();
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: -4.5, z: 0.5});
  const goblin = async (name: string, x: number) => {
    const made = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name, disposition: 'hostile', hpMax: 7, hpCurrent: 7})).json();
    await pg.query('UPDATE characters SET challenge_rating=0.25 WHERE id=$1', [made.id]);
    const at = (await request('POST', `${scenePath}/objects`, gm.token, {characterId: made.id, x, z: 0.5})).json();
    return { ...made, placement: at };
  };
  const xp = async () => (await pg.query<any>('SELECT experience FROM characters WHERE id=$1', [hero.id])).rows[0].experience as number;

  await t.test('a goblin walks into a deadly trap — the party gets its 50 XP', async () => {
    const victim = await goblin('Гоблин-1', 4.5);
    const pit = await request('POST', `${scenePath}/triggers`, gm.token, {
      kind: 'enter', shape: 'circle', x: 2.5, z: 0.5, direction: 0, sizeFeet: 5, name: 'Колья', damageFormula: '1d1+20', damageType: 'piercing', once: true,
    });
    assert.equal(pit.statusCode, 201, pit.body);
    const before = await xp();
    const placed = (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.id === victim.placement.id);
    const moved = await request('PUT', `${scenePath}/objects/${victim.placement.id}`, gm.token, {
      x: 1.5, y: placed.y, z: 0.5, rotationY: 0, scale: placed.scale, snapToGrid: true, parentObjectId: null, animationName: null, revision: placed.revision,
    });
    assert.equal(moved.statusCode, 200, moved.body);
    assert.equal((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [victim.id])).rows[0].hp_current, 0);
    assert.equal(await xp(), before + 50);
  });

  await t.test('the GM sets a goblin to 0 HP by hand — XP too, once', async () => {
    const victim = await goblin('Гоблин-2', 3.5);
    const before = await xp();
    const sheet = (await request('GET', `${base}/characters/${victim.id}`, gm.token)).json();
    const zero = await request('PATCH', `${base}/characters/${victim.id}`, gm.token, {hpCurrent: 0, revision: sheet.revision});
    assert.equal(zero.statusCode, 200, zero.body);
    assert.equal(await xp(), before + 50);
    const again = (await request('GET', `${base}/characters/${victim.id}`, gm.token)).json();
    await request('PATCH', `${base}/characters/${victim.id}`, gm.token, {hpCurrent: 5, revision: again.revision});
    const third = (await request('GET', `${base}/characters/${victim.id}`, gm.token)).json();
    await request('PATCH', `${base}/characters/${victim.id}`, gm.token, {hpCurrent: 0, revision: third.revision});
    assert.equal(await xp(), before + 50, 'once per creature');
  });
});
