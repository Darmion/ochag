import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

type Live = {
  send(message: unknown): void;
  waitFor(predicate: (message: any) => boolean, timeout?: number): Promise<any>;
  messages: any[];
  close(): void;
};

test('live dragging, shared control and tug of war', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db);
  t.after(() => app.close());

  const request = (method: any, url: string, token?: string, payload?: any) => app.inject({
    method, url,
    ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}),
    ...(payload !== undefined ? {payload} : {}),
  });
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_live'), owner = await register('owner_live'), helper = await register('helper_live'), watcher = await register('watcher_live');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Live'})).json().id;
  for (const player of [owner, helper, watcher]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', player.token, {code});
  }
  await db.query(
    `INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'party_vision','flag','Обзор отряда','false'::jsonb,$2)`,
    [campaignId, gm.user.id],
  );
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Арена'})).json().id;
  const characterId = (await db.query(`INSERT INTO characters(campaign_id, owner_user_id, name) VALUES($1,$2,'Канат') RETURNING id`, [campaignId, owner.user.id])).rows[0]!.id;
  const tokenId = (await db.query(`INSERT INTO scene_objects(campaign_id, scene_id, character_id, x, z, created_by) VALUES($1,$2,$3,0.5,0.5,$4) RETURNING id`, [campaignId, sceneId, characterId, owner.user.id])).rows[0]!.id;
  const barrelId = (await db.query(`INSERT INTO characters(campaign_id, owner_user_id, name, kind) VALUES($1,$2,'Бочка','object') RETURNING id`, [campaignId, owner.user.id])).rows[0]!.id;
  const objectId = (await db.query(`INSERT INTO scene_objects(campaign_id, scene_id, character_id, x, y, z, snap_to_grid, created_by) VALUES($1,$2,$3,2.5,0,2.5,false,$4) RETURNING id`, [campaignId, sceneId, barrelId, owner.user.id])).rows[0]!.id;

  const wsAddress = (await app.listen({host: '127.0.0.1', port: 0})).replace('http', 'ws');
  const connect = async (token: string): Promise<Live> => {
    const socket = new WebSocket(`${wsAddress}/live`);
    const messages: any[] = [];
    const waiters: Array<{predicate: (m: any) => boolean; resolve: (m: any) => void}> = [];
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      messages.push(message);
      for (const waiter of [...waiters]) {
        if (waiter.predicate(message)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
    await new Promise(resolve => socket.once('open', resolve));
    const live: Live = {
      messages,
      send: message => socket.send(JSON.stringify(message)),
      waitFor: (predicate, timeout = 3000) => new Promise((resolve, reject) => {
        const found = messages.find(predicate);
        if (found) return resolve(found);
        const timer = setTimeout(() => reject(new Error('Timed out waiting for live message')), timeout);
        waiters.push({predicate, resolve: message => { clearTimeout(timer); resolve(message); }});
      }),
      close: () => socket.close(),
    };
    live.send({token, campaignId, sceneId});
    await live.waitFor(m => m.type === 'ready');
    return live;
  };

  const gmLive = await connect(gm.token), ownerLive = await connect(owner.token), helperLive = await connect(helper.token), watcherLive = await connect(watcher.token);
  t.after(() => [gmLive, ownerLive, helperLive, watcherLive].forEach(live => live.close()));
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const tokenPose = (m: any) => m.type === 'pose' && m.id === tokenId;

  await t.test('someone else cannot grab a private character token', async () => {
    helperLive.send({type: 'grab', kind: 'object', id: tokenId});
    const denied = await helperLive.waitFor(m => m.type === 'grab-denied' && m.id === tokenId);
    assert.match(denied.message, /общим/);
  });

  await t.test('the owner drags live; the GM sees it, a player in the fog does not', async () => {
    ownerLive.send({type: 'grab', kind: 'object', id: tokenId});
    await sleep(100);
    ownerLive.send({type: 'pull', kind: 'object', id: tokenId, x: 3.2, y: 0, z: 0.5});
    const seen = await gmLive.waitFor(m => tokenPose(m) && m.x > 1);
    assert.deepEqual(seen.holders.map((h: any) => h.displayName), ['owner_live']);
    ownerLive.send({type: 'release', kind: 'object', id: tokenId});
    const final = await gmLive.waitFor(m => tokenPose(m) && m.final);
    assert.equal(final.x, 3.5, 'snapped to the cell centre on release');
    assert.ok(!watcherLive.messages.some(tokenPose), 'a player without vision of the cell gets no live pose');
    assert.deepEqual((await db.query('SELECT x, z FROM scene_objects WHERE id=$1', [tokenId])).rows[0], {x: 3.5, z: 0.5});
    await gmLive.waitFor(m => m.type === 'changed');
  });

  await t.test('a shared character can be pulled by two players at once: forces add up', async () => {
    assert.equal((await request('PATCH', `/campaigns/${campaignId}/characters/${characterId}/shared`, helper.token, {shared: true})).statusCode, 403);
    assert.equal((await request('PATCH', `/campaigns/${campaignId}/characters/${characterId}/shared`, owner.token, {shared: true})).statusCode, 200);

    gmLive.messages.length = 0;
    ownerLive.send({type: 'grab', kind: 'object', id: tokenId});
    helperLive.send({type: 'grab', kind: 'object', id: tokenId});
    await gmLive.waitFor(m => tokenPose(m) && m.holders.length === 2);

    ownerLive.send({type: 'pull', kind: 'object', id: tokenId, x: 8.5, y: 0, z: 0.5});
    helperLive.send({type: 'pull', kind: 'object', id: tokenId, x: -1.5, y: 0, z: 0.5});
    await sleep(400);
    const balanced = gmLive.messages.filter(tokenPose).at(-1);
    assert.ok(Math.abs(balanced.x - 3.5) < 0.05, `balanced tug stays in place, got ${balanced.x}`);

    ownerLive.send({type: 'pull', kind: 'object', id: tokenId, x: 9.5, y: 0, z: 0.5});
    const won = await gmLive.waitFor(m => tokenPose(m) && m.x > 3.8);
    assert.ok(won.x < 9.5);

    ownerLive.send({type: 'release', kind: 'object', id: tokenId});
    await sleep(100);
    assert.equal((await db.query('SELECT x FROM scene_objects WHERE id=$1', [tokenId])).rows[0]!.x, 3.5, 'nothing is saved while someone still holds it');
    helperLive.send({type: 'release', kind: 'object', id: tokenId});
    const final = await gmLive.waitFor(m => tokenPose(m) && m.final);
    assert.equal((await db.query('SELECT x FROM scene_objects WHERE id=$1', [tokenId])).rows[0]!.x, final.x);
  });

  await t.test('a shared object can be moved by anyone but not reattached or deleted', async () => {
    helperLive.send({type: 'grab', kind: 'object', id: objectId});
    await helperLive.waitFor(m => m.type === 'grab-denied' && m.id === objectId);

    assert.equal((await request('PATCH', `/campaigns/${campaignId}/characters/${barrelId}/shared`, owner.token, {shared: true})).statusCode, 200);
    const scene = (await request('GET', `/campaigns/${campaignId}/scenes/${sceneId}`, helper.token)).json();
    const barrel = scene.objects.find((o: any) => o.id === objectId);
    assert.equal(barrel.canMove, true); assert.equal(barrel.canEdit, false); assert.equal(barrel.canShare, false);

    helperLive.send({type: 'grab', kind: 'object', id: objectId});
    await sleep(100);
    helperLive.send({type: 'pull', kind: 'object', id: objectId, x: 5.2, y: 1, z: 2.5, rotationY: 90, scale: 2});
    await sleep(300);
    helperLive.send({type: 'release', kind: 'object', id: objectId});
    await helperLive.waitFor(m => m.type === 'pose' && m.id === objectId && m.final);
    const saved = (await db.query('SELECT x, y, rotation_y::float8 AS r, scale::float8 AS s FROM scene_objects WHERE id=$1', [objectId])).rows[0]!;
    assert.ok(Math.abs(saved.x - 5.2) < 0.05 && Math.abs(saved.y - 1) < 0.05);
    assert.equal(saved.r, 90); assert.equal(saved.s, 2);

    const revision = (await db.query('SELECT revision FROM scene_objects WHERE id=$1', [objectId])).rows[0]!.revision;
    const base = {x: 1.5, y: 0, z: 2.5, rotationY: 0, scale: 1, snapToGrid: false, parentObjectId: null, animationName: null, revision};
    assert.equal((await request('PUT', `/campaigns/${campaignId}/scenes/${sceneId}/objects/${objectId}`, helper.token, base)).statusCode, 200);
    assert.equal((await request('PUT', `/campaigns/${campaignId}/scenes/${sceneId}/objects/${objectId}`, helper.token, {...base, revision: revision + 1, snapToGrid: true})).statusCode, 403);
    assert.equal((await request('DELETE', `/campaigns/${campaignId}/scenes/${sceneId}/objects/${objectId}`, helper.token)).statusCode, 403);
  });

  await t.test('disconnecting releases whatever the client held', async () => {
    const quitter = await connect(owner.token);
    quitter.send({type: 'grab', kind: 'object', id: tokenId});
    await sleep(100);
    quitter.send({type: 'pull', kind: 'object', id: tokenId, x: -4.2, y: 0, z: 0.5});
    await gmLive.waitFor(m => tokenPose(m) && m.x < 0 && !m.final);
    quitter.close();
    const final = await gmLive.waitFor(m => tokenPose(m) && m.final && m.x < 0);
    assert.ok(Number.isInteger(final.x - 0.5) && final.x >= -4.5);
    assert.equal((await db.query('SELECT x FROM scene_objects WHERE id=$1', [tokenId])).rows[0]!.x, final.x);
  });

  await t.test('the GM drags an object in the fog; a player who cannot see the cell gets nothing', async () => {
    const cartId = (await db.query(`INSERT INTO characters(campaign_id, name, kind) VALUES($1,'Телега','object') RETURNING id`, [campaignId])).rows[0]!.id;
    const cartPlacement = (await db.query(`INSERT INTO scene_objects(campaign_id, scene_id, character_id, x, z, created_by) VALUES($1,$2,$3,4.5,4.5,$4) RETURNING id`, [campaignId, sceneId, cartId, gm.user.id])).rows[0]!.id;
    const watcherScene = (await request('GET', `/campaigns/${campaignId}/scenes/${sceneId}`, watcher.token)).json();
    assert.equal(watcherScene.objects.some((o: any) => o.id === cartPlacement), false, 'not on the map in the fog');
    const cartPose = (m: any) => m.type === 'pose' && m.id === cartPlacement;
    gmLive.send({type: 'grab', kind: 'object', id: cartPlacement});
    await sleep(100);
    gmLive.send({type: 'pull', kind: 'object', id: cartPlacement, x: 3.2, y: 0, z: 4.5});
    await gmLive.waitFor(m => cartPose(m) && m.x < 4);
    gmLive.send({type: 'release', kind: 'object', id: cartPlacement});
    await gmLive.waitFor(m => cartPose(m) && m.final);
    await sleep(200);
    assert.ok(!watcherLive.messages.some(cartPose), 'no live pose through the fog');
  });
});
