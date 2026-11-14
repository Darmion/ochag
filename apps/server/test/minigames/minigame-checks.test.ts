import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.ts';
import { createTestDatabase } from '../helpers.ts';

test('a hero\'s skill check inside a mini-game: the server rolls, each hero tries once', async t => {
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
  const gm = await register('gm_checks'), alice = await register('alice_checks');
  const campaignId = (await request('POST', '/campaigns', gm.token, { name: 'Checks' })).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, { code });
  const base = `/campaigns/${campaignId}`;
  const create = async (token: string, body: any) => (await request('POST', `${base}/characters`, token, body)).json();
  // Intelligence 18 never fails DC 5 and intelligence 1 never makes DC 30: ability checks have no automatic 20.
  const sage = await create(alice.token, { kind: 'character', name: 'Мудрец', intelligence: 18 });
  const dunce = await create(alice.token, { kind: 'character', name: 'Простак', intelligence: 1 });
  const gmHero = await create(gm.token, { kind: 'character', name: 'Чужой' });
  const rolls = async () => Number((await pg.query<{ count: string }>(`SELECT count(*) FROM roll_log WHERE campaign_id=$1`, [campaignId])).rows[0]!.count);

  const runes = `${base}/minigames/rune-lock`;
  const rune = async (token: string, body: any) => {
    const revision = (await request('GET', runes, gm.token)).json().game?.revision ?? 0;
    return request('POST', runes, token, { revision, ...body });
  };

  await t.test('Arcana fixes the chosen ring of the rune lock', async () => {
    const made = await rune(gm.token, { action: 'create', solution: [1, 2, 3], hint: '', limit: 4, checkSkill: 'arcana', checkDc: 5 });
    assert.equal(made.statusCode, 200, made.body);
    assert.deepEqual(made.json().game.check, { skill: 'arcana', dc: 5, tried: [] });
    assert.deepEqual((await request('GET', runes, alice.token)).json().actors.map((a: any) => a.name), ['Мудрец', 'Простак']);

    const before = await rolls();
    const tried = await rune(alice.token, { action: 'skill', ring: 1, heroId: sage.id });
    assert.equal(tried.statusCode, 200, tried.body);
    const game = tried.json().game;
    assert.equal(game.revealed[1], true);
    assert.equal(game.rings[1], 2);
    assert.deepEqual(game.check.tried, [{ id: sage.id, name: 'Мудрец' }]);
    assert.match(game.message, /кольцо 2 встало на место/);
    assert.equal(await rolls(), before + 1, 'the check is in the roll log');
    const logged = (await pg.query<{ label: string }>(`SELECT label FROM roll_log WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 1`, [campaignId])).rows[0]!.label;
    assert.match(String(logged), /^Магия: рунный замок/);

    const again = await rune(alice.token, { action: 'skill', ring: 0, heroId: sage.id });
    assert.equal(again.statusCode, 409, 'one try per hero');
    assert.equal((await rune(alice.token, { action: 'skill', ring: 1, heroId: dunce.id })).statusCode, 409, 'that ring is already fixed');
    assert.equal((await rune(alice.token, { action: 'skill', ring: 0, heroId: gmHero.id })).statusCode, 403, 'only one\'s own hero rolls');
    assert.equal(await rolls(), before + 1, 'a refused try rolls nothing');
  });

  await t.test('a failed History check leaves the map without its hint', async () => {
    const path = `${base}/minigames/map-fragments`;
    const made = await request('POST', path, gm.token, { action: 'create', revision: 0, story: 0, checkSkill: 'history', checkDc: 30 });
    assert.equal(made.statusCode, 200, made.body);
    const failed = await request('POST', path, alice.token, { action: 'skill', revision: made.json().game.revision, heroId: dunce.id });
    assert.equal(failed.statusCode, 200, failed.body);
    assert.equal(failed.json().game.hintShown, false);
    assert.equal(failed.json().game.hint, undefined);
    assert.match(failed.json().game.message, /проверка не удалась/);
    const second = await request('POST', path, alice.token, { action: 'skill', revision: failed.json().game.revision, heroId: sage.id });
    assert.equal(second.statusCode, 200, 'another hero still has a try');
    assert.equal(second.json().game.hintShown, false, 'DC 30 is out of reach even for the sage');
    const again = await request('POST', path, alice.token, { action: 'skill', revision: second.json().game.revision, heroId: dunce.id });
    assert.equal(again.statusCode, 409);
    assert.match(again.json().message, /уже была попытка/);
  });

  await t.test('the GM sets how hard it is to hide a dragon, and a turn without a dragon has nothing to hide', async () => {
    const path = `${base}/minigames/dragon-dice`;
    assert.equal((await request('POST', path, alice.token, { action: 'create', revision: 0, cheatDc: 5 })).statusCode, 403);
    const made = await request('POST', path, gm.token, { action: 'create', revision: 0, cheatDc: 8 });
    assert.equal(made.json().game.cheatDc, 8);
    const started = await request('POST', path, gm.token, { action: 'start', revision: made.json().game.revision });
    const before = await rolls();
    const hide = await request('POST', path, gm.token, { action: 'cheat', revision: started.json().game.revision, heroId: gmHero.id });
    assert.equal(hide.statusCode, 409);
    assert.match(hide.json().message, /Прятать нечего/);
    assert.equal(await rolls(), before);
  });
});
