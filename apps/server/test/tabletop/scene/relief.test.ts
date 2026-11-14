import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('relief: climbing costs movement, a shove off a ledge is a fall, height counts in reach, cover and sight', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 100_000});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({
    method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {}),
  }));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_relief'), alice = await register('alice_relief');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Relief'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'action_economy','flag','Экономия действий','false'::jsonb,$2)`, [campaignId, gm.user.id]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Уступ', widthCells: 12, heightCells: 1})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const x = (col: number) => col - 6 + 0.5;
  const plateau = [0, 1, 2].map(col => [col, 0, 20]);

  await t.test('the GM raises cells in steps of 5 feet', async () => {
    assert.equal((await request('PUT', `${scenePath}/terrain`, alice.token, {cells: [], heights: plateau})).statusCode, 403);
    assert.equal((await request('PUT', `${scenePath}/terrain`, gm.token, {cells: [], heights: [[0, 0, 7]]})).statusCode, 400);
    assert.equal((await request('PUT', `${scenePath}/terrain`, gm.token, {cells: [], heights: [[0, 0, 200]]})).statusCode, 400);
    const saved = await request('PUT', `${scenePath}/terrain`, gm.token, {cells: [], heights: [...plateau, [9, 0, 0]]});
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json().heights, plateau, 'a height of 0 is no height');
    assert.deepEqual((await request('GET', scenePath, alice.token)).json().scene.elevation_cells, plateau);
  });

  const make = async (body: any, token = gm.token) => (await request('POST', `${base}/characters`, token, body)).json();
  const place = async (characterId: string, col: number, token = gm.token) => {
    const placed = await request('POST', `${scenePath}/objects`, token, {characterId, x: x(col), z: 0});
    assert.equal(placed.statusCode, 201, placed.body);
    return placed.json().id as string;
  };
  const hero = await make({kind: 'character', name: 'Скалолаз', speedFeet: 100, strength: 30, hpMax: 40, hpCurrent: 40, level: 5}, alice.token);
  await pg.query(`INSERT INTO character_skills(campaign_id, character_id, skill_index, proficient, expertise) VALUES($1,$2,'athletics',true,true)`, [campaignId, hero.id]);
  const goblin = await make({kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 50, hpCurrent: 50, strength: 1, dexterity: 1, armorClass: 5});
  const heroPlacement = await place(hero.id, 4, alice.token);
  await place(goblin.id, 2);

  const moveHero = async (col: number) => {
    const current = (await request('GET', scenePath, gm.token)).json().objects.find((o: any) => o.id === heroPlacement);
    return request('PUT', `${scenePath}/objects/${heroPlacement}`, alice.token, {
      x: x(col), y: 0, z: 0, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
    });
  };
  const act = (body: any) => request('POST', `${base}/characters/${hero.id}/combat-action`, alice.token, {sceneId, ...body});

  await t.test('twenty feet up is out of reach: no grapple from the foot of the cliff', async () => {
    assert.equal((await moveHero(3)).statusCode, 200);
    assert.match((await act({action: 'grapple', targetId: goblin.id})).json().message, /дальше 5 футов/);
  });

  await t.test('in combat climbing up and down costs double without a climbing speed, single with one', async () => {
    const initiative = `${scenePath}/initiative`;
    const heroEntry = (await request('POST', `${initiative}/join`, alice.token, {characterId: hero.id})).json().id;
    const goblinEntry = (await request('POST', `${initiative}/join`, gm.token, {characterId: goblin.id})).json().id;
    await request('PATCH', `${initiative}/${heroEntry}`, gm.token, {score: 20});
    await request('PATCH', `${initiative}/${goblinEntry}`, gm.token, {score: 10});
    await request('POST', `${initiative}/advance`, gm.token);
    const moved = async () => (await request('GET', initiative, gm.token)).json().entries.find((e: any) => e.character_id === hero.id).moved_feet;

    await pg.query('UPDATE scene_objects SET x=$2 WHERE character_id=$1', [goblin.id, x(0)]);
    assert.equal((await moveHero(2)).statusCode, 200);
    assert.equal(await moved(), 45, 'one step and twenty feet of climbing at double cost');
    assert.equal((await moveHero(3)).statusCode, 200);
    assert.equal(await moved(), 90, 'climbing down the same');
    await pg.query(`UPDATE characters SET sheet_extra = sheet_extra || '{"climbSpeedFeet": 30}'::jsonb WHERE id=$1`, [hero.id]);
    await pg.query('UPDATE initiative_entries SET moved_feet=0 WHERE character_id=$1', [hero.id]);
    assert.equal((await moveHero(2)).statusCode, 200);
    assert.equal(await moved(), 25, 'a climber pays foot for foot');
    await request('DELETE', initiative, gm.token);
  });

  await t.test('a shove off the plateau is a fall: damage and prone', async () => {
    await pg.query('UPDATE scene_objects SET x=$2 WHERE character_id=$1', [goblin.id, x(2)]);
    await pg.query('UPDATE scene_objects SET x=$2 WHERE character_id=$1', [hero.id, x(1)]);
    const pushed = (await act({action: 'shove-push', targetId: goblin.id})).json();
    assert.match(pushed.message, /оттолкнут на 5 фт\. и падает с уступа \(20 фт\.\)/);
    const row = (await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [goblin.id])).rows[0];
    assert.ok(row.hp_current < 50 && row.hp_current >= 38, `2d6 falling damage, hp ${row.hp_current}`);
    const prone = (await pg.query('SELECT 1 FROM character_effects WHERE character_id=$1 AND effect_code=$2 AND active', [goblin.id, 'prone'])).rows.length;
    assert.equal(prone, 1);
    assert.equal((await pg.query(`SELECT 1 FROM roll_log WHERE label='Падение с 20 фут. — Гоблин'`)).rows.length, 1);
  });

  await t.test('cover: from back on the plateau the foot of the cliff is hidden; from its edge it is not', async () => {
    const bow = (await request('POST', `${base}/characters/${hero.id}/weapons`, alice.token, {
      name: 'Длинный лук', ability: 'dexterity', proficient: true, weaponKind: 'ranged', rangeFeet: 150, longRangeFeet: 600, damageFormula: '1d8+@mod', damageType: 'piercing',
    })).json();
    const shoot = () => request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'attack', key: bow.id, targetCharacterId: goblin.id, sceneId});
    await pg.query('UPDATE scene_objects SET x=$2 WHERE character_id=$1', [hero.id, x(0)]);
    await pg.query('DELETE FROM character_effects WHERE character_id=$1', [goblin.id]);
    assert.match((await shoot()).json().message, /полным укрытием/);
    await pg.query('UPDATE scene_objects SET x=$2 WHERE character_id=$1', [hero.id, x(2)]);
    const fromEdge = await shoot();
    assert.equal(fromEdge.statusCode, 201, fromEdge.body);
    assert.equal(fromEdge.json().outcome.cover, undefined);
  });

  await t.test('from a 10-foot rise a hero sees over a low crate that hides the corridor from the floor', async () => {
    await pg.query('UPDATE campaigns SET fog_enabled=true WHERE id=$1', [campaignId]);
    const crate = await make({kind: 'object', name: 'Ящик'});
    await place(crate.id, 5);
    assert.equal((await request('PUT', `${base}/characters/${crate.id}/state`, gm.token, {blocks: true})).statusCode, 200);
    await pg.query('UPDATE scene_objects SET x=$2 WHERE character_id=$1', [hero.id, x(4)]);
    await pg.query('UPDATE scene_objects SET x=$2 WHERE character_id=$1', [goblin.id, x(11)]);
    const beyond = async () => new Set((await request('GET', scenePath, alice.token)).json().fog.visibleCells.map((cell: any) => `${cell.x}:${cell.z}`)).has(`${x(8)}:0`);
    await request('PUT', `${scenePath}/terrain`, gm.token, {cells: [], heights: plateau});
    assert.equal(await beyond(), false, 'the crate hides the corridor');
    await request('PUT', `${scenePath}/terrain`, gm.token, {cells: [], heights: [...plateau, [4, 0, 10]]});
    assert.equal(await beyond(), true, 'ten feet up, the hero looks over it');
  });
});
