import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync, gzipSync} from 'node:zlib';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('transfer map')]);
const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.from('transfer model body')]);

function multipart(filename: string, content: Buffer) {
  const boundary = '----ttrpgTransferBoundary';
  return {
    boundary,
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

test('campaign transfer between two servers', async t => {
  const source = await createTestDatabase(), target = await createTestDatabase();
  t.after(() => source.pg.close());
  t.after(() => target.pg.close());

  const appA = await buildApp(source.db), appB = await buildApp(target.db);
  t.after(() => appA.close());
  t.after(() => appB.close());

  const client = (app: typeof appA) => {
    const request = async (method: any, url: string, token?: string, payload?: any) => app.inject({
      method, url,
      ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}),
      ...(payload !== undefined ? {payload} : {}),
    });
    const register = async (username: string) => {
      const response = await request('POST', '/auth/register', undefined, {username, password: 'x'});
      assert.equal(response.statusCode, 201, response.body);
      return response.json();
    };
    const upload = (token: string, url: string, filename: string, content: Buffer) => {
      const {boundary, body} = multipart(filename, content);
      return app.inject({method: 'POST', url, headers: {authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}`}, payload: body});
    };
    return {request, register, upload};
  };

  const A = client(appA), B = client(appB);

  const gm = await A.register('arden'), vasya = await A.register('vasya'), petya = await A.register('petya');
  const campaignId = (await A.request('POST', '/campaigns', gm.token, {name: 'Проклятие севера'})).json().id;
  for (const player of [vasya, petya]) {
    const code = (await A.request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    assert.equal((await A.request('POST', '/campaigns/join', player.token, {code})).statusCode, 201);
  }

  const sceneId = (await A.request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Таверна'})).json().id;
  const mapUpload = await A.upload(gm.token, `/campaigns/${campaignId}/assets?kind=scene_background`, 'map.png', PNG);
  assert.equal(mapUpload.statusCode, 201, mapUpload.body);
  const modelUpload = await A.upload(gm.token, `/campaigns/${campaignId}/assets?kind=object_model`, 'chest.glb', GLB);
  assert.equal(modelUpload.statusCode, 201, modelUpload.body);
  const mapId = mapUpload.json().id, modelId = modelUpload.json().id;
  const avatarUpload = await A.upload(gm.token, `/campaigns/${campaignId}/assets?kind=campaign_avatar`, 'avatar.png', PNG);
  const bannerUpload = await A.upload(gm.token, `/campaigns/${campaignId}/assets?kind=campaign_banner`, 'banner.png', PNG);
  assert.equal(avatarUpload.statusCode, 201, avatarUpload.body);
  assert.equal(bannerUpload.statusCode, 201, bannerUpload.body);
  assert.equal((await A.request('PUT', `/campaigns/${campaignId}/appearance`, gm.token, {
    avatarAssetId: avatarUpload.json().id,
    bannerAssetId: bannerUpload.json().id,
  })).statusCode, 200);

  const sq = source.db;
  await sq.query('UPDATE scenes SET background_asset_id=$1 WHERE id=$2', [mapId, sceneId]);
  const vasyaHero = (await sq.query(`INSERT INTO characters(campaign_id, owner_user_id, name, speed_feet) VALUES($1,$2,'Арагорн',35) RETURNING id`, [campaignId, vasya.user.id])).rows[0]!.id;
  await sq.query(`INSERT INTO characters(campaign_id, owner_user_id, name) VALUES($1,$2,'Гимли')`, [campaignId, petya.user.id]);
  const effectId = (await sq.query(`INSERT INTO character_effects(campaign_id, character_id, effect_code) VALUES($1,$2,'blinded') RETURNING id`, [campaignId, vasyaHero])).rows[0]!.id;
  await sq.query(`INSERT INTO character_field_visibility(campaign_id, character_id, field_key, mode) VALUES($1,$2,$3,'hidden')`, [campaignId, vasyaHero, `effect:${effectId}`]);
  await sq.query(`INSERT INTO scene_objects(campaign_id, scene_id, character_id, x, z, created_by) VALUES($1,$2,$3,1.5,2.5,$4)`, [campaignId, sceneId, vasyaHero, vasya.user.id]);
  const chestObject = (await sq.query(`INSERT INTO characters(campaign_id, owner_user_id, name, kind, model_asset_id) VALUES($1,$2,'Сундук','object',$3) RETURNING id`, [campaignId, petya.user.id, modelId])).rows[0]!.id;
  const lidObject = (await sq.query(`INSERT INTO characters(campaign_id, owner_user_id, name, kind) VALUES($1,NULL,'Крышка','object') RETURNING id`, [campaignId])).rows[0]!.id;
  const chest = (await sq.query(`INSERT INTO scene_objects(campaign_id, scene_id, character_id, x, z, created_by) VALUES($1,$2,$3,0.5,0.5,$4) RETURNING id`, [campaignId, sceneId, chestObject, petya.user.id])).rows[0]!.id;
  await sq.query(`INSERT INTO scene_objects(campaign_id, scene_id, character_id, parent_object_id, snap_to_grid, created_by) VALUES($1,$2,$3,$4,false,$5)`, [campaignId, sceneId, lidObject, chest, gm.user.id]);
  await sq.query(`INSERT INTO scene_walls(campaign_id, scene_id, x1, z1, x2, z2, created_by) VALUES($1,$2,0,0,3,0,$3)`, [campaignId, sceneId, gm.user.id]);
  await sq.query(`INSERT INTO scene_fog_state(campaign_id, scene_id, user_id, explored_cells) VALUES($1,$2,$3,'[1,2,3]'),($1,$2,$4,'[4]')`, [campaignId, sceneId, vasya.user.id, petya.user.id]);
  const noteId = (await sq.query(`INSERT INTO campaign_notes(campaign_id, created_by, title, body) VALUES($1,$2,'Тайна','Король — вампир') RETURNING id`, [campaignId, gm.user.id])).rows[0]!.id;
  await sq.query(`INSERT INTO campaign_note_grants(campaign_id, note_id, user_id, granted_by) VALUES($1,$2,$3,$4),($1,$2,$5,$4)`, [campaignId, noteId, vasya.user.id, gm.user.id, petya.user.id]);
  const spellId = (await sq.query(`INSERT INTO campaign_spells(campaign_id, created_by, name, level, school, status) VALUES($1,$2,'Огненный чих',1,'Эвокация','approved') RETURNING id`, [campaignId, petya.user.id])).rows[0]!.id;
  await sq.query(`INSERT INTO character_spells(campaign_id, character_id, source, custom_spell_id) VALUES($1,$2,'custom',$3)`, [campaignId, vasyaHero, spellId]);
  await sq.query(`INSERT INTO roll_log(campaign_id, user_id, formula, dice_results, modifier, total) VALUES($1,$2,'1d20','[17]',0,17)`, [campaignId, vasya.user.id]);
  await sq.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES($1,'flanking','flag','Фланкирование','true'::jsonb,$2)`, [campaignId, gm.user.id]);
  await sq.query(`UPDATE characters SET auto_reactions='{shield}' WHERE campaign_id=$1 AND id=$2`, [campaignId, vasyaHero]);

  let packageFile: Buffer;

  await t.test('only the campaign owner can export', async () => {
    assert.equal((await A.request('GET', `/campaigns/${campaignId}/export`, vasya.token)).statusCode, 403);
    const response = await A.request('GET', `/campaigns/${campaignId}/export`, gm.token);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['content-type'], 'application/gzip');
    packageFile = response.rawPayload;
  });

  const importer = await B.register('Arden'), vasyaB = await B.register('Vasya');
  const importFile = (token: string, content: Buffer) => B.upload(token, '/campaigns/import', 'campaign.ttrpg-campaign', content);

  let imported: any;

  await t.test('import recreates the campaign under the importing user', async () => {
    const response = await importFile(importer.token, packageFile);
    assert.equal(response.statusCode, 201, response.body);
    imported = response.json();

    assert.equal(imported.name, 'Проклятие севера');
    assert.notEqual(imported.campaignId, campaignId);
    assert.deepEqual(imported.counts, {characters: 4, scenes: 1, objects: 3, notes: 1, assets: 4, spells: 1, rules: 1});
    assert.deepEqual(imported.matchedPlayers, ['vasya']);
    assert.equal(imported.missingPlayers.length, 1);
    assert.equal(imported.missingPlayers[0].username, 'petya');
    assert.deepEqual([...imported.missingPlayers[0].characters].sort(), ['Гимли', 'Сундук']);

    const campaign = (await B.request('GET', `/campaigns/${imported.campaignId}`, importer.token)).json();
    assert.equal(campaign.campaign.owner_user_id, importer.user.id);
    assert.equal((await B.request('GET', `/campaigns/${imported.campaignId}`, vasyaB.token)).statusCode, 200);
  });

  await t.test('players are matched by login; the rest become GM-owned or are dropped', async () => {
    const tq = target.db, id = imported.campaignId;
    const characters = (await tq.query('SELECT name, kind, owner_user_id, speed_feet FROM characters WHERE campaign_id=$1 ORDER BY name', [id])).rows;
    assert.deepEqual(characters.map(c => [c.name, c.kind, c.owner_user_id]), [
      ['Арагорн', 'character', vasyaB.user.id], ['Гимли', 'character', null], ['Крышка', 'object', null], ['Сундук', 'object', null],
    ]);
    assert.equal(Number(characters[0]!.speed_feet), 35);
    assert.deepEqual((await tq.query(`SELECT auto_reactions FROM characters WHERE campaign_id=$1 AND name='Арагорн'`, [id])).rows[0]!.auto_reactions, ['shield'], 'text[] arrives as an array');

    const placements = (await tq.query(
      `SELECT c.name, p.created_by, p.parent_object_id FROM scene_objects p JOIN characters c ON c.id=p.character_id
       WHERE p.campaign_id=$1 ORDER BY c.name`,
      [id],
    )).rows;
    assert.deepEqual(placements.map(p => [p.name, p.created_by]), [
      ['Арагорн', vasyaB.user.id], ['Крышка', importer.user.id], ['Сундук', importer.user.id],
    ]);
    assert.ok(placements.find(p => p.name === 'Крышка')!.parent_object_id);

    assert.deepEqual((await tq.query('SELECT user_id FROM scene_fog_state WHERE campaign_id=$1', [id])).rows, [{user_id: vasyaB.user.id}]);
    assert.deepEqual((await tq.query('SELECT user_id FROM campaign_note_grants WHERE campaign_id=$1', [id])).rows, [{user_id: vasyaB.user.id}]);
    assert.equal((await tq.query('SELECT created_by FROM campaign_spells WHERE campaign_id=$1', [id])).rows[0]!.created_by, importer.user.id);
    assert.equal((await tq.query('SELECT count(*)::int AS n FROM roll_log WHERE campaign_id=$1', [id])).rows[0]!.n, 1);
  });

  await t.test('internal references and visibility keys point to the new rows', async () => {
    const tq = target.db, id = imported.campaignId;
    const effect = (await tq.query('SELECT id FROM character_effects WHERE campaign_id=$1', [id])).rows[0]!;
    assert.notEqual(effect.id, effectId);
    const keys = (await tq.query('SELECT field_key FROM character_field_visibility WHERE campaign_id=$1', [id])).rows;
    assert.deepEqual(keys, [{field_key: `effect:${effect.id}`}]);
    const spell = (await tq.query('SELECT cs.custom_spell_id, s.name FROM character_spells cs JOIN campaign_spells s ON s.id=cs.custom_spell_id WHERE cs.campaign_id=$1', [id])).rows;
    assert.equal(spell[0]!.name, 'Огненный чих');
    const rule = (await tq.query('SELECT key, kind, label, value, updated_by FROM campaign_rules WHERE campaign_id=$1', [id])).rows[0]!;
    assert.deepEqual(rule, {key: 'flanking', kind: 'flag', label: 'Фланкирование', value: true, updated_by: importer.user.id});
  });

  await t.test('map and model files are copied and served by the new server', async () => {
    const scene = (await target.db.query('SELECT background_asset_id FROM scenes WHERE campaign_id=$1', [imported.campaignId])).rows[0]!;
    const map = await B.request('GET', `/campaigns/${imported.campaignId}/assets/${scene.background_asset_id}`, importer.token);
    assert.equal(map.statusCode, 200);
    assert.deepEqual(map.rawPayload, PNG);

    const chestRow = (await target.db.query(`SELECT model_asset_id FROM characters WHERE campaign_id=$1 AND name='Сундук'`, [imported.campaignId])).rows[0]!;
    assert.notEqual(chestRow.model_asset_id, modelId);
    const model = await B.request('GET', `/campaigns/${imported.campaignId}/assets/${chestRow.model_asset_id}`, importer.token);
    assert.equal(model.statusCode, 200);
    assert.deepEqual(model.rawPayload, GLB);

    const campaign = (await B.request('GET', `/campaigns/${imported.campaignId}`, importer.token)).json().campaign;
    assert.notEqual(campaign.avatar_asset_id, avatarUpload.json().id);
    assert.notEqual(campaign.banner_asset_id, bannerUpload.json().id);
    const avatar = await B.request('GET', `/campaigns/${imported.campaignId}/assets/${campaign.avatar_asset_id}`, importer.token);
    const banner = await B.request('GET', `/campaigns/${imported.campaignId}/assets/${campaign.banner_asset_id}`, importer.token);
    assert.deepEqual(avatar.rawPayload, PNG);
    assert.deepEqual(banner.rawPayload, PNG);
  });

  await t.test('a second import keeps the first one and marks the name', async () => {
    const response = await importFile(importer.token, packageFile);
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().name, 'Проклятие севера (перенесена)');
    assert.equal((await B.request('GET', '/campaigns', importer.token)).json().campaigns.length, 2);
  });

  await t.test('garbage and files from another app version are rejected clearly', async () => {
    const garbage = await importFile(importer.token, Buffer.from('not a campaign'));
    assert.equal(garbage.statusCode, 400); assert.match(garbage.json().message, /не похож/);

    const wrongMagic = await importFile(importer.token, gzipSync(Buffer.from('hello world, definitely not ttrpg')));
    assert.equal(wrongMagic.statusCode, 400);

    const raw = gunzipSync(packageFile);
    const magic = raw.indexOf('\n') + 1, length = raw.readUInt32BE(magic);
    const json = JSON.parse(raw.subarray(magic + 4, magic + 4 + length).toString('utf8'));
    json.tables.assets[0].id = '../../escape';
    const header = Buffer.from(JSON.stringify(json), 'utf8'), size = Buffer.alloc(4);
    size.writeUInt32BE(header.length);
    const escaping = await importFile(importer.token, gzipSync(Buffer.concat([raw.subarray(0, magic), size, header, raw.subarray(magic + 4 + length)])));
    assert.equal(escaping.statusCode, 400, 'an asset id that is not a UUID would name a file outside the assets folder');
    assert.match(escaping.json().message, /идентификатора/);

    await target.pg.query('INSERT INTO schema_migrations(version) VALUES (999)');
    try {
      const newer = await importFile(importer.token, packageFile);
      assert.equal(newer.statusCode, 400); assert.match(newer.json().message, /другой версией/);
    } finally {
      await target.pg.query('DELETE FROM schema_migrations WHERE version=999');
    }
  });
});
