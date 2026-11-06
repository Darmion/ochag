import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('complaints of 22 October 2026, second list', async t => {
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
  const gm = await register('gm_c056'), alice = await register('alice_c056');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Жалобы 22.10, второй список'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  assert.equal((await request('POST', '/campaigns/join', alice.token, {code})).statusCode, 201);
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;

  await t.test('п. 2: no walking, striking, shooting or casting through a wall — the GM too, unless «Свободно»', async () => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Стена', widthCells: 6, heightCells: 6})).json().id;
    const scenePath = `${base}/scenes/${sceneId}`;
    const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Лучница', hpMax: 30, hpCurrent: 30, wisdom: 16, level: 3})).json();
    const goblin = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 500, hpCurrent: 500, armorClass: 1})).json();
    const place = async (token: string, characterId: string, x: number, z: number) => (await request('POST', `${scenePath}/objects`, token, {characterId, x, z})).json().id as string;
    const heroAt = await place(alice.token, hero.id, -0.5, 0.5);
    const goblinAt = await place(gm.token, goblin.id, 0.5, 0.5);
    const weapon = async (body: any) => (await request('POST', `${base}/characters/${hero.id}/weapons`, alice.token, {ability: 'dexterity', proficient: true, damageFormula: '1d1', ...body})).json();
    const sword = await weapon({name: 'Короткий меч'});
    const bow = await weapon({name: 'Длинный лук', weaponKind: 'ranged', rangeFeet: 150});
    const attack = (key: string) => request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'attack', key, targetCharacterId: goblin.id, sceneId});
    const made = await request('POST', `${base}/characters/${hero.id}/spells`, gm.token, {source: 'srd', srdIndex: 'sacred-flame'});
    assert.equal(made.statusCode, 201, made.body);
    const flame = made.json().id as string;
    const cast = () => request('POST', `${base}/characters/${hero.id}/spells/${flame}/cast`, alice.token, {targetIds: [goblin.id], sceneId});
    const acid = (await request('POST', `${base}/characters/${hero.id}/spells`, gm.token, {source: 'srd', srdIndex: 'acid-splash'})).json().id as string;
    const splash = () => request('POST', `${base}/characters/${hero.id}/spells/${acid}/cast`, alice.token, {targetIds: [goblin.id], sceneId});

    const first = await attack(sword.id);
    assert.equal(first.statusCode, 201, first.body);
    assert.ok((await cast()).statusCode < 300, 'a save spell with no wall');
    assert.ok((await splash()).statusCode < 300, 'acid splash with no wall');

    assert.equal((await request('POST', `${scenePath}/walls`, gm.token, {x1: 0, z1: -3, x2: 0, z2: 3})).statusCode, 201);
    assert.match((await attack(sword.id)).json().message, /полным укрытием/, 'a sword through the wall');
    assert.match((await attack(bow.id)).json().message, /полным укрытием/, 'an arrow through the wall');
    assert.match((await cast()).json().message, /за стеной|не видит/, 'a save spell through the wall');
    assert.match((await splash()).json().message, /за стеной/, 'a save spell that needs no sight — the wall itself');
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'cover','flag','Укрытие','false'::jsonb,$2)`, [campaignId, gm.user.id]);
    assert.match((await attack(sword.id)).json().message, /полным укрытием/, 'the cover rule off does not open the wall');

    const move = async (token: string, objectId: string, x: number, z: number) => {
      const object = (await request('GET', scenePath, gm.token)).json().objects.find((entry: any) => entry.id === objectId);
      return request('PUT', `${scenePath}/objects/${objectId}`, token, {
        x, y: 0, z, rotationY: 0, scale: object.scale, snapToGrid: true, parentObjectId: null, animationName: null, revision: object.revision,
      });
    };
    assert.match((await move(alice.token, heroAt, 1.5, 1.5)).json().message, /стена/, 'the player cannot walk through');
    assert.match((await move(gm.token, goblinAt, -1.5, 1.5)).json().message, /стена/, 'the GM cannot either');
    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'gm_free_move','flag','Свободно','true'::jsonb,$2)`, [campaignId, gm.user.id]);
    assert.equal((await move(gm.token, goblinAt, -1.5, 1.5)).statusCode, 200, '«Свободно»: the GM teleports');
    await pg.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND key IN ('gm_free_move', 'cover')`, [campaignId]);
  });
});
