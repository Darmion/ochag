import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.ts';
import { createTestDatabase } from '../helpers.ts';
test('duel API: pending choice hidden from opponent and GM, shared reveal and revision guards', async t => {
  const { pg, db } = await createTestDatabase(); const app = await buildApp(db, { rateMax: 10000 });
  t.after(async () => { await app.close(); await pg.close(); });
  const req = (method: any, url: string, token?: string, payload?: any) => app.inject({ method, url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}), ...(payload ? { payload } : {}) });
  const register = async (username: string) => (await req('POST', '/auth/register', undefined, { username, password: 'x' })).json();
  const gm = await register('duel_gm'), a = await register('duel_a'), b = await register('duel_b'), outsider = await register('duel_out');
  const campaign = (await req('POST', '/campaigns', gm.token, { name: 'Duel' })).json().id;
  for (const user of [a, b]) {
    const invite = (await req('POST', `/campaigns/${campaign}/invites`, gm.token)).json().code;
    const joined = await req('POST', '/campaigns/join', user.token, { code: invite });
    assert.ok(joined.statusCode < 300, joined.body);
  }
  const path = `/campaigns/${campaign}/minigames/duel`;
  assert.equal((await req('GET', path)).statusCode, 401);
  assert.equal((await req('GET', path, outsider.token)).statusCode, 404);
  assert.equal((await req('POST', path, outsider.token, { action: 'create', revision: 0 })).statusCode, 404);
  let game = (await req('POST', path, a.token, { action: 'create', revision: 0 })).json().game;
  game = (await req('POST', path, b.token, { action: 'join', revision: game.revision })).json().game;
  game = (await req('POST', path, a.token, { action: 'start', revision: game.revision })).json().game;
  const command = { action: 'choose', move: 'feint', revision: game.revision };
  const replies = await Promise.all([req('POST', path, a.token, command), req('POST', path, a.token, command)]);
  assert.deepEqual(replies.map(r => r.statusCode).sort(), [200, 409]);
  for (const user of [b, gm]) {
    const result = await req('GET', path, user.token); const visible = result.json().game;
    assert.equal(visible.ownMove, null); assert.equal('choices' in visible, false);
    assert.equal(result.body.includes('feint'), false); assert.equal(visible.players[0].stamina, 3);
  }
  game = (await req('GET', path, a.token)).json().game; assert.equal(game.ownMove, 'feint');
  assert.equal((await req('POST', path, gm.token, { action: 'choose', move: 'rest', revision: game.revision })).statusCode, 409);
  assert.equal((await req('POST', path, a.token, { action: 'choose', move: 'rest', revision: game.revision })).statusCode, 409);
  game = (await req('POST', path, b.token, { action: 'choose', move: 'guard', revision: game.revision })).json().game;
  assert.deepEqual(game.history[0].moves, ['feint', 'guard']); assert.equal(game.players[1].health, 4); assert.equal(game.players[0].stamina, 1);
  assert.equal(game.ownMove, null); assert.deepEqual(game.ready, []);
  assert.equal((await req('POST', path, a.token, { action: 'choose', move: 'feint', revision: game.revision })).statusCode, 409);
  assert.equal((await req('POST', path, a.token, { action: 'choose', move: 'rest', damage: 6, revision: game.revision })).statusCode, 400);
  game = (await req('POST', path, gm.token, { action: 'cancel', revision: game.revision })).json().game;
  assert.equal(game.phase, 'cancelled');
  assert.equal((await req('POST', path, a.token, { action: 'create', revision: 0 })).statusCode, 409);
  assert.equal((await req('POST', path, b.token, { action: 'create', revision: game.revision })).statusCode, 200);
  const other = (await req('POST', '/campaigns', gm.token, { name: 'Other' })).json().id;
  assert.equal((await req('GET', `/campaigns/${other}/minigames/duel`, gm.token)).json().game, null);
});
