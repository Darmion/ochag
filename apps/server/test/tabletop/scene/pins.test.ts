import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('pins: GM notes attached to points on the map', async t => {
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

  const gm = await register('gm_pins'), reader = await register('reader_pins'), other = await register('other_pins');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Pins'})).json().id;
  for (const member of [reader, other]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Деревня'})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const notesPath = `/campaigns/${campaignId}/notes`;

  const createNote = async (title: string) => {
    await request('POST', notesPath, gm.token, {title, body: `Текст: ${title}`});
    return (await request('GET', notesPath, gm.token)).json().notes.find((n: any) => n.title === title).id;
  };
  const tavern = await createNote('Таверна «Пьяный гусь»');
  const secret = await createNote('Тайный ход');
  assert.equal((await request('POST', `${notesPath}/${tavern}/grants`, gm.token, {username: 'reader_pins'})).statusCode, 201);

  const pinsOf = async (token: string) => (await request('GET', scenePath, token)).json().pins;
  let tavernPin = '';

  await t.test('only the notes GM pins a note to the map', async () => {
    assert.equal((await request('POST', `${scenePath}/pins`, reader.token, {noteId: tavern, x: 1.5, z: 2.5})).statusCode, 403);
    const response = await request('POST', `${scenePath}/pins`, gm.token, {noteId: tavern, x: 1.5, z: 2.5});
    assert.equal(response.statusCode, 201, response.body);
    tavernPin = response.json().id;
    assert.equal(response.json().title, 'Таверна «Пьяный гусь»');
    await request('POST', `${scenePath}/pins`, gm.token, {noteId: secret, x: -3, z: 0});
  });

  await t.test('a pin is seen by whoever can read its note — and nobody else', async () => {
    assert.deepEqual((await pinsOf(gm.token)).map((p: any) => p.title).sort(), ['Таверна «Пьяный гусь»', 'Тайный ход']);
    assert.deepEqual((await pinsOf(reader.token)).map((p: any) => [p.title, p.x, p.z]), [['Таверна «Пьяный гусь»', 1.5, 2.5]]);
    assert.deepEqual(await pinsOf(other.token), []);
  });

  await t.test('pinning a note from another campaign is a 404', async () => {
    const otherCampaign = (await request('POST', '/campaigns', gm.token, {name: 'Other'})).json().id;
    const otherScene = (await request('POST', `/campaigns/${otherCampaign}/scenes`, gm.token, {name: 'X'})).json().id;
    assert.equal((await request('POST', `/campaigns/${otherCampaign}/scenes/${otherScene}/pins`, gm.token, {noteId: tavern, x: 0, z: 0})).statusCode, 404);
  });

  await t.test('only the GM removes a pin; the note itself stays', async () => {
    assert.equal((await request('DELETE', `${scenePath}/pins/${tavernPin}`, reader.token)).statusCode, 403);
    assert.equal((await request('DELETE', `${scenePath}/pins/${tavernPin}`, gm.token)).statusCode, 204);
    assert.deepEqual(await pinsOf(reader.token), []);
    assert.equal((await request('GET', `${notesPath}/${tavern}`, reader.token)).statusCode, 200);
  });

  await t.test('deleting a note takes its pins off every map', async () => {
    assert.equal((await request('DELETE', `${notesPath}/${secret}`, gm.token)).statusCode, 204);
    assert.deepEqual(await pinsOf(gm.token), []);
  });
});
