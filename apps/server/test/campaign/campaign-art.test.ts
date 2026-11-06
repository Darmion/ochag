import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

function multipart(filename: string, content: Buffer) {
  const boundary = '----ttrpgArtBoundary';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`);
  return {boundary, body: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)])};
}

test('campaign art: the GM sets pictures for everyone, own sprites', async t => {
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
  const upload = (token: string, campaignId: string, filename: string) => {
    const {boundary, body} = multipart(filename, PNG);
    return asApp(() => app.inject({
      method: 'POST', url: `/campaigns/${campaignId}/assets?kind=art_sprite`,
      headers: {authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}`},
      payload: body,
    }));
  };
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_art'), alice = await register('alice_art'), stranger = await register('stranger_art');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Art'})).json().id;
  const otherCampaign = (await request('POST', '/campaigns', gm.token, {name: 'Other art'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}/art`;

  const wsAddress = (await app.listen({host: '127.0.0.1', port: 0})).replace('http', 'ws');
  const aliceMessages: any[] = [];
  const socket = new WebSocket(`${wsAddress}/live`);
  t.after(() => socket.terminate());
  socket.on('message', raw => aliceMessages.push(JSON.parse(raw.toString())));
  await new Promise(resolve => socket.once('open', resolve));
  socket.send(JSON.stringify({token: alice.token, campaignId, sceneId: null}));
  while (!aliceMessages.some(m => m.type === 'ready')) await new Promise(resolve => setTimeout(resolve, 20));

  let spriteId = '';

  await t.test('only campaign members read it; only the GM changes it', async () => {
    assert.equal((await request('GET', base, stranger.token)).statusCode, 404);
    const empty = (await request('GET', base, alice.token)).json();
    assert.deepEqual(empty, {overrides: {}, sprites: [], canManage: false});
    assert.equal((await request('GET', base, gm.token)).json().canManage, true);
    assert.equal((await request('PUT', base, alice.token, {key: 'item:длинный меч', value: 'items/weapons/swords/katana'})).statusCode, 403);
  });

  await t.test('a library picture, «none», bad keys and values', async () => {
    const set = await request('PUT', base, gm.token, {key: 'item:длинный меч', value: 'items/weapons/swords/katana'});
    assert.equal(set.statusCode, 200, set.body);
    assert.deepEqual(set.json().overrides, {'item:длинный меч': 'items/weapons/swords/katana'});
    assert.equal((await request('PUT', base, gm.token, {key: 'school:Evocation', value: 'none'})).statusCode, 200);
    assert.equal((await request('PUT', base, gm.token, {key: 'rarity:very_rare', value: 'ui/frames/slot-gold-ornate'})).statusCode, 200);
    for (const [key, value] of [
      ['weapon:longsword', 'items/weapons/swords/katana'],
      ['school:Evo cation', 'none'],
      ['item:x', 'https://example.com/a.png'],
      ['item:x', '../../etc/passwd'],
      ['item:x', 'asset:00000000-0000-4000-8000-000000000000'],
    ]) {
      assert.equal((await request('PUT', base, gm.token, {key, value})).statusCode, 400, `${key} = ${value}`);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.ok(aliceMessages.some(m => m.type === 'art'), 'players are told to reload the look');
    assert.deepEqual((await request('GET', base, alice.token)).json().overrides, {
      'item:длинный меч': 'items/weapons/swords/katana', 'rarity:very_rare': 'ui/frames/slot-gold-ornate', 'school:Evocation': 'none',
    });
    assert.equal((await request('PUT', base, gm.token, {key: 'school:Evocation', value: null})).statusCode, 200);
    assert.equal((await request('GET', base, alice.token)).json().overrides['school:Evocation'], undefined);
  });

  await t.test('own sprites: the GM uploads, a player cannot; another campaign\'s sprite is refused', async () => {
    assert.equal((await upload(alice.token, campaignId, 'mace.png')).statusCode, 403);
    const uploaded = await upload(gm.token, campaignId, 'Булава.png');
    assert.equal(uploaded.statusCode, 201, uploaded.body);
    spriteId = uploaded.json().id;
    const foreign = (await upload(gm.token, otherCampaign, 'foreign.png')).json().id;
    assert.equal((await request('PUT', base, gm.token, {key: 'item:булава', value: `asset:${foreign}`})).statusCode, 400);
    const set = await request('PUT', base, gm.token, {key: 'item:булава', value: `asset:${spriteId}`});
    assert.equal(set.statusCode, 200, set.body);
    const look = (await request('GET', base, alice.token)).json();
    assert.deepEqual(look.sprites.map((s: any) => [s.id, s.label]), [[spriteId, 'Булава']]);
    assert.equal(look.overrides['item:булава'], `asset:${spriteId}`);
    const picture = await request('GET', `/campaigns/${campaignId}/assets/${spriteId}`, alice.token);
    assert.equal(picture.statusCode, 200);
    assert.equal(picture.headers['content-type'], 'image/png');
  });

  await t.test('deleting a sprite drops the pictures that used it; «reset all» keeps the sprites', async () => {
    assert.equal((await request('DELETE', `${base}/sprites/${spriteId}`, alice.token)).statusCode, 403);
    const second = (await upload(gm.token, campaignId, 'Щит.png')).json().id;
    await request('PUT', base, gm.token, {key: 'item:щит', value: `asset:${second}`});
    const removed = await request('DELETE', `${base}/sprites/${spriteId}`, gm.token);
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(removed.json().overrides['item:булава'], undefined);
    assert.deepEqual(removed.json().sprites.map((s: any) => s.id), [second]);
    assert.equal((await request('GET', `/campaigns/${campaignId}/assets/${spriteId}`, gm.token)).statusCode, 404);
    assert.equal((await request('DELETE', base, alice.token)).statusCode, 403);
    const reset = await request('DELETE', base, gm.token);
    assert.equal(reset.statusCode, 200);
    assert.deepEqual(reset.json().overrides, {});
    assert.deepEqual(reset.json().sprites.map((s: any) => s.id), [second]);
    await request('DELETE', `${base}/sprites/${second}`, gm.token);
  });
});
