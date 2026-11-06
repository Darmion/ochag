import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

function has(cells: Array<{x: number; z: number}> | undefined, x: number, z: number) {
  return Boolean(cells?.some(c => Math.abs(c.x - x) < 1e-9 && Math.abs(c.z - z) < 1e-9));
}

test('geometric vision, walls and fog of war', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());

  const app = await buildApp(db);
  t.after(() => app.close());

  const request = async (method: any, url: string, token?: string, payload?: any) =>
    app.inject({
      method, url,
      ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}),
      ...(payload !== undefined ? {payload} : {}),
    });

  const password = 'Local test password 123!';

  const register = async (username: string) => {
    const response = await request('POST', '/auth/register', undefined, {username, password, displayName: username});
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };

  const owner = await register('gm_vision'), player1 = await register('player1_vision'), player2 = await register('player2_vision');

  const campaignId = (await request('POST', '/campaigns', owner.token, {name: 'Vision test'})).json().id;

  const join = async (token: string) => {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, owner.token)).json().code;
    assert.equal((await request('POST', '/campaigns/join', token, {code})).statusCode, 201);
  };
  await join(player1.token);
  await join(player2.token);
  await pg.query(
    `INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'party_vision','flag','Обзор отряда','false'::jsonb,$2)`,
    [campaignId, owner.user.id],
  );

  const sceneId = (
    await request('POST', `/campaigns/${campaignId}/scenes`, owner.token, {name: 'Vision arena', widthCells: 4, heightCells: 4})
  ).json().id;

  const basePath = () => `/campaigns/${campaignId}/scenes/${sceneId}`;
  const wallsPath = () => `${basePath()}/walls`;

  const watcherId = (await pg.query<{id: string}>(
    `INSERT INTO characters(campaign_id, owner_user_id, name) VALUES ($1,$2,'Watcher') RETURNING id`,
    [campaignId, player1.user.id],
  )).rows[0]!.id;
  const hiddenId = (await pg.query<{id: string}>(
    `INSERT INTO characters(campaign_id, owner_user_id, name) VALUES ($1,$2,'Hidden') RETURNING id`,
    [campaignId, player2.user.id],
  )).rows[0]!.id;

  await pg.query(
    `INSERT INTO scene_objects(campaign_id, scene_id, character_id, x, y, z, created_by) VALUES ($1,$2,$3,-0.5,0,-0.5,$4)`,
    [campaignId, sceneId, watcherId, player1.user.id],
  );
  await pg.query(
    `INSERT INTO scene_objects(campaign_id, scene_id, character_id, x, y, z, created_by) VALUES ($1,$2,$3,0.5,0,-0.5,$4)`,
    [campaignId, sceneId, hiddenId, player2.user.id],
  );

  await t.test('with no walls and an unbounded default radius, creatures see across the board', async () => {
    const scene = (await request('GET', basePath(), player1.token)).json();
    assert.equal(scene.objects.length, 2);
    assert.equal(scene.fog.visibleCells.length, 16);
  });

  await t.test('a non-manager cannot draw or delete a wall', async () => {
    assert.equal((await request('POST', wallsPath(), player1.token, {x1: 0, z1: -2, x2: 0, z2: 2})).statusCode, 403);
  });

  await t.test('a wall endpoint off the grid lattice is rejected', async () => {
    assert.equal((await request('POST', wallsPath(), owner.token, {x1: 0.3, z1: -2, x2: 0, z2: 2})).statusCode, 400);
  });

  await t.test('a wall endpoint outside the board is rejected', async () => {
    assert.equal((await request('POST', wallsPath(), owner.token, {x1: 3, z1: -2, x2: 0, z2: 2})).statusCode, 400);
  });

  await t.test('a zero-length wall is rejected', async () => {
    assert.equal((await request('POST', wallsPath(), owner.token, {x1: 0, z1: 0, x2: 0, z2: 0})).statusCode, 400);
  });

  let wallId = '';

  await t.test('the manager draws a full-height wall between the two creatures', async () => {
    const response = await request('POST', wallsPath(), owner.token, {x1: 0, z1: -2, x2: 0, z2: 2});
    assert.equal(response.statusCode, 201, response.body);
    wallId = response.json().id;
  });

  await t.test('the wall hides the far creature from the near one, but not from its own owner or the manager', async () => {
    const asPlayer1 = (await request('GET', basePath(), player1.token)).json();
    assert.equal(asPlayer1.objects.some((t: any) => t.character_id === hiddenId), false);
    assert.equal(has(asPlayer1.walls.map((w: any) => ({x: w.x1, z: w.z1})), 0, -2), true);

    const asPlayer2 = (await request('GET', basePath(), player2.token)).json();
    assert.equal(asPlayer2.objects.some((t: any) => t.character_id === hiddenId), true);

    const asOwner = (await request('GET', basePath(), owner.token)).json();
    assert.equal(asOwner.objects.length, 2);
    assert.equal(asOwner.fog, null);
  });

  await t.test('a non-manager cannot delete the wall', async () => {
    assert.equal((await request('DELETE', `${wallsPath()}/${wallId}`, player1.token)).statusCode, 403);
  });

  await t.test('deleting an unknown wall is a 404', async () => {
    assert.equal((await request('DELETE', `${wallsPath()}/00000000-0000-4000-8000-000000000000`, owner.token)).statusCode, 404);
  });

  await t.test('the manager deletes the wall and the far creature becomes visible again', async () => {
    assert.equal((await request('DELETE', `${wallsPath()}/${wallId}`, owner.token)).statusCode, 204);
    const asPlayer1 = (await request('GET', basePath(), player1.token)).json();
    assert.equal(asPlayer1.objects.some((t: any) => t.character_id === hiddenId), true);
  });

  await t.test('fog remembers explored cells once the viewer moves out of range', async () => {
    assert.equal(
      (await request('PATCH', basePath(), owner.token, {defaultVisionRadiusFeet: 5})).statusCode,
      200,
    );

    const first = (await request('GET', basePath(), player1.token)).json();
    assert.equal(has(first.fog.visibleCells, 0.5, -0.5), true);
    assert.equal(has(first.fog.exploredCells, 0.5, -0.5), true);
    assert.equal(first.objects.some((t: any) => t.character_id === hiddenId), true);

    await pg.query(
      `UPDATE scene_objects SET x=1.5, z=1.5 WHERE campaign_id=$1 AND character_id=$2`,
      [campaignId, watcherId],
    );

    const second = (await request('GET', basePath(), player1.token)).json();
    assert.equal(has(second.fog.visibleCells, 0.5, -0.5), false);
    assert.equal(has(second.fog.exploredCells, 0.5, -0.5), true);
    assert.equal(second.objects.some((t: any) => t.character_id === hiddenId), false);
  });

  await t.test('campaign-wide or per-player fog bypass restores full visibility', async () => {
    await pg.query(`UPDATE campaigns SET fog_enabled=false WHERE id=$1`, [campaignId]);
    const bypassed = (await request('GET', basePath(), player1.token)).json();
    assert.equal(bypassed.fog, null);
    assert.equal(bypassed.objects.some((t: any) => t.character_id === hiddenId), true);
    await pg.query(`UPDATE campaigns SET fog_enabled=true WHERE id=$1`, [campaignId]);

    assert.equal(
      (
        await request('PATCH', `/campaigns/${campaignId}/members/${player1.user.id}/vision`, owner.token, {
          mayChooseAlliedVision: false,
          fogDisabledByGm: true,
        })
      ).statusCode,
      200,
    );
    const perPlayerBypass = (await request('GET', basePath(), player1.token)).json();
    assert.equal(perPlayerBypass.fog, null);
    assert.equal(perPlayerBypass.objects.some((t: any) => t.character_id === hiddenId), true);

    assert.equal(
      (
        await request('PATCH', `/campaigns/${campaignId}/members/${player1.user.id}/vision`, owner.token, {
          mayChooseAlliedVision: false,
          fogDisabledByGm: false,
        })
      ).statusCode,
      200,
    );
  });

  await t.test('a blinded character is capped to its override radius, ignoring the scene default', async () => {
    await pg.query(`UPDATE scenes SET default_vision_radius_feet=NULL WHERE id=$1`, [sceneId]);
    await pg.query(
      `INSERT INTO character_vision_overrides(campaign_id, character_id, blindness_radius_feet, allow_allies_while_blind)
       VALUES ($1,$2,5,false)`,
      [campaignId, watcherId],
    );
    await pg.query(
      `INSERT INTO character_effects(campaign_id, character_id, effect_code) VALUES ($1,$2,'blinded')`,
      [campaignId, watcherId],
    );
    await pg.query(
      `UPDATE scene_objects SET x=-0.5, z=-0.5 WHERE campaign_id=$1 AND character_id=$2`,
      [campaignId, watcherId],
    );

    const scene = (await request('GET', basePath(), player1.token)).json();
    assert.equal(has(scene.fog.visibleCells, 1.5, 1.5), false);
    assert.equal(has(scene.fog.visibleCells, 0.5, -0.5), true);

    await pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [watcherId]);
    await pg.query(`DELETE FROM character_vision_overrides WHERE character_id=$1`, [watcherId]);
  });

  const insertObject = async (name: string, kind: string, ownerId: string | null, x: number, z: number, extra: {hidden?: boolean; parent?: string} = {}) => {
    const characterId = (await pg.query<{id: string}>(
      `INSERT INTO characters(campaign_id, owner_user_id, name, kind, disposition) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [campaignId, ownerId, name, kind, kind === 'npc' ? 'hostile' : null],
    )).rows[0]!.id;
    const placementId = (await pg.query<{id: string}>(
      `INSERT INTO scene_objects(campaign_id, scene_id, character_id, x, y, z, hidden, parent_object_id, created_by)
       VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8) RETURNING id`,
      [campaignId, sceneId, characterId, x, z, extra.hidden ?? false, extra.parent ?? null, owner.user.id],
    )).rows[0]!.id;
    return {characterId, placementId};
  };

  const seen = async (token: string) => (await request('GET', basePath(), token)).json().objects.map((o: any) => o.name);

  await t.test('fog hides creatures and inanimate objects alike', async () => {
    await pg.query(`UPDATE scenes SET default_vision_radius_feet=5 WHERE id=$1`, [sceneId]);
    await insertObject('Сундук в углу', 'object', null, 1.5, 1.5);
    await insertObject('Гоблин в углу', 'npc', null, 1.5, 0.5);

    const asPlayer1 = await seen(player1.token);
    assert.equal(asPlayer1.includes('Сундук в углу'), false, 'an object out of sight is fogged');
    assert.equal(asPlayer1.includes('Гоблин в углу'), false, 'a creature out of sight is fogged');
    assert.equal((await seen(owner.token)).includes('Сундук в углу'), true, 'the GM sees everything');
    assert.equal((await seen(owner.token)).includes('Гоблин в углу'), true);
  });

  await t.test('fog hides an area template nobody of yours can see, except your own', async () => {
    const place = async (token: string, x: number, z: number, label: string) => {
      const response = await request('POST', `${basePath()}/templates`, token, {shape: 'circle', x, z, sizeFeet: 1, label});
      assert.equal(response.statusCode, 201, response.body);
    };
    const labels = async (token: string) => ((await request('GET', basePath(), token)).json().templates as Array<{label: string}>).map(entry => entry.label);
    await place(owner.token, 1.5, 1.5, 'Облако в углу');
    await place(owner.token, -0.5, -0.5, 'Облако рядом');
    await place(player2.token, 1.5, 1.5, 'Своё облако');

    assert.deepEqual(await labels(player1.token), ['Облако рядом'], 'only the area in sight is shown');
    assert.equal((await labels(player2.token)).includes('Своё облако'), true, 'the author sees their own area');
    assert.equal((await labels(owner.token)).length, 3, 'the GM sees every area');
    await pg.query('DELETE FROM scene_templates WHERE scene_id=$1', [sceneId]);
  });

  await t.test('a hidden object is seen only by the GM and whoever controls it', async () => {
    await insertObject('Ловушка', 'object', null, -0.5, -0.5, {hidden: true});
    await insertObject('Тайник Ани', 'object', player1.user.id, 1.5, -1.5, {hidden: true});

    assert.equal((await seen(player1.token)).includes('Ловушка'), false);
    assert.equal((await seen(owner.token)).includes('Ловушка'), true);
    assert.equal((await seen(player1.token)).includes('Тайник Ани'), true, 'the owner sees their own hidden object');
    assert.equal((await seen(player2.token)).includes('Тайник Ани'), false);
  });

  await t.test('something attached to a creature in the fog does not give the creature away', async () => {
    const orc = await insertObject('Орк', 'npc', null, 1.5, 1.5);
    await insertObject('Факел орка', 'object', null, 0, 0.5, {parent: orc.placementId});

    const asPlayer1 = await seen(player1.token);
    assert.equal(asPlayer1.includes('Орк'), false);
    assert.equal(asPlayer1.includes('Факел орка'), false);
    assert.equal((await seen(owner.token)).includes('Факел орка'), true);
  });

  await t.test('neither objects nor the GM creatures give players vision', async () => {
    await insertObject('Фонарь Ани', 'object', player1.user.id, 1.5, 1.5);
    const fog = (await request('GET', basePath(), player1.token)).json().fog;
    assert.equal(has(fog.visibleCells, 1.5, 1.5), false);
    assert.equal(has(fog.visibleCells, -0.5, -0.5), true);
  });
});
