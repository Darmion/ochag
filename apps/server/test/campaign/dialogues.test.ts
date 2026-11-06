import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('dialogues with NPCs', async t => {
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

  const gm = await register('gm_talk'), alice = await register('alice_talk'), bob = await register('bob_talk');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Talk'})).json().id;
  for (const player of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', player.token, {code});
  }
  const base = `/campaigns/${campaignId}`;
  const keeper = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Трактирщик', disposition: 'neutral'})).json();
  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Лиэна'})).json();
  await pg.query('UPDATE characters SET charisma=30 WHERE id=$1', [hero.id]);

  const nodes = [
    {id: 'start', text: 'Чего надо?', options: [
      {id: 'ask', label: 'Где барон?', next: 'baron'},
      {id: 'press', label: 'Говори, или пожалеешь.', next: null, check: {skill: 'intimidation', dc: 2, success: 'baron', failure: 'angry'}},
      {id: 'bye', label: 'Ничего.', next: null},
    ]},
    {id: 'baron', speaker: null, text: 'Уехал к мельнице.', options: [{id: 'thanks', label: 'Спасибо.', next: null}]},
    {id: 'angry', text: 'Вон отсюда!', options: [{id: 'leave', label: 'Уйти.', next: null}]},
  ];
  let dialogueId = '';
  const current = async (token = alice.token) => (await request('GET', `${base}/dialogue`, token)).json();

  await t.test('only the GM prepares a dialogue; a broken tree is refused with a reason', async () => {
    assert.equal((await request('POST', `${base}/dialogues`, alice.token, {title: 'Таверна', nodes, startNode: 'start'})).statusCode, 403);
    const broken = await request('POST', `${base}/dialogues`, gm.token, {title: 'Таверна', nodes: [{id: 'start', text: 'Да?', options: [{id: 'x', label: 'Дальше', next: 'nowhere'}]}], startNode: 'start'});
    assert.equal(broken.statusCode, 400);
    assert.match(broken.json().message, /nowhere/);
    const created = await request('POST', `${base}/dialogues`, gm.token, {title: 'Таверна', npcId: keeper.id, nodes, startNode: 'start'});
    assert.equal(created.statusCode, 201, created.body);
    dialogueId = created.json().dialogue.id;
    assert.equal((await request('GET', `${base}/dialogues`, alice.token)).statusCode, 403);
  });

  await t.test('the GM starts it: everyone sees the keeper’s words and the answers, players without the DC', async () => {
    assert.deepEqual(await current(), {active: false});
    assert.equal((await request('POST', `${base}/dialogues/${dialogueId}/start`, gm.token)).statusCode, 200);
    const view = await current();
    assert.equal(view.node.speaker, 'Трактирщик');
    assert.equal(view.node.text, 'Чего надо?');
    assert.deepEqual(view.node.options.map((o: any) => o.label), ['Где барон?', 'Говори, или пожалеешь.', 'Ничего.']);
    assert.deepEqual(view.node.options[1].check, {skill: 'intimidation', label: 'Запугивание'});
    assert.equal((await current(gm.token)).node.options[1].check.dc, 2, 'the GM sees the DC');
  });

  await t.test('an answer with a check is rolled by the chosen character and leads its way', async () => {
    const noActor = await request('POST', `${base}/dialogue/choose`, alice.token, {nodeId: 'start', optionId: 'press'});
    assert.equal(noActor.statusCode, 400, 'who answers?');
    assert.equal((await request('POST', `${base}/dialogue/choose`, bob.token, {nodeId: 'start', optionId: 'press', characterId: hero.id})).statusCode, 403, 'not his character');
    const pressed = await request('POST', `${base}/dialogue/choose`, alice.token, {nodeId: 'start', optionId: 'press', characterId: hero.id});
    assert.equal(pressed.statusCode, 200, pressed.body);
    assert.equal(pressed.json().success, true);
    const view = await current(bob.token);
    assert.equal(view.node.text, 'Уехал к мельнице.');
    assert.equal(view.history[0].answer, 'Говори, или пожалеешь.');
    assert.equal(view.history[0].by, 'Лиэна');
    assert.equal(view.history[0].check, 'Запугивание');
    const rolls = (await request('GET', `${base}/rolls`, alice.token)).json().rolls.map((r: any) => r.label);
    assert.ok(rolls.includes('Запугивание: Таверна'), rolls.join(' | '));
  });

  await t.test('two clicks at once: the late one is about the previous line; an ending answer ends it', async () => {
    assert.equal((await request('POST', `${base}/dialogue/choose`, bob.token, {nodeId: 'start', optionId: 'ask'})).statusCode, 409);
    const thanks = await request('POST', `${base}/dialogue/choose`, bob.token, {nodeId: 'baron', optionId: 'thanks'});
    assert.equal(thanks.json().ended, true);
    assert.deepEqual(await current(), {active: false});
  });

  await t.test('the GM can end it at any time; deleting a dialogue ends it too', async () => {
    await request('POST', `${base}/dialogues/${dialogueId}/start`, gm.token);
    assert.equal((await request('POST', `${base}/dialogue/end`, alice.token)).statusCode, 403);
    assert.equal((await request('POST', `${base}/dialogue/end`, gm.token)).statusCode, 200);
    await request('POST', `${base}/dialogues/${dialogueId}/start`, gm.token);
    const stale = await request('PUT', `${base}/dialogues/${dialogueId}`, gm.token, {title: 'Таверна у моста', revision: 99});
    assert.equal(stale.statusCode, 409);
    const renamed = await request('PUT', `${base}/dialogues/${dialogueId}`, gm.token, {title: 'Таверна у моста', revision: 1});
    assert.equal(renamed.json().dialogue.title, 'Таверна у моста');
    assert.equal((await request('DELETE', `${base}/dialogues/${dialogueId}`, gm.token)).statusCode, 204);
    assert.deepEqual(await current(), {active: false});
  });
});
