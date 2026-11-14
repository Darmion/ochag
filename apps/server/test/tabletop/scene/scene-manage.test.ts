import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import WebSocket from 'ws';
import {buildApp} from '../../../src/app.ts';
import {SCENE_ROWS_KEPT, SCENE_ROWS_REMOVED} from '../../../src/tabletop/scene/scene-removal.ts';
import {packContainer} from '../../../src/system/gzip-container.ts';
import {SCENE_PRESETS, presetWalls} from '../../../../../packages/domain/map/scene-presets.ts';
import {createTestDatabase} from '../../helpers.ts';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('crypt floor')]);

test('scenes are removed with a backup, restored, copied, saved to a file and started from presets', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 100_000});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any, headers: Record<string, string> = {}) => asApp(() => app.inject({
    method, url, headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...headers}, ...(payload !== undefined ? {payload} : {}),
  }));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();
  const multipart = (name: string, data: Buffer, type: string) => {
    const boundary = '----sceneBoundary';
    return {
      body: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
        data, Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
      headers: {'content-type': `multipart/form-data; boundary=${boundary}`},
    };
  };

  const gm = await register('gm_scenes'), alice = await register('alice_scenes'), gmB = await register('gm_scenes_b');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Склепы'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Склеп', widthCells: 10, heightCells: 8})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const cellarId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Подвал', widthCells: 6, heightCells: 6})).json().id;

  const upload = multipart('floor.png', PNG, 'image/png');
  const floor = (await request('POST', `${base}/assets?kind=scene_background`, gm.token, upload.body, upload.headers)).json();
  assert.equal((await request('PATCH', scenePath, gm.token, {backgroundAssetId: floor.id, lighting: 'dim'})).statusCode, 200);
  assert.equal((await request('POST', `${scenePath}/walls/batch`, gm.token, {walls: [{x1: -5, z1: -4, x2: 5, z2: -4}, {x1: 5, z1: -4, x2: 5, z2: 4}], style: 'rock'})).statusCode, 201);
  assert.equal((await request('POST', `${scenePath}/walls/batch`, gm.token, {walls: [{x1: -1, z1: 4, x2: 0, z2: 4}], kind: 'door'})).statusCode, 201);
  assert.equal((await request('PUT', `${scenePath}/terrain`, gm.token, {cells: [[1, 1], [2, 1]]})).statusCode, 200);

  const make = async (body: any, token = gm.token) => (await request('POST', `${base}/characters`, token, body)).json();
  const place = async (characterId: string, x: number, z: number, token = gm.token, path = scenePath) => {
    const response = await request('POST', `${path}/objects`, token, {characterId, x, z});
    assert.equal(response.statusCode, 201, response.body);
    return response.json().id as string;
  };
  const chest = await make({kind: 'object', name: 'Сундук'});
  const gold = await make({kind: 'object', name: 'Золото'});
  await pg.query('UPDATE characters SET container_id=$2 WHERE id=$1', [gold.id, chest.id]);
  const torch = await make({kind: 'object', name: 'Факел'});
  await pg.query(`INSERT INTO object_states (campaign_id, character_id, light_bright_feet, light_dim_feet, lit, light_open_flame) VALUES ($1,$2,20,40,true,true)`, [campaignId, torch.id]);
  const goblin = await make({kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 7, hpCurrent: 7});
  const hero = await make({kind: 'character', name: 'Лиэна', hpMax: 12, hpCurrent: 12}, alice.token);
  await place(chest.id, 2.5, 1.5);
  await place(torch.id, -2.5, -1.5);
  await place(goblin.id, 0.5, 0.5);
  await place(hero.id, -4.5, 2.5, alice.token);

  assert.equal((await request('POST', `${scenePath}/triggers`, gm.token, {kind: 'enter', shape: 'square', x: -1, z: 0, direction: 0, sizeFeet: 5, name: 'Яма'})).statusCode, 201);
  assert.equal((await request('POST', `${scenePath}/triggers`, gm.token, {kind: 'open', objectId: chest.id, name: 'Игла в замке'})).statusCode, 201);
  await pg.query('UPDATE scene_triggers SET fired_count=1, enabled=false, detected=true WHERE name=$1', ['Игла в замке']);
  await request('POST', `${base}/notes`, gm.token, {title: 'Надгробие', body: 'Здесь лежит барон.'});
  const noteId = (await request('GET', `${base}/notes`, gm.token)).json().notes[0].id;
  assert.equal((await request('POST', `${scenePath}/pins`, gm.token, {noteId, x: 1.5, z: 2.5})).statusCode, 201);
  assert.equal((await request('POST', `${scenePath}/drawings`, gm.token, {kind: 'path', color: '#E8835A', points: [[0, 0], [1.5, 0.5]]})).statusCode, 201);
  assert.equal((await request('POST', `${scenePath}/counters`, gm.token, {name: 'Обвал', kind: 'rounds', value: 3})).statusCode, 201);

  const ladder = await make({kind: 'object', name: 'Лестница вверх'});
  await place(ladder.id, 0.5, 0.5, gm.token, `${base}/scenes/${cellarId}`);
  await pg.query('INSERT INTO object_states (campaign_id, character_id, passage_scene_id) VALUES ($1,$2,$3)', [campaignId, ladder.id, sceneId]);

  const view = async (id: string) => (await request('GET', `${base}/scenes/${id}`, gm.token)).json();
  const sceneIds = async () => (await request('GET', `${base}/scenes`, gm.token)).json().scenes.map((scene: any) => scene.id);

  await t.test('the GM sees what is on a scene; a player does not', async () => {
    assert.equal((await request('GET', `${scenePath}/contents`, alice.token)).statusCode, 403);
    const contents = (await request('GET', `${scenePath}/contents`, gm.token)).json();
    assert.deepEqual(contents, {walls: 2, doors: 1, windows: 0, objects: 2, npcs: 1, characters: 1, traps: 2, pins: 1, drawings: 1, counters: 1, combat: false});
  });

  await t.test('a copy without creatures: walls, terrain, light, objects as new copies with what is inside, traps re-armed', async () => {
    const response = await request('POST', `${scenePath}/copy`, gm.token, {name: 'Склеп — копия'});
    assert.equal(response.statusCode, 201, response.body);
    const copy = await view(response.json().id);
    assert.equal(copy.scene.name, 'Склеп — копия');
    assert.deepEqual([copy.scene.width_cells, copy.scene.height_cells, copy.scene.lighting, copy.scene.background_asset_id], [10, 8, 'dim', floor.id]);
    assert.deepEqual(copy.scene.difficult_cells, [[1, 1], [2, 1]]);
    assert.deepEqual(copy.walls.map((w: any) => [w.kind, w.style]).sort(), [['door', 'stone'], ['wall', 'rock'], ['wall', 'rock']]);
    const names = copy.objects.map((o: any) => o.name).sort();
    assert.deepEqual(names, ['Сундук', 'Факел']);
    assert.ok(copy.objects.every((o: any) => ![chest.id, torch.id].includes(o.character_id)), 'new objects, not the same ones');
    const chestCopy = copy.objects.find((o: any) => o.name === 'Сундук').character_id;
    assert.deepEqual((await pg.query('SELECT name FROM characters WHERE container_id=$1', [chestCopy])).rows.map((r: any) => r.name), ['Золото']);
    const torchCopy = copy.objects.find((o: any) => o.name === 'Факел').character_id;
    assert.deepEqual((await pg.query<any>('SELECT light_bright_feet, lit FROM object_states WHERE character_id=$1', [torchCopy])).rows[0], {light_bright_feet: 20, lit: true});
    const traps = copy.triggers.sort((a: any, b: any) => a.name.localeCompare(b.name));
    assert.deepEqual(traps.map((x: any) => [x.name, x.object_id ?? null, x.enabled, x.fired_count, x.detected]), [
      ['Игла в замке', chestCopy, true, 0, false], ['Яма', null, true, 0, false],
    ]);
    assert.deepEqual(copy.pins.map((p: any) => [p.note_id ?? p.noteId, p.x, p.z]), [[noteId, 1.5, 2.5]]);
    assert.equal(copy.drawings.length, 1);
    assert.deepEqual(copy.counters.map((c: any) => [c.name, c.value]), [['Обвал', 3]]);
  });

  await t.test('a copy with creatures copies the NPC under a new name; a player hero never', async () => {
    const response = await request('POST', `${scenePath}/copy`, gm.token, {name: 'Склеп с гоблином', creatures: true});
    assert.equal(response.statusCode, 201, response.body);
    const names = (await view(response.json().id)).objects.map((o: any) => o.name).sort();
    assert.deepEqual(names, ['Гоблин 2', 'Сундук', 'Факел']);
  });

  let backupId = '';

  await t.test('a scene in combat is not removed; afterwards it is, with a backup, and the people on it are told', async () => {
    assert.equal((await request('POST', `${scenePath}/initiative/join`, alice.token, {characterId: hero.id})).statusCode, 201);
    const refused = await request('DELETE', scenePath, gm.token);
    assert.equal(refused.statusCode, 409);
    assert.match(refused.json().message, /идёт бой/);
    assert.equal((await request('DELETE', `${scenePath}/initiative`, gm.token)).statusCode, 204);
    assert.equal((await request('DELETE', scenePath, alice.token)).statusCode, 403);

    const wsAddress = (await app.listen({host: '127.0.0.1', port: 0})).replace('http', 'ws');
    const socket = new WebSocket(`${wsAddress}/live`);
    t.after(() => socket.terminate());
    const messages: any[] = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await new Promise(resolve => socket.once('open', resolve));
    socket.send(JSON.stringify({token: alice.token, campaignId, sceneId}));
    while (!messages.some(m => m.type === 'ready')) await new Promise(resolve => setTimeout(resolve, 20));

    const removed = await request('DELETE', scenePath, gm.token);
    assert.equal(removed.statusCode, 200, removed.body);
    backupId = removed.json().backupId;
    assert.equal(removed.json().name, 'Склеп');
    for (let i = 0; i < 100 && !messages.some(m => m.type === 'scene-removed'); i += 1) await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(messages.find(m => m.type === 'scene-removed'), {type: 'scene-removed', sceneId, name: 'Склеп'});

    assert.ok(!(await sceneIds()).includes(sceneId));
    assert.equal((await request('GET', scenePath, gm.token)).statusCode, 404);
    for (const table of SCENE_ROWS_REMOVED) {
      assert.equal((await pg.query(`SELECT 1 FROM ${table} WHERE scene_id=$1`, [sceneId])).rows.length, 0, table);
    }
    assert.deepEqual((await pg.query<any>('SELECT scene_id, scene_name FROM combat_records WHERE campaign_id=$1', [campaignId])).rows, [{scene_id: null, scene_name: 'Склеп'}]);
    assert.equal((await pg.query<any>('SELECT passage_scene_id FROM object_states WHERE character_id=$1', [ladder.id])).rows[0].passage_scene_id, null);
    assert.equal((await pg.query('SELECT 1 FROM characters WHERE id = ANY($1::uuid[])', [[chest.id, goblin.id, hero.id]])).rows.length, 3, 'objects stay in the campaign');

    assert.equal((await request('GET', `${base}/scene-backups`, alice.token)).statusCode, 403);
    const backups = (await request('GET', `${base}/scene-backups`, gm.token)).json().backups;
    assert.deepEqual(backups.map((b: any) => [b.id, b.name, b.counts.walls, b.counts.objects, b.counts.creatures]), [[backupId, 'Склеп', 2, 2, 2]]);
  });

  await t.test('the removed scene comes back with the same objects, the hero included', async () => {
    const response = await request('POST', `${base}/scene-backups/${backupId}/restore`, gm.token);
    assert.equal(response.statusCode, 201, response.body);
    assert.deepEqual([response.json().name, response.json().missing], ['Склеп', 0]);
    const back = await view(response.json().id);
    assert.deepEqual(back.objects.map((o: any) => o.character_id).sort(), [chest.id, torch.id, goblin.id, hero.id].sort());
    assert.equal(back.walls.length, 3);
    assert.deepEqual(back.triggers.map((x: any) => [x.name, x.fired_count]).sort(), [['Игла в замке', 1], ['Яма', 0]]);
    assert.deepEqual((await request('GET', `${base}/scene-backups`, gm.token)).json().backups, []);
    assert.equal((await request('POST', `${base}/scene-backups/${backupId}/restore`, gm.token)).statusCode, 404);
  });

  await t.test('a scene file carries the map, its pictures and objects into another campaign', async () => {
    const source = (await request('GET', `${base}/scenes`, gm.token)).json().scenes.find((s: any) => s.name === 'Склеп');
    assert.equal((await request('GET', `${base}/scenes/${source.id}/export`, alice.token)).statusCode, 403);
    const exported = await request('GET', `${base}/scenes/${source.id}/export?creatures=yes`, gm.token);
    assert.equal(exported.statusCode, 200, exported.body);
    assert.match(String(exported.headers['content-disposition']), /\.ochag-scene/);
    assert.ok(gunzipSync(exported.rawPayload).subarray(0, 12).equals(Buffer.from('OCHAG-SCENE\n')));

    const campaignB = (await request('POST', '/campaigns', gmB.token, {name: 'Другая'})).json().id;
    const file = multipart('crypt.ochag-scene', exported.rawPayload, 'application/gzip');
    assert.equal((await request('POST', `/campaigns/${campaignB}/scenes/import`, gm.token, file.body, file.headers)).statusCode, 404, 'not a member of B');
    const imported = await request('POST', `/campaigns/${campaignB}/scenes/import`, gmB.token, file.body, file.headers);
    assert.equal(imported.statusCode, 201, imported.body);
    assert.deepEqual([imported.json().name, imported.json().assets, imported.json().skipped], ['Склеп', 1, 0]);
    const scene = (await request('GET', `/campaigns/${campaignB}/scenes/${imported.json().id}`, gmB.token)).json();
    assert.ok(scene.scene.background_asset_id && scene.scene.background_asset_id !== floor.id);
    assert.deepEqual((await request('GET', `/campaigns/${campaignB}/assets/${scene.scene.background_asset_id}`, gmB.token)).rawPayload, PNG);
    assert.equal(scene.walls.length, 3);
    assert.deepEqual(scene.objects.map((o: any) => o.name).sort(), ['Гоблин', 'Сундук', 'Факел']);
    const owners = (await pg.query<any>('SELECT DISTINCT campaign_id FROM characters WHERE id = ANY($1::uuid[])', [scene.objects.map((o: any) => o.character_id)])).rows;
    assert.deepEqual(owners, [{campaign_id: campaignB}]);
    const chestB = scene.objects.find((o: any) => o.name === 'Сундук').character_id;
    assert.equal(scene.triggers.find((x: any) => x.name === 'Игла в замке').object_id, chestB);
    assert.deepEqual((await pg.query<any>('SELECT title, body FROM campaign_notes WHERE campaign_id=$1', [campaignB])).rows, [{title: 'Надгробие', body: 'Здесь лежит барон.'}]);

    const broken = multipart('broken.ochag-scene', Buffer.from('not a scene'), 'application/gzip');
    const refused = await request('POST', `/campaigns/${campaignB}/scenes/import`, gmB.token, broken.body, broken.headers);
    assert.equal(refused.statusCode, 400);
    assert.match(refused.json().message, /не файл сцены/);

    const crafted = packContainer(Buffer.from('OCHAG-SCENE\n'), {
      format: 'ochag-scene', formatVersion: 1, name: 'Чужая', assets: [{id: floor.id, kind: 'audio', offset: 0, length: 999}],
      package: {
        version: 1, scene: {width_cells: 4, height_cells: 4, background_asset_id: floor.id, lighting: 'pitch-black'},
        walls: [{x1: -2, z1: -2, x2: 2, z2: -2, kind: 'wall', style: 'stone'}, {x1: 0.3, z1: 0, x2: 1, z2: 0}, {x1: -2, z1: 0, x2: 2, z2: 0, style: 'lava'}],
        objects: [{kind: 'character', snapshot: {version: 1, character: {kind: 'character', name: 'Чужой герой'}}, placement: {x: 0.5, z: 0.5}}],
        pins: [{note: 5, x: 0, z: 0}],
      },
    }, []);
    const craftedFile = multipart('crafted.ochag-scene', crafted, 'application/gzip');
    const odd = await request('POST', `/campaigns/${campaignB}/scenes/import`, gmB.token, craftedFile.body, craftedFile.headers);
    assert.equal(odd.statusCode, 201, odd.body);
    assert.equal(odd.json().skipped, 6, 'broken asset, the scene settings, two walls, the hero, the pin');
    const oddScene = (await request('GET', `/campaigns/${campaignB}/scenes/${odd.json().id}`, gmB.token)).json();
    assert.deepEqual([oddScene.scene.width_cells, oddScene.scene.background_asset_id, oddScene.walls.length, oddScene.objects.length], [4, null, 1, 0]);
    assert.equal((await pg.query('SELECT 1 FROM characters WHERE name=$1', ['Чужой герой'])).rows.length, 0);
  });

  await t.test('a preset starts a scene with its walls, terrain and sound', async () => {
    assert.equal((await request('POST', `${base}/scenes`, gm.token, {name: 'X', preset: 'castle'})).statusCode, 400);
    const response = await request('POST', `${base}/scenes`, gm.token, {name: 'Таверна «Очаг»', preset: 'tavern'});
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().name, 'Таверна «Очаг»');
    const tavern = await view(response.json().id);
    const preset = SCENE_PRESETS.tavern;
    assert.deepEqual([tavern.scene.width_cells, tavern.scene.height_cells], [preset.widthCells, preset.heightCells]);
    assert.equal(tavern.walls.length, presetWalls(preset).length);
    assert.equal(tavern.walls.filter((w: any) => w.kind === 'door').length, 4);
    assert.equal(tavern.scene.difficult_cells.length, preset.difficult.length);
    assert.equal(tavern.scene.ambience.place, 'inside');
  });
});

test('a scene removal covers every table that points at a scene', async t => {
  const {pg} = await createTestDatabase();
  t.after(() => pg.close());
  const pointing = (await pg.query<any>(
    `SELECT DISTINCT conrelid::regclass::text AS child FROM pg_constraint WHERE contype='f' AND confrelid='scenes'::regclass ORDER BY 1`,
  )).rows.map(row => row.child);
  const named = (await pg.query<any>(
    `SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name LIKE '%scene_id' ORDER BY 1`,
  )).rows.map(row => row.table_name);
  const handled = new Set<string>([...SCENE_ROWS_REMOVED, ...Object.keys(SCENE_ROWS_KEPT)]);
  assert.deepEqual([...new Set([...pointing, ...named])].filter(table => !handled.has(table)), []);
});
