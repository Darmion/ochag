import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('scene counters and round timers', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db);
  t.after(() => app.close());

  const request = async (method: any, url: string, token?: string, payload?: any) => {
    await pg.exec('SET ROLE ttrpg_app');
    try {
      return await app.inject({
        method, url,
        ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}),
        ...(payload !== undefined ? {payload} : {}),
      });
    } finally {
      await pg.exec('RESET ROLE');
    }
  };
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_counters'), player = await register('player_counters'), other = await register('other_counters');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Counters'})).json().id;
  for (const member of [player, other]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Святилище'})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const countersSeenBy = async (token: string) =>
    Object.fromEntries((await request('GET', scenePath, token)).json().counters.map((c: any) => [c.name, c.value]));

  let ritualId = '', blessId = '', trapId = '';

  await t.test('anyone at the table adds counters; hidden ones stay with their author and the GM', async () => {
    const ritual = await request('POST', `${scenePath}/counters`, gm.token, {name: 'Ритуал', kind: 'rounds', value: 2});
    assert.equal(ritual.statusCode, 201, ritual.body);
    ritualId = ritual.json().id;
    blessId = (await request('POST', `${scenePath}/counters`, player.token, {name: 'Благословение', kind: 'rounds', value: 10})).json().id;
    trapId = (await request('POST', `${scenePath}/counters`, gm.token, {name: 'Заряды ловушки', kind: 'counter', value: 3, hidden: true})).json().id;

    assert.deepEqual(await countersSeenBy(gm.token), {'Ритуал': 2, 'Благословение': 10, 'Заряды ловушки': 3});
    assert.deepEqual(await countersSeenBy(other.token), {'Ритуал': 2, 'Благословение': 10});

    const me = (await request('GET', scenePath, player.token)).json().counters;
    assert.deepEqual(me.map((c: any) => [c.name, c.can_edit]), [['Ритуал', false], ['Благословение', true]]);

    assert.equal((await request('POST', `${scenePath}/counters`, gm.token, {name: 'Пусто', kind: 'rounds', value: 0})).statusCode, 400);
  });

  await t.test('only the author or a GM changes a counter', async () => {
    assert.equal((await request('PATCH', `${scenePath}/counters/${blessId}`, other.token, {delta: -1})).statusCode, 403);
    assert.equal((await request('PATCH', `${scenePath}/counters/${trapId}`, player.token, {delta: -1})).statusCode, 404, 'a hidden counter does not exist for others');

    const decremented = await request('PATCH', `${scenePath}/counters/${trapId}`, gm.token, {delta: -1});
    assert.equal(decremented.statusCode, 200, decremented.body);
    assert.equal(decremented.json().value, 2);

    const own = await request('PATCH', `${scenePath}/counters/${blessId}`, player.token, {value: 9, name: 'Благословение жреца'});
    assert.deepEqual([own.json().name, own.json().value], ['Благословение жреца', 9]);
    assert.equal((await request('PATCH', `${scenePath}/counters/${blessId}`, gm.token, {delta: 1})).json().value, 10, 'the GM edits anyone’s');

    assert.equal((await request('PATCH', `${scenePath}/counters/${ritualId}`, gm.token, {delta: -50})).json().value, 0);
    assert.equal((await request('PATCH', `${scenePath}/counters/${ritualId}`, gm.token, {value: 2})).json().value, 2);
  });

  await t.test('a new initiative round ticks round timers down to zero, not plain counters', async () => {
    const initiative = `${scenePath}/initiative`;
    await request('POST', `${initiative}/npc`, gm.token, {name: 'Культист', score: 15});
    await request('POST', `${initiative}/npc`, gm.token, {name: 'Страж', score: 10});

    const advance = () => request('POST', `${initiative}/advance`, gm.token);
    await advance();
    await advance();
    assert.deepEqual(await countersSeenBy(gm.token), {'Ритуал': 2, 'Благословение жреца': 10, 'Заряды ловушки': 2});

    await advance();
    assert.deepEqual(await countersSeenBy(gm.token), {'Ритуал': 1, 'Благословение жреца': 9, 'Заряды ловушки': 2});

    await advance();
    await advance();
    await advance();
    await advance();
    assert.deepEqual(await countersSeenBy(gm.token), {'Ритуал': 0, 'Благословение жреца': 7, 'Заряды ловушки': 2});
  });

  await t.test('removing counters', async () => {
    assert.equal((await request('DELETE', `${scenePath}/counters/${ritualId}`, player.token)).statusCode, 403);
    assert.equal((await request('DELETE', `${scenePath}/counters/${blessId}`, player.token)).statusCode, 204);
    assert.equal((await request('DELETE', `${scenePath}/counters/${ritualId}`, gm.token)).statusCode, 204);
    assert.deepEqual(await countersSeenBy(gm.token), {'Заряды ловушки': 2});
  });
});
