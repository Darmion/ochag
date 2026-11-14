import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.ts';
import { createTestDatabase } from '../helpers.ts';

test('a wager with consent: stakes leave the purses at the start and go to the winner or back', async t => {
  const { pg, db } = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, { rateMax: 1_000_000 });
  t.after(() => app.close());

  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({
    method, url,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    ...(payload !== undefined ? { payload } : {}),
  }));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, { username, password: 'x' })).json();
  const gm = await register('gm_wager'), alice = await register('alice_wager'), bob = await register('bob_wager');
  const campaignId = (await request('POST', '/campaigns', gm.token, { name: 'Wagers' })).json().id;
  for (const player of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', player.token, { code });
  }
  const base = `/campaigns/${campaignId}`;
  const create = async (token: string, name: string) => (await request('POST', `${base}/characters`, token, { kind: 'character', name })).json();
  const lira = await create(alice.token, 'Лира'), bran = await create(bob.token, 'Бран');
  const setGold = (id: string, gp: number) => pg.query('UPDATE characters SET cp=0, sp=0, ep=0, gp=$2, pp=0 WHERE id=$1', [id, gp]);
  const gold = async (id: string) => Number((await pg.query<{ gp: number }>('SELECT gp FROM characters WHERE id=$1', [id])).rows[0]!.gp);
  await setGold(lira.id, 10);
  await setGold(bran.id, 3);

  const path = `${base}/minigames/duel`;
  const duel = async (token: string, body: any) => {
    const revision = (await request('GET', path, gm.token)).json().game?.revision ?? 0;
    return request('POST', path, token, { revision, ...body });
  };
  const ready = async () => {
    assert.equal((await duel(alice.token, { action: 'create' })).statusCode, 200);
    assert.equal((await duel(bob.token, { action: 'join' })).statusCode, 200);
  };

  await t.test('only the host names the stake, and nobody plays for it without agreeing', async () => {
    await ready();
    assert.equal((await duel(bob.token, { action: 'stake', stakeCp: 500 })).statusCode, 409);
    const staked = await duel(alice.token, { action: 'stake', stakeCp: 500 });
    assert.deepEqual(staked.json().game.wager, { stakeCp: 500, seats: [], paid: false, settled: false });
    const early = await duel(alice.token, { action: 'start' });
    assert.equal(early.statusCode, 409);
    assert.match(early.json().message, /Ставку ещё не приняли: alice_wager, bob_wager/);
    assert.equal((await duel(bob.token, { action: 'agree', heroId: lira.id })).statusCode, 403, 'one pays only from one\'s own hero');
  });

  await t.test('a purse short of the stake stops the start and nothing is taken', async () => {
    assert.equal((await duel(alice.token, { action: 'agree', heroId: lira.id })).statusCode, 200);
    assert.equal((await duel(bob.token, { action: 'agree', heroId: bran.id })).statusCode, 200);
    const short = await duel(alice.token, { action: 'start' });
    assert.equal(short.statusCode, 409);
    assert.match(short.json().message, /У «Бран» не хватает денег на ставку 5 зм/);
    assert.equal((await request('GET', path, gm.token)).json().game.phase, 'lobby');
    assert.equal(await gold(lira.id), 10, 'the whole start rolled back');
  });

  await t.test('the stakes leave at the start, and the winner takes the pot', async () => {
    await setGold(bran.id, 10);
    const started = await duel(alice.token, { action: 'start' });
    assert.equal(started.statusCode, 200, started.body);
    assert.equal(started.json().game.wager.paid, true);
    assert.deepEqual([await gold(lira.id), await gold(bran.id)], [5, 5]);
    const done = await duel(bob.token, { action: 'surrender' });
    assert.equal(done.json().game.effect, '«Лира» забирает банк: 10 зм.');
    assert.deepEqual([await gold(lira.id), await gold(bran.id)], [15, 5]);
  });

  await t.test('a duel called off after the start gives everyone the stake back', async () => {
    await ready();
    await duel(alice.token, { action: 'stake', stakeCp: 300 });
    await duel(alice.token, { action: 'agree', heroId: lira.id });
    await duel(bob.token, { action: 'agree', heroId: bran.id });
    assert.equal((await duel(alice.token, { action: 'start' })).statusCode, 200);
    assert.deepEqual([await gold(lira.id), await gold(bran.id)], [12, 2]);
    const off = await duel(gm.token, { action: 'cancel' });
    assert.equal(off.statusCode, 200, off.body);
    assert.match(off.json().game.effect, /^Ставки вернулись в кошельки/);
    assert.deepEqual([await gold(lira.id), await gold(bran.id)], [15, 5]);
  });
});
