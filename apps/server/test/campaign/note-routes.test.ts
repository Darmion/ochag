import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('GM notes: campaign-scoped, read-only grants by username', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());

  const app = await buildApp(db);
  t.after(() => app.close());

  const request = async (method: any, url: string, token?: string, payload?: any) =>
    app.inject({
      method, url,
      ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}),
      ...(payload !== undefined ? {payload} : {}),
    });

  const password = 'Local test password 123!';

  const register = async (username: string) => {
    const response = await request('POST', '/auth/register', undefined, {username, password, displayName: username});
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };

  const owner = await register('gm_notes'), player = await register('player_notes'), bystander = await register('bystander_notes');

  const campaignId = (await request('POST', '/campaigns', owner.token, {name: 'Notes test'})).json().id;

  const join = async (token: string) => {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, owner.token)).json().code;
    assert.equal((await request('POST', '/campaigns/join', token, {code})).statusCode, 201);
  };
  await join(player.token);
  await join(bystander.token);

  const notesPath = () => `/campaigns/${campaignId}/notes`;

  await t.test('a bystander cannot create a note', async () => {
    assert.equal((await request('POST', notesPath(), bystander.token, {title: 'Secret plan'})).statusCode, 403);
  });

  await t.test('an ordinary participant sees an empty, non-manager list', async () => {
    const response = await request('GET', notesPath(), bystander.token);
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {canManage: false, notes: []});
  });

  let noteId = '';

  await t.test('the owner (GM) creates a note', async () => {
    const response = await request('POST', notesPath(), owner.token, {title: 'Secret plan', body: 'The dragon is a lich.'});
    assert.equal(response.statusCode, 201, response.body);
    noteId = response.json().id;
    assert.equal(response.json().body, 'The dragon is a lich.');
  });

  const notePath = () => `${notesPath()}/${noteId}`;

  await t.test('an unrelated participant does not see the note at all, in the list or directly', async () => {
    const list = (await request('GET', notesPath(), bystander.token)).json();
    assert.equal(list.canManage, false);
    assert.deepEqual(list.notes, []);
    assert.equal((await request('GET', notePath(), bystander.token)).statusCode, 403);
  });

  await t.test('the manager list includes the note with an empty grant list and canManage:true', async () => {
    const list = (await request('GET', notesPath(), owner.token)).json();
    assert.equal(list.canManage, true);
    assert.deepEqual(list.notes, [{id: noteId, title: 'Secret plan', created_by: owner.user.id, revision: 1, grantedUsers: []}]);
  });

  await t.test('granting to an unknown login is rejected', async () => {
    assert.equal(
      (await request('POST', `${notePath()}/grants`, owner.token, {username: 'nobody_here'})).statusCode,
      404,
    );
  });

  await t.test('a bystander cannot grant access to the note', async () => {
    assert.equal(
      (await request('POST', `${notePath()}/grants`, bystander.token, {username: 'player_notes'})).statusCode,
      403,
    );
  });

  await t.test('the GM grants the player read access by username', async () => {
    const response = await request('POST', `${notePath()}/grants`, owner.token, {username: 'player_notes'});
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().granted, true);
  });

  await t.test('the granted player can now read the note in full', async () => {
    const list = (await request('GET', notesPath(), player.token)).json();
    assert.equal(list.canManage, false);
    assert.deepEqual(list.notes, [{id: noteId, title: 'Secret plan', created_by: owner.user.id, revision: 1}]);

    const full = (await request('GET', notePath(), player.token)).json();
    assert.equal(full.body, 'The dragon is a lich.');
  });

  await t.test('the granted player cannot edit or delete the note — read access only', async () => {
    assert.equal(
      (await request('PATCH', notePath(), player.token, {revision: 1, body: 'hacked'})).statusCode,
      403,
    );
    assert.equal((await request('DELETE', notePath(), player.token)).statusCode, 403);
  });

  await t.test('a stale revision is rejected for the manager too', async () => {
    assert.equal(
      (await request('PATCH', notePath(), owner.token, {revision: 99, body: 'x'})).statusCode,
      409,
    );
  });

  await t.test('the GM edits the note, and the granted player sees the update', async () => {
    const response = await request('PATCH', notePath(), owner.token, {revision: 1, body: 'The dragon is a lich. Also: watch the well.'});
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().revision, 2);

    const asPlayer = (await request('GET', notePath(), player.token)).json();
    assert.equal(asPlayer.body, 'The dragon is a lich. Also: watch the well.');
  });

  await t.test('revoking access removes visibility again', async () => {
    assert.equal((await request('DELETE', `${notePath()}/grants/${player.user.id}`, owner.token)).statusCode, 204);
    assert.equal((await request('GET', notePath(), player.token)).statusCode, 403);
    assert.deepEqual((await request('GET', notesPath(), player.token)).json().notes, []);
  });

  await t.test('deleting the note removes it and its grants', async () => {
    await request('POST', `${notePath()}/grants`, owner.token, {username: 'player_notes'});
    assert.equal((await request('DELETE', notePath(), owner.token)).statusCode, 204);
    assert.equal((await request('GET', notesPath(), owner.token)).json().notes.length, 0);
  });
});
