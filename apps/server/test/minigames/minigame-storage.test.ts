import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.ts';
import { eventForRequest } from '../../src/system/campaign-events.ts';
import { createTestDatabase } from '../helpers.ts';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rune')]);

test('a mini-game outlives a server restart and tells the table when it changes', async t => {
  const { pg, db } = await createTestDatabase();
  t.after(() => pg.close());
  let app = await buildApp(db, { rateMax: 10000 });
  const req = (method: any, url: string, token?: string, payload?: any) => app.inject({ method, url,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}), ...(payload ? { payload } : {}) });
  const gm = (await req('POST', '/auth/register', undefined, { username: 'store_gm', password: 'x' })).json();
  const campaign = (await req('POST', '/campaigns', gm.token, { name: 'Stored games' })).json().id;
  const path = `/campaigns/${campaign}/minigames/alchemy`;

  const created = await req('POST', path, gm.token, { action: 'create', revision: 0, recipe: 1, limit: 8 });
  assert.equal(created.statusCode, 200, created.body);
  const stirred = await req('POST', path, gm.token, { action: 'stir', revision: created.json().game.revision });
  assert.equal(stirred.statusCode, 200, stirred.body);

  await app.close();
  app = await buildApp(db, { rateMax: 10000 });
  t.after(() => app.close());
  const after = (await req('GET', path, gm.token)).json().game;
  assert.deepEqual(after, stirred.json().game, 'the cauldron is where it was before the restart');

  assert.deepEqual(eventForRequest('POST', path), { campaignId: campaign, event: { type: 'minigame', kind: 'alchemy' } });
  assert.equal(eventForRequest('GET', path), null);

  await t.test('a rune picture counts as used, and deleting it everywhere leaves the rune without one', async () => {
    const boundary = '----runeBoundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="rune.png"\r\nContent-Type: image/png\r\n\r\n`),
      png, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const asset = (await app.inject({
      method: 'POST', url: `/campaigns/${campaign}/assets?kind=object_image`,
      headers: { authorization: `Bearer ${gm.token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    })).json().id;
    const symbols = ['Огонь', 'Вода', 'Земля', 'Воздух', 'Свет', 'Тьма'].map((name, index) => ({ name, assetId: index === 0 ? asset : null }));
    const lock = await req('POST', `/campaigns/${campaign}/minigames/rune-lock`, gm.token, { action: 'create', revision: 0, solution: [1, 2, 3], hint: '', limit: 4, symbols });
    assert.equal(lock.statusCode, 200, lock.body);

    const uses = (await req('GET', `/campaigns/${campaign}/assets/usage`, gm.token)).json().assets.find((file: any) => file.id === asset).uses;
    assert.deepEqual(uses, [{ place: 'runeSymbols', name: 'Огонь' }]);
    assert.equal((await req('DELETE', `/campaigns/${campaign}/assets/${asset}?everywhere=1`, gm.token)).statusCode, 204);
    const game = (await req('GET', `/campaigns/${campaign}/minigames/rune-lock`, gm.token)).json().game;
    assert.equal(game.symbols[0].assetId, null);
    assert.equal(game.symbols[0].name, 'Огонь');
  });
});
