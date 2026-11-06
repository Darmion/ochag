import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('altitude counts in reach, range and areas', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000});
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
  const gm = await register('gm_alt'), alice = await register('alice_alt');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Высота'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  assert.equal((await request('POST', '/campaigns/join', alice.token, {code})).statusCode, 201);
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Небо', widthCells: 10, heightCells: 10})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Копейщица', hpMax: 30, hpCurrent: 30, level: 3})).json();
  const harpy = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Гарпия', disposition: 'hostile', hpMax: 500, hpCurrent: 500, armorClass: 1})).json();
  await pg.query(`UPDATE characters SET sheet_extra = COALESCE(sheet_extra, '{}'::jsonb) || '{"flySpeedFeet": 40}'::jsonb WHERE id=$1`, [harpy.id]);
  const place = async (token: string, characterId: string, x: number, z: number) => (await request('POST', `${scenePath}/objects`, token, {characterId, x, z})).json().id as string;
  await place(alice.token, hero.id, -0.5, 0.5);
  await place(gm.token, harpy.id, 0.5, 0.5);
  const weapon = async (body: any) => (await request('POST', `${base}/characters/${hero.id}/weapons`, alice.token, {ability: 'strength', proficient: true, damageFormula: '1d1', ...body})).json();
  const sword = await weapon({name: 'Короткий меч'});
  const glaive = await weapon({name: 'Глефа', rangeFeet: 10});
  const attack = (key: string) => request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'attack', key, targetCharacterId: harpy.id, sceneId});
  const fly = (height: number) => request('PUT', `${base}/characters/${harpy.id}/flying`, gm.token, {on: true, height});

  await t.test('a flyer 10 ft up is 10 ft away: only a reach weapon gets it; 15 ft up — neither', async () => {
    assert.equal((await attack(sword.id)).statusCode, 201, 'on the ground — the sword reaches');
    assert.equal((await fly(10)).statusCode, 200);
    const sword10 = await attack(sword.id);
    assert.equal(sword10.statusCode, 400, sword10.body);
    assert.match(sword10.json().message, /вне досягаемости/);
    assert.equal((await attack(glaive.id)).statusCode, 201, 'reach 10 ft gets a flyer 10 ft up');
    assert.equal((await fly(15)).statusCode, 200);
    assert.match((await attack(glaive.id)).json().message, /вне досягаемости/, '15 ft up — out of the glaive reach');
    assert.equal((await fly(5)).statusCode, 200);
    assert.equal((await attack(sword.id)).statusCode, 201, 'right above the head (5 ft up) — adjacent');
  });

  await t.test('a ground fireball misses a flyer 30 ft up but catches one 10 ft up', async () => {
    const template = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: 0, z: 0, sizeFeet: 20, label: 'Шар'})).json().id as string;
    const saves = async () => (await request('POST', `${scenePath}/templates/${template}/saves`, gm.token, {ability: 'dexterity', dc: 10})).json().results.map((entry: any) => entry.name).sort();
    assert.equal((await fly(10)).statusCode, 200);
    assert.deepEqual(await saves(), ['Гарпия', 'Копейщица']);
    assert.equal((await fly(30)).statusCode, 200);
    assert.deepEqual(await saves(), ['Копейщица'], '30 ft above a 20-ft sphere on the ground');
    assert.equal((await request('PUT', `${base}/characters/${harpy.id}/flying`, gm.token, {on: false})).statusCode, 200);
    assert.deepEqual(await saves(), ['Гарпия', 'Копейщица']);
  });

  await t.test('«Небесный огонь» — a 40-ft-high column — burns a harpy 30 ft up; a sphere of the same radius would not', async () => {
    const priest = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Жрец', disposition: 'neutral', level: 9, wisdom: 18})).json();
    await place(gm.token, priest.id, 4.5, 4.5);
    await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,5,3,3)`, [campaignId, priest.id]);
    const strike = (await request('POST', `${base}/characters/${priest.id}/spells`, gm.token, {source: 'srd', srdIndex: 'flame-strike'})).json().id as string;
    const column = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: 0, z: 0, sizeFeet: 10, label: 'Столп'})).json().id as string;
    assert.equal((await fly(30)).statusCode, 200);
    const cast = await request('POST', `${base}/characters/${priest.id}/spells/${strike}/cast`, gm.token, {templateId: column, sceneId});
    assert.ok(cast.statusCode < 300, cast.body);
    const hit = (cast.json().targets ?? []).map((entry: any) => entry.name).sort();
    assert.ok(hit.includes('Гарпия'), `the column reaches 30 ft up: ${JSON.stringify(hit)}`);
    const sphere = (await request('POST', `${scenePath}/templates/${column}/saves`, gm.token, {ability: 'dexterity', dc: 10})).json().results.map((entry: any) => entry.name);
    assert.ok(!sphere.includes('Гарпия'), 'a plain template of the same radius is a sphere — misses her');
  });

  await t.test('in combat climbing costs movement, on its own turn; «Свободно» — free for the GM', async () => {
    await request('PUT', `${base}/characters/${harpy.id}/flying`, gm.token, {on: false});
    for (const [characterId, score] of [[harpy.id, 20], [hero.id, 5]] as Array<[string, number]>) {
      const id = (await request('POST', `${scenePath}/initiative/join`, gm.token, {characterId})).json().id;
      await request('PATCH', `${scenePath}/initiative/${id}`, gm.token, {score});
    }
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    const moved = async () => Number((await pg.query<any>('SELECT moved_feet FROM initiative_entries WHERE character_id=$1', [harpy.id])).rows[0].moved_feet);
    assert.equal((await fly(30)).statusCode, 200, 'takes off to 30 ft');
    assert.equal(await moved(), 30, '30 ft of her 40-ft flight');
    const tooHigh = await fly(50);
    assert.equal(tooHigh.statusCode, 400, tooHigh.body);
    assert.match(tooHigh.json().message, /осталось 10/);
    assert.equal((await fly(20)).statusCode, 200, 'down 10 ft — the last 10 ft');
    assert.equal(await moved(), 40);
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    assert.match((await fly(30)).json().message, /в свой ход/, 'not on the hero’s turn');
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'gm_free_move','flag','Свободно','true'::jsonb,$2)`, [campaignId, gm.user.id]);
    assert.equal((await fly(30)).statusCode, 200, '«Свободно»: the GM sets any height');
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key='gm_free_move'`, [campaignId]);
    await request('DELETE', `${scenePath}/initiative`, gm.token);
  });

  await t.test('a «Лунный луч» zone is a 40-ft column: a harpy flying 20 ft up into it sets it off; as a sphere it would not', async () => {
    const druid = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Друид', disposition: 'neutral', level: 5, wisdom: 16})).json();
    await place(gm.token, druid.id, 4.5, 4.5);
    await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,2,3,3)`, [campaignId, druid.id]);
    assert.equal((await request('POST', '/srd/spells/moonbeam/mechanics', gm.token, {createsZone: true})).statusCode, 200);
    const beam = (await request('POST', `${base}/characters/${druid.id}/spells`, gm.token, {source: 'srd', srdIndex: 'moonbeam'})).json().id as string;
    const spot = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: -3, z: -3, sizeFeet: 5, label: 'Луч'})).json().id as string;
    const cast = await request('POST', `${base}/characters/${druid.id}/spells/${beam}/cast`, gm.token, {templateId: spot, sceneId});
    assert.ok(cast.statusCode < 300, cast.body);
    const zone = (await pg.query<any>(`SELECT id, height_feet::float8 AS height, fired_count FROM scene_triggers WHERE scene_id=$1 AND name='Лунный луч'`, [sceneId])).rows[0];
    assert.equal(zone.height, 40);
    assert.equal((await fly(20)).statusCode, 200);
    const harpyAt = (await pg.query<any>('SELECT id FROM scene_objects WHERE character_id=$1', [harpy.id])).rows[0].id as string;
    const move = async (x: number, z: number) => {
      const object = (await request('GET', scenePath, gm.token)).json().objects.find((entry: any) => entry.id === harpyAt);
      return request('PUT', `${scenePath}/objects/${harpyAt}`, gm.token, {x, y: 0, z, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: object.revision});
    };
    const fired = async () => Number((await pg.query<any>('SELECT fired_count FROM scene_triggers WHERE id=$1', [zone.id])).rows[0].fired_count);
    assert.equal((await move(-0.5, -3.5)).statusCode, 200);
    const before = await fired();
    assert.equal((await move(-2.5, -3.5)).statusCode, 200, 'flies into the column');
    assert.equal(await fired(), before + 1, 'the column reaches 20 ft up');
    await pg.query('UPDATE scene_triggers SET height_feet=NULL WHERE id=$1', [zone.id]);
    assert.equal((await move(-0.5, -3.5)).statusCode, 200);
    assert.equal((await move(-2.5, -3.5)).statusCode, 200);
    assert.equal(await fired(), before + 1, 'as a sphere of 5 ft — 20 ft up is out of it');
  });
});
