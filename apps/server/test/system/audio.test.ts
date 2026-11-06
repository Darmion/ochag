import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {buildApp} from '../../src/app.ts';
import {detectAudio} from '../../src/system/asset-routes.ts';
import {createTestDatabase} from '../helpers.ts';

function multipart(filename: string, content: Buffer) {
  const boundary = '----ttrpgTestBoundaryAudio';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`,
  );
  return {boundary, body: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)])};
}

const fakeMp3 = Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.alloc(40, 1)]);

test('audio signatures are recognised by their first bytes', () => {
  assert.equal(detectAudio(fakeMp3)?.contentType, 'audio/mpeg');
  assert.equal(detectAudio(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(20)]))?.extension, '.mp3');
  assert.equal(detectAudio(Buffer.concat([Buffer.from('OggS', 'ascii'), Buffer.alloc(20)]))?.contentType, 'audio/ogg');
  assert.equal(detectAudio(Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVE', 'ascii'), Buffer.alloc(20)]))?.contentType, 'audio/wav');
  assert.equal(detectAudio(Buffer.concat([Buffer.from('fLaC', 'ascii'), Buffer.alloc(20)]))?.contentType, 'audio/flac');
  assert.equal(detectAudio(Buffer.concat([Buffer.from('\0\0\0\x20ftypM4A ', 'binary'), Buffer.alloc(20)]))?.contentType, 'audio/mp4');
  assert.equal(detectAudio(Buffer.from('definitely not a sound file')), null);
  assert.equal(detectAudio(Buffer.concat([Buffer.from('glTF', 'ascii'), Buffer.alloc(20)])), null);
});

test('campaign music and sound effects', async t => {
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
  const upload = (token: string, content: Buffer) => {
    const {boundary, body} = multipart('tavern.mp3', content);
    return asApp(() => app.inject({
      method: 'POST', url: `/campaigns/${campaignId}/assets?kind=audio`,
      headers: {authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}`},
      payload: body,
    }));
  };
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_audio'), player = await register('player_audio'), second = await register('second_audio');
  const outsider = await register('outsider_audio');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Audio'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', player.token, {code});
  const code2 = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', second.token, {code: code2});
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Таверна'})).json().id;
  const audioPath = `/campaigns/${campaignId}/audio`;

  let trackId = '';

  await t.test('only the GM uploads music, and only real audio is accepted', async () => {
    assert.equal((await upload(player.token, fakeMp3)).statusCode, 403);
    const bad = await upload(gm.token, Buffer.from('not audio at all, just some text here'));
    assert.equal(bad.statusCode, 400);
    assert.match(bad.json().message, /MP3, OGG, WAV/);
    const good = await upload(gm.token, fakeMp3);
    assert.equal(good.statusCode, 201, good.body);
    trackId = good.json().id;
  });

  await t.test('nothing plays at first; the state comes with the server clock', async () => {
    const response = (await request('GET', audioPath, player.token)).json();
    assert.equal(response.state.playing, false);
    assert.equal(response.state.asset_id, null);
    assert.equal(response.canManage, false);
    assert.ok(Math.abs(Date.parse(response.serverNow) - Date.now()) < 5000);
  });

  await t.test('only the GM controls the music', async () => {
    assert.equal((await request('PUT', audioPath, player.token, {action: 'play', assetId: trackId})).statusCode, 403);
    assert.equal((await request('PUT', audioPath, gm.token, {action: 'play'})).statusCode, 400, 'no track chosen yet');
  });

  await t.test('play starts the track for everyone; pause keeps the position; play resumes from it', async () => {
    const played = (await request('PUT', audioPath, gm.token, {action: 'play', assetId: trackId, loop: false, volume: 0.5, fromSeconds: 30})).json();
    assert.equal(played.state.playing, true);
    assert.equal(played.state.asset_name, 'tavern.mp3');
    assert.equal(played.state.volume, 0.5);
    assert.equal(played.state.loop, false);
    const offset = (Date.parse(played.serverNow) - Date.parse(played.state.started_at)) / 1000;
    assert.ok(offset >= 30 && offset < 32, `started 30 s in, got ${offset}`);

    const paused = (await request('PUT', audioPath, gm.token, {action: 'pause'})).json();
    assert.equal(paused.state.playing, false);
    assert.equal(paused.state.started_at, null);
    assert.ok(paused.state.paused_at_seconds >= 30 && paused.state.paused_at_seconds < 32);

    const resumed = (await request('PUT', audioPath, gm.token, {action: 'play'})).json();
    const resumedAt = (Date.parse(resumed.serverNow) - Date.parse(resumed.state.started_at)) / 1000;
    assert.ok(Math.abs(resumedAt - paused.state.paused_at_seconds) < 2, 'resumes where it was paused');

    const stopped = (await request('PUT', audioPath, gm.token, {action: 'stop'})).json();
    assert.deepEqual([stopped.state.playing, stopped.state.paused_at_seconds, stopped.state.asset_id], [false, 0, trackId]);
  });

  await t.test('a queue plays track after track; a stale «track ended» does not skip one', async () => {
    const second = (await upload(gm.token, fakeMp3)).json().id;
    const third = (await upload(gm.token, fakeMp3)).json().id;

    const played = (await request('PUT', audioPath, gm.token, {action: 'play', queue: [trackId, second, third], loop: true})).json();
    assert.deepEqual([played.state.asset_id, played.state.queue], [trackId, [trackId, second, third]]);

    const ended = played.state.revision;
    const next = (await request('PUT', audioPath, gm.token, {action: 'next', revision: ended})).json();
    assert.equal(next.state.asset_id, second);
    const stale = (await request('PUT', audioPath, gm.token, {action: 'next', revision: ended})).json();
    assert.equal(stale.state.asset_id, second, 'the second «ended» changes nothing');

    assert.equal((await request('PUT', audioPath, gm.token, {action: 'next'})).json().state.asset_id, third);
    assert.equal((await request('PUT', audioPath, gm.token, {action: 'next'})).json().state.asset_id, trackId, 'loops back to the start');
    assert.equal((await request('PUT', audioPath, gm.token, {action: 'previous'})).json().state.asset_id, third);

    const last = (await request('PUT', audioPath, gm.token, {action: 'next', loop: false})).json();
    assert.deepEqual([last.state.playing, last.state.asset_id], [false, third]);

    const single = (await request('PUT', audioPath, gm.token, {action: 'play', assetId: second})).json();
    assert.deepEqual(single.state.queue, [trackId, second, third], 'a track from the queue keeps the queue');
    const other = (await upload(gm.token, fakeMp3)).json().id;
    assert.deepEqual((await request('PUT', audioPath, gm.token, {action: 'play', assetId: other})).json().state.queue, [other]);
  });

  await t.test('scene music: the GM keeps a playlist with the scene', async () => {
    const playlistPath = `/campaigns/${campaignId}/scenes/${sceneId}/playlist`;
    assert.equal((await request('PUT', playlistPath, player.token, {tracks: [trackId]})).statusCode, 403);
    assert.equal((await request('PUT', playlistPath, gm.token, {tracks: ['00000000-0000-4000-8000-000000000000']})).statusCode, 400);
    const saved = await request('PUT', playlistPath, gm.token, {tracks: [trackId]});
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json().playlist, [trackId]);
    assert.deepEqual((await request('GET', `/campaigns/${campaignId}/scenes/${sceneId}`, player.token)).json().scene.playlist, [trackId]);
  });

  await t.test('a sound effect is broadcast to everyone at the table, not stored', async () => {
    const wsAddress = (await app.listen({host: '127.0.0.1', port: 0})).replace('http', 'ws');
    const socket = new WebSocket(`${wsAddress}/live`);
    t.after(() => socket.terminate());
    const messages: any[] = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await new Promise(resolve => socket.once('open', resolve));
    socket.send(JSON.stringify({token: player.token, campaignId, sceneId}));
    while (!messages.some(m => m.type === 'ready')) await new Promise(resolve => setTimeout(resolve, 20));

    assert.equal((await request('POST', `${audioPath}/effects`, player.token, {assetId: trackId})).statusCode, 403);
    assert.equal((await request('POST', `${audioPath}/effects`, gm.token, {assetId: trackId})).statusCode, 200);
    await new Promise(resolve => setTimeout(resolve, 200));
    const sound = messages.find(m => m.type === 'sound');
    assert.equal(sound?.assetId, trackId);

    await request('PUT', audioPath, gm.token, {action: 'play', assetId: trackId});
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.ok(messages.some(m => m.type === 'audio'), 'music changes are announced too');
  });

  await t.test('a sound with its own volume and mode can go to chosen players only; «stop» silences the sounds (complaints, item 1)', async () => {
    const wsAddress = `ws://127.0.0.1:${(app.server.address() as {port: number}).port}`;
    const listen = async (token: string) => {
      const socket = new WebSocket(`${wsAddress}/live`);
      t.after(() => socket.terminate());
      const messages: any[] = [];
      socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
      await new Promise(resolve => socket.once('open', resolve));
      socket.send(JSON.stringify({token, campaignId, sceneId}));
      while (!messages.some(m => m.type === 'ready')) await new Promise(resolve => setTimeout(resolve, 20));
      return messages;
    };
    const first = await listen(player.token), other = await listen(second.token), master = await listen(gm.token);
    const userId = player.user.id;
    const outsiderId = outsider.user.id;

    const played = await request('POST', `${audioPath}/effects`, gm.token, {assetId: trackId, volume: 0.4, mode: 'interrupt', userIds: [userId]});
    assert.equal(played.statusCode, 200, played.body);
    await new Promise(resolve => setTimeout(resolve, 250));
    const sound = first.find(m => m.type === 'sound');
    assert.deepEqual([sound?.volume, sound?.mode], [0.4, 'interrupt']);
    assert.ok(!other.some(m => m.type === 'sound' && m.mode === 'interrupt'), 'the other player does not hear it');
    assert.ok(master.some(m => m.type === 'sound' && m.mode === 'interrupt'), 'the GM hears what they sent');
    assert.equal((await request('POST', `${audioPath}/effects`, gm.token, {assetId: trackId, userIds: [outsiderId]})).statusCode, 400, 'only campaign members');
    assert.equal((await request('POST', `${audioPath}/effects`, gm.token, {assetId: trackId, volume: 2})).statusCode, 400);

    assert.equal((await request('POST', `${audioPath}/effects/stop`, player.token, {})).statusCode, 403);
    assert.equal((await request('POST', `${audioPath}/effects/stop`, gm.token, {})).statusCode, 200);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.ok(first.some(m => m.type === 'soundStop') && other.some(m => m.type === 'soundStop'));
  });
});
