import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('mood music: combat in, combat out', async t => {
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

  const gm = await register('gm_mood'), alice = await register('alice_mood');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Mood'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Лес'})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const track = async (name: string) => (await pg.query<any>(
    `INSERT INTO assets (campaign_id, kind, content_type, byte_size, storage_key, uploaded_by, original_filename) VALUES ($1,'audio','audio/wav',10,$2,$3,$2) RETURNING id`,
    [campaignId, name, gm.user.id],
  )).rows[0].id as string;
  const calm = await track('calm.wav'), battle = await track('battle.wav'), dread = await track('dread.wav');
  const audio = async () => (await request('GET', `${base}/audio`, alice.token)).json().state;

  await t.test('the GM collects playlists per mood; a mood without music is refused', async () => {
    assert.equal((await request('PUT', `${scenePath}/playlist`, gm.token, {tracks: [calm]})).statusCode, 200);
    assert.equal((await request('PUT', `${scenePath}/playlists`, alice.token, {mood: 'combat', tracks: [battle]})).statusCode, 403);
    assert.equal((await request('POST', `${base}/audio/mood`, gm.token, {sceneId, mood: 'combat'})).statusCode, 400, 'no combat music yet');
    const set = await request('PUT', `${scenePath}/playlists`, gm.token, {mood: 'combat', tracks: [battle]});
    assert.deepEqual(set.json().playlists, {combat: [battle]});
    await request('PUT', `${scenePath}/playlists`, gm.token, {mood: 'tension', tracks: [dread]});
    assert.deepEqual((await request('GET', scenePath, gm.token)).json().scene.mood_playlists, {combat: [battle], tension: [dread]});
  });

  await t.test('exploring music plays; the fight starts — combat music, the fight ends — back where it was', async () => {
    assert.equal((await request('POST', `${base}/audio/mood`, gm.token, {sceneId, mood: 'explore'})).statusCode, 200);
    await pg.query(`UPDATE campaign_audio SET started_at = now() - interval '60 seconds' WHERE campaign_id=$1`, [campaignId]);
    assert.deepEqual([(await audio()).asset_id, (await audio()).mood], [calm, 'explore']);

    const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Лиэна'})).json();
    await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id});
    assert.equal((await request('POST', `${scenePath}/initiative/join`, alice.token, {characterId: hero.id})).statusCode, 201);
    const fighting = await audio();
    assert.deepEqual([fighting.asset_id, fighting.mood, fighting.playing], [battle, 'combat', true]);

    assert.equal((await request('DELETE', `${scenePath}/initiative`, gm.token)).statusCode, 204);
    const after = await audio();
    assert.deepEqual([after.asset_id, after.mood, after.playing, after.resume], [calm, 'explore', true, null]);
    const position = (Date.now() - new Date(after.started_at).getTime()) / 1000;
    assert.ok(position >= 59 && position < 75, `the calm track goes on from about a minute in: ${position}`);
  });

  await t.test('tension by hand; stopping forgets what to return to', async () => {
    assert.equal((await request('POST', `${base}/audio/mood`, gm.token, {sceneId, mood: 'tension'})).json().state.asset_id, dread);
    await request('POST', `${base}/audio/mood`, gm.token, {sceneId, mood: 'combat'});
    assert.equal((await audio()).resume.asset_id, dread);
    await request('PUT', `${base}/audio`, gm.token, {action: 'stop'});
    assert.equal((await audio()).resume, null);
  });

  await t.test('scene music belongs to its scene; music for everyone has no scene', async () => {
    const otherScene = (await request('POST', `${base}/scenes`, gm.token, {name: 'Город'})).json().id;
    await request('POST', `${base}/audio/mood`, gm.token, {sceneId, mood: 'explore'});
    const forest = await audio();
    assert.deepEqual([forest.asset_id, forest.scene_id, forest.scene_name], [calm, sceneId, null], 'the player gets no scene name');
    assert.equal((await request('GET', `${base}/audio`, gm.token)).json().state.scene_name, 'Лес', 'the GM does');

    await request('PUT', `${base}/audio`, gm.token, {action: 'pause'});
    await request('PUT', `${base}/audio`, gm.token, {action: 'play', volume: 0.5});
    assert.equal((await audio()).scene_id, sceneId);

    await request('PUT', `${base}/audio`, gm.token, {action: 'play', assetId: dread, sceneId: null});
    assert.deepEqual([(await audio()).asset_id, (await audio()).scene_id], [dread, null]);
    await request('PUT', `${base}/audio`, gm.token, {action: 'play', sceneId: otherScene});
    assert.equal((await audio()).scene_id, otherScene);
    assert.equal((await request('PUT', `${base}/audio`, gm.token, {action: 'play', sceneId: '00000000-0000-4000-8000-000000000000'})).statusCode, 404);

    const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Тирион'})).json();
    await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id});
    await request('POST', `${scenePath}/initiative/join`, alice.token, {characterId: hero.id});
    assert.deepEqual([(await audio()).asset_id, (await audio()).scene_id], [battle, sceneId]);
    await request('DELETE', `${scenePath}/initiative`, gm.token);
    assert.deepEqual([(await audio()).asset_id, (await audio()).scene_id], [dread, otherScene]);
  });
});
