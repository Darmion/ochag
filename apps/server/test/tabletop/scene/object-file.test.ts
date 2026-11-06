import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake png body: goblin')]);

test('object file export and import', async t => {
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
  const gmA = await register('gm_file_a'), gmB = await register('gm_file_b'), player = await register('player_file');
  const campaignA = (await request('POST', '/campaigns', gmA.token, {name: 'A'})).json().id;
  const campaignB = (await request('POST', '/campaigns', gmB.token, {name: 'B'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignB}/invites`, gmB.token)).json().code;
  await request('POST', '/campaigns/join', player.token, {code});

  const boundary = '----objectFileBoundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="goblin.png"\r\nContent-Type: image/png\r\n\r\n`),
    PNG, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const asset = (await request('POST', `/campaigns/${campaignA}/assets?kind=object_image`, gmA.token, body, {'content-type': `multipart/form-data; boundary=${boundary}`})).json();
  const goblin = (await request('POST', `/campaigns/${campaignA}/characters`, gmA.token, {
    kind: 'npc', name: 'Гоблин-лучник', disposition: 'hostile', dexterity: 14, hpMax: 9, hpCurrent: 9, armorClass: 13, speedFeet: 30, imageAssetId: asset.id,
  })).json();
  await pg.query(`INSERT INTO character_skills (campaign_id, character_id, skill_index, proficient) VALUES ($1,$2,'stealth',true)`, [campaignA, goblin.id]);
  await request('POST', `/campaigns/${campaignA}/characters/${goblin.id}/weapons`, gmA.token, {name: 'Короткий лук', ability: 'dexterity', weaponKind: 'ranged', rangeFeet: 80, longRangeFeet: 320, damageFormula: '1d6+@mod', damageType: 'piercing'});

  let file: any;
  await t.test('the GM downloads the object as a .ochag-object file with its picture inside', async () => {
    assert.equal((await request('GET', `/campaigns/${campaignA}/characters/${goblin.id}/export`, gmB.token)).statusCode, 404, 'not a member of A — the campaign is not even shown');
    const response = await request('GET', `/campaigns/${campaignA}/characters/${goblin.id}/export`, gmA.token);
    assert.equal(response.statusCode, 200, response.body);
    assert.match(String(response.headers['content-disposition']), /\.ochag-object/);
    file = response.json();
    assert.equal(file.format, 'ttrpg-object');
    assert.equal(file.snapshot.character.name, 'Гоблин-лучник');
    assert.equal(file.snapshot.character.owner_user_id, null);
    assert.equal(file.assets.length, 1);
    assert.deepEqual(Buffer.from(file.assets[0].data, 'base64'), PNG);
  });

  await t.test('another campaign loads it — sheet, skill, weapon and a fresh copy of the picture', async () => {
    assert.equal((await request('POST', `/campaigns/${campaignB}/objects/import`, player.token, {file})).statusCode, 403, 'a player cannot bring an NPC');
    const response = await request('POST', `/campaigns/${campaignB}/objects/import`, gmB.token, {file});
    assert.equal(response.statusCode, 201, response.body);
    const id = response.json().characterId;
    const row = (await pg.query<any>('SELECT name, kind, disposition, dexterity, hp_current, hp_max, armor_class, image_asset_id, campaign_id FROM characters WHERE id=$1', [id])).rows[0];
    assert.deepEqual([row.name, row.kind, row.disposition, row.dexterity, row.hp_current, row.armor_class, row.campaign_id], ['Гоблин-лучник', 'npc', 'hostile', 14, 9, 13, campaignB]);
    assert.ok(row.image_asset_id && row.image_asset_id !== asset.id, 'a new asset in campaign B');
    const image = await request('GET', `/campaigns/${campaignB}/assets/${row.image_asset_id}`, gmB.token);
    assert.equal(image.statusCode, 200);
    assert.deepEqual(image.rawPayload, PNG);
    assert.deepEqual((await pg.query<any>('SELECT skill_index FROM character_skills WHERE character_id=$1', [id])).rows.map(r => r.skill_index), ['stealth']);
    const weapon = (await pg.query<any>('SELECT name, weapon_kind, long_range_feet FROM character_weapons WHERE character_id=$1', [id])).rows[0];
    assert.deepEqual(weapon, {name: 'Короткий лук', weapon_kind: 'ranged', long_range_feet: 320});
  });

  await t.test('a player brings their own hero — it becomes theirs; a wrong file is refused', async () => {
    const hero = (await request('POST', `/campaigns/${campaignA}/characters`, gmA.token, {kind: 'character', name: 'Странник', hpMax: 12, hpCurrent: 12})).json();
    const heroFile = (await request('GET', `/campaigns/${campaignA}/characters/${hero.id}/export`, gmA.token)).json();
    const response = await request('POST', `/campaigns/${campaignB}/objects/import`, player.token, {file: heroFile});
    assert.equal(response.statusCode, 201, response.body);
    const row = (await pg.query<any>('SELECT kind, owner_user_id FROM characters WHERE id=$1', [response.json().characterId])).rows[0];
    assert.deepEqual([row.kind, row.owner_user_id], ['character', player.user.id]);
    const wrong = await request('POST', `/campaigns/${campaignB}/objects/import`, gmB.token, {file: {format: 'something-else'}});
    assert.equal(wrong.statusCode, 400);
    assert.match(wrong.json().message, /не файл объекта/);
  });
});
