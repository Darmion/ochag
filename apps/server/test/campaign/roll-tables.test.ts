import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('random tables', async t => {
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

  const gm = await register('gm_tables'), alice = await register('alice_tables');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Tables'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const tables = `/campaigns/${campaignId}/tables`;
  const rumors = {name: 'Слухи', formula: '1d4', entries: [{from: 1, to: 2, text: 'Мельник видел огни.'}, {from: 3, to: 4, text: 'Караван пропал.'}]};
  let rumorsId = '';
  let forestId = '';

  await t.test('only the GM keeps tables; a broken table is refused with the reason', async () => {
    assert.equal((await request('GET', tables, alice.token)).statusCode, 403);
    assert.equal((await request('POST', tables, alice.token, rumors)).statusCode, 403);
    const gap = await request('POST', tables, gm.token, {...rumors, entries: [{from: 1, to: 2, text: 'а'}]});
    assert.equal(gap.statusCode, 400);
    assert.match(gap.json().message, /Не покрыто: 3–4/);
    assert.equal((await request('POST', tables, gm.token, {name: 'x'})).statusCode, 400);
    const created = await request('POST', tables, gm.token, rumors);
    assert.equal(created.statusCode, 201, created.body);
    rumorsId = created.json().table.id;
    assert.equal(created.json().table.secret, false);
  });

  await t.test('a ready-made table in one click; the list offers the presets', async () => {
    const forest = await request('POST', tables, gm.token, {preset: 'forest-encounters'});
    assert.equal(forest.statusCode, 201, forest.body);
    forestId = forest.json().table.id;
    assert.equal(forest.json().table.secret, true);
    assert.equal(forest.json().table.formula, '1d12');
    assert.equal((await request('POST', tables, gm.token, {preset: 'nope'})).statusCode, 400);
    const listed = (await request('GET', tables, gm.token)).json();
    assert.deepEqual(listed.tables.map((table: any) => table.name).sort(), ['Слухи', 'Случайная встреча в лесу (уровни 1–4)']);
    assert.ok(listed.presets.some((preset: any) => preset.id === 'tavern-rumors'));
  });

  await t.test('editing checks the revision and the table again', async () => {
    assert.equal((await request('PUT', `${tables}/${rumorsId}`, gm.token, {name: 'Слухи у колодца', revision: 2})).statusCode, 409);
    assert.equal((await request('PUT', `${tables}/${rumorsId}`, gm.token, {formula: '1d6', revision: 1})).statusCode, 400, 'rows no longer cover 5–6');
    const edited = await request('PUT', `${tables}/${rumorsId}`, gm.token, {name: 'Слухи у колодца', revision: 1});
    assert.equal(edited.statusCode, 200, edited.body);
    assert.equal(edited.json().table.revision, 2);
  });

  await t.test('a roll lands on its row and in the journal; a secret table is seen by the GM only', async () => {
    const rolled = await request('POST', `${tables}/${rumorsId}/roll`, gm.token);
    assert.equal(rolled.statusCode, 201, rolled.body);
    const {roll, entry} = rolled.json();
    assert.ok(roll.total >= 1 && roll.total <= 4);
    assert.equal(entry.text, roll.total <= 2 ? 'Мельник видел огни.' : 'Караван пропал.');
    assert.equal(roll.label, 'Таблица: Слухи у колодца');
    assert.equal(roll.outcome.kind, 'table');

    const secret = (await request('POST', `${tables}/${forestId}/roll`, gm.token)).json();
    const seenByAlice = (await request('GET', `/campaigns/${campaignId}/rolls`, alice.token)).json().rolls.map((r: any) => r.id);
    assert.ok(seenByAlice.includes(roll.id));
    assert.ok(!seenByAlice.includes(secret.roll.id), 'random encounters stay secret');
    assert.equal((await request('POST', `${tables}/${forestId}/roll`, alice.token)).statusCode, 403);
  });

  await t.test('an encounter row rolls how many monsters there are', async () => {
    const pack = await request('POST', tables, gm.token, {
      name: 'Стая', formula: '1d2', entries: [{from: 1, to: 2, text: 'Волки!', monsters: [{index: 'wolf', count: '3'}, {index: 'dire-wolf', count: '1d1'}]}],
    });
    assert.equal(pack.statusCode, 201, pack.body);
    const rolled = (await request('POST', `${tables}/${pack.json().table.id}/roll`, gm.token)).json();
    assert.deepEqual(rolled.monsters, [{index: 'wolf', nameRu: 'Волк', count: 3}, {index: 'dire-wolf', nameRu: 'Лютоволк', count: 1}]);
    assert.deepEqual(rolled.roll.outcome.monsters, rolled.monsters);
    assert.equal((await request('POST', tables, gm.token, {name: 'Чудо', formula: '1d2', entries: [{from: 1, to: 2, text: 'x', monsters: [{index: 'tarrasque', count: '1'}]}]})).statusCode, 400);
  });

  await t.test('deleting a table', async () => {
    assert.equal((await request('DELETE', `${tables}/${rumorsId}`, gm.token)).statusCode, 204);
    assert.equal((await request('POST', `${tables}/${rumorsId}/roll`, gm.token)).statusCode, 404);
    assert.equal((await request('DELETE', `${tables}/${rumorsId}`, gm.token)).statusCode, 404);
  });
});
