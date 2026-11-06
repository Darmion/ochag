import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fakeGlb(label: string): Buffer {
  return Buffer.concat([Buffer.from('glTF', 'ascii'), Buffer.from(`fake glb body: ${label}`)]);
}

function fakePng(label: string): Buffer {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from(`fake png body: ${label}`)]);
}

function multipartPayload(filename: string, contentType: string, content: Buffer) {
  const boundary = '----ttrpgTestBoundaryObjects';
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {boundary, body: Buffer.concat([head, content, tail])};
}

test('campaign objects: creation, appearance, rights and attachment on the scene', async t => {
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

  const upload = async (token: string, campaignId: string, kind: string, content: Buffer, filename: string, contentType: string) => {
    const {boundary, body} = multipartPayload(filename, contentType, content);
    return app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/assets?kind=${kind}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
  };

  const password = 'Local test password 123!';

  const register = async (username: string) => {
    const response = await request('POST', '/auth/register', undefined, {username, password, displayName: username});
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };

  const owner = await register('gm_objects'), player1 = await register('player1_objects'), player2 = await register('player2_objects');

  const campaignId = (await request('POST', '/campaigns', owner.token, {name: 'Objects test'})).json().id;

  const join = async (token: string) => {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, owner.token)).json().code;
    assert.equal((await request('POST', '/campaigns/join', token, {code})).statusCode, 201);
  };
  await join(player1.token);
  await join(player2.token);
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);

  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, owner.token, {name: 'Objects scene'})).json().id;
  const charactersPath = `/campaigns/${campaignId}/characters`;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const objectsPath = `${scenePath}/objects`;
  const sceneAs = async (token: string) => (await request('GET', scenePath, token)).json();
  const placed = async (token: string, placementId: string) => (await sceneAs(token)).objects.find((o: any) => o.id === placementId);

  const putState = (token: string, placementId: string, revision: number, state: Record<string, unknown> = {}) =>
    request('PUT', `${objectsPath}/${placementId}`, token, {
      x: 0.5, y: 0, z: 0.5, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision, ...state,
    });

  await t.test('any campaign member can upload a GLB model (not just a manager)', async () => {
    const response = await upload(player1.token, campaignId, 'object_model', fakeGlb('torch'), 'torch.glb', 'model/gltf-binary');
    assert.equal(response.statusCode, 201, response.body);
  });

  await t.test('a non-GLB file is rejected for object_model', async () => {
    const response = await upload(player1.token, campaignId, 'object_model', Buffer.from('not a model'), 'x.glb', 'model/gltf-binary');
    assert.equal(response.statusCode, 400);
  });

  await t.test('the campaign asset library lists uploaded models', async () => {
    const response = await request('GET', `/campaigns/${campaignId}/assets?kind=object_model`, owner.token);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().assets.length, 1);
    assert.equal(response.json().assets[0].original_filename, 'torch.glb');
  });

  const modelId = (await upload(player1.token, campaignId, 'object_model', fakeGlb('lantern'), 'lantern.glb', 'model/gltf-binary')).json().id;
  const imageId = (await upload(player1.token, campaignId, 'object_image', fakePng('chest'), 'chest.png', 'image/png')).json().id;

  await t.test('a player creates their own character; they own it and it starts with sane defaults', async () => {
    const response = await request('POST', charactersPath, player1.token, {kind: 'character', name: 'Лиэна', hpMax: 12, dexterity: 16});
    assert.equal(response.statusCode, 201, response.body);
    const created = response.json();
    assert.equal(created.kind, 'character');
    assert.equal(created.owner_user_id, player1.user.id);
    assert.equal(created.disposition, null);
    assert.deepEqual([created.hp_max, created.hp_current, created.dexterity, created.speed_feet, created.size], [12, 12, 16, 30, 'medium']);
    assert.equal(created.privileged, true);
  });

  await t.test('only a GM creates an NPC; it has no owner and is neutral unless told otherwise', async () => {
    assert.equal((await request('POST', charactersPath, player1.token, {kind: 'npc', name: 'Гоблин'})).statusCode, 403);

    const neutral = (await request('POST', charactersPath, owner.token, {kind: 'npc', name: 'Мельник'})).json();
    assert.deepEqual([neutral.owner_user_id, neutral.disposition], [null, 'neutral']);

    const hostile = (await request('POST', charactersPath, owner.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', size: 'small'})).json();
    assert.deepEqual([hostile.disposition, hostile.size], ['hostile', 'small']);
  });

  await t.test('a disposition is only for NPCs, and only a GM assigns an owner', async () => {
    const withDisposition = await request('POST', charactersPath, player1.token, {kind: 'object', name: 'Ящик', disposition: 'hostile'});
    assert.equal(withDisposition.statusCode, 400);
    assert.match(withDisposition.json().message, /только у НПС/);

    assert.equal((await request('POST', charactersPath, player1.token, {kind: 'character', name: 'Чужой', ownerUserId: player2.user.id})).statusCode, 403);
    const forPlayer = (await request('POST', charactersPath, owner.token, {kind: 'character', name: 'Заготовка', ownerUserId: player2.user.id})).json();
    assert.equal(forPlayer.owner_user_id, player2.user.id);
  });

  await t.test('an inanimate object: a GM’s belongs to the world, a player’s to the player; speed defaults to 0', async () => {
    const world = (await request('POST', charactersPath, owner.token, {kind: 'object', name: 'Повозка'})).json();
    assert.deepEqual([world.owner_user_id, world.speed_feet], [null, 0]);

    const own = (await request('POST', charactersPath, player1.token, {kind: 'object', name: 'Шкатулка', imageAssetId: imageId})).json();
    assert.deepEqual([own.owner_user_id, own.image_asset_id], [player1.user.id, imageId]);
  });

  await t.test('appearance must be a file of the right kind from this very campaign', async () => {
    const wrongKind = await request('POST', charactersPath, player1.token, {kind: 'object', name: 'Ящик', imageAssetId: modelId});
    assert.equal(wrongKind.statusCode, 400);
    assert.match(wrongKind.json().message, /Картинка не найдена/);

    const otherCampaignId = (await request('POST', '/campaigns', owner.token, {name: 'Other campaign'})).json().id;
    const crossCampaign = await request('POST', `/campaigns/${otherCampaignId}/characters`, owner.token, {kind: 'object', name: 'Чужой ящик', modelAssetId: modelId});
    assert.equal(crossCampaign.statusCode, 400);
  });

  await t.test('only a GM changes the kind or the disposition; the owner may change the appearance', async () => {
    const pc = (await request('POST', charactersPath, player1.token, {kind: 'character', name: 'Хамелеон'})).json();
    const path = `${charactersPath}/${pc.id}`;

    assert.equal((await request('PATCH', path, player1.token, {revision: pc.revision, kind: 'npc'})).statusCode, 403);

    const appearance = await request('PATCH', path, player1.token, {revision: pc.revision, modelAssetId: modelId, size: 'large'});
    assert.equal(appearance.statusCode, 200, appearance.body);
    assert.deepEqual([appearance.json().model_asset_id, appearance.json().size], [modelId, 'large']);

    const asNpc = await request('PATCH', path, owner.token, {revision: appearance.json().revision, kind: 'npc'});
    assert.equal(asNpc.statusCode, 200, asNpc.body);
    assert.deepEqual([asNpc.json().kind, asNpc.json().disposition], ['npc', 'neutral']);

    const back = await request('PATCH', path, owner.token, {revision: asNpc.json().revision, kind: 'object', modelAssetId: null});
    assert.deepEqual([back.json().kind, back.json().disposition, back.json().model_asset_id], ['object', null, null]);
  });

  await t.test('the roster lists every object with its kind and whether the viewer controls it', async () => {
    const roster = (await request('GET', charactersPath, player1.token)).json().characters;
    const byName = (name: string) => roster.find((c: any) => c.name === name);
    assert.deepEqual([byName('Гоблин').kind, byName('Гоблин').disposition, byName('Гоблин').can_control], ['npc', 'hostile', false]);
    assert.deepEqual([byName('Шкатулка').kind, byName('Шкатулка').image_asset_id, byName('Шкатулка').can_control], ['object', imageId, true]);
    assert.equal((await request('GET', charactersPath, owner.token)).json().characters.every((c: any) => c.can_control), true);
    assert.equal((await request('GET', charactersPath, owner.token)).json().canManage, true);
    assert.equal((await request('GET', charactersPath, player1.token)).json().canManage, false);
  });

  const lantern = (await request('POST', charactersPath, player1.token, {kind: 'object', name: 'Фонарь', modelAssetId: modelId})).json();
  let lanternPlacement = '';

  await t.test('a player puts their own object on the scene, snapped to the grid centre', async () => {
    const response = await request('POST', objectsPath, player1.token, {characterId: lantern.id, x: 0.5, z: 0.5});
    assert.equal(response.statusCode, 201, response.body);
    lanternPlacement = response.json().id;

    const asOwner = await placed(player1.token, lanternPlacement);
    assert.deepEqual([asOwner.kind, asOwner.model_asset_id, asOwner.canEdit], ['object', modelId, true]);
  });

  await t.test('another player sees the object but cannot move, hide or remove it', async () => {
    const asOther = await placed(player2.token, lanternPlacement);
    assert.ok(asOther, 'an unhidden object is visible to everyone');
    assert.deepEqual([asOther.canEdit, asOther.canMove], [false, false]);

    assert.equal((await putState(player2.token, lanternPlacement, asOther.revision, {x: 1.5})).statusCode, 403);
    assert.equal((await request('DELETE', `${objectsPath}/${lanternPlacement}`, player2.token)).statusCode, 403);
  });

  await t.test('placing an object off the grid centre with snapToGrid on is rejected', async () => {
    const object = await placed(player1.token, lanternPlacement);
    assert.equal((await putState(player1.token, lanternPlacement, object.revision, {x: 0.3, z: 0})).statusCode, 400);
  });

  await t.test('the owner can move their object freely once snapToGrid is off', async () => {
    const object = await placed(player1.token, lanternPlacement);
    const response = await putState(player1.token, lanternPlacement, object.revision, {x: 1.3, y: 0.5, z: -2.7, rotationY: 45, scale: 2, snapToGrid: false});
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().x, 1.3);
    assert.equal(response.json().snap_to_grid, false);
  });

  await t.test('a stale revision is rejected', async () => {
    assert.equal((await putState(player1.token, lanternPlacement, 1, {snapToGrid: false})).statusCode, 409);
  });

  await t.test('«Редактирование» on the object lets another player control it on the scene; revoking takes it back', async () => {
    const accessPath = `${charactersPath}/${lantern.id}/access/${player2.user.id}`;
    assert.equal((await request('PUT', accessPath, player1.token, {level: 'edit'})).statusCode, 200);

    const asGranted = await placed(player2.token, lanternPlacement);
    assert.equal(asGranted.canEdit, true);
    const moved = await putState(player2.token, lanternPlacement, asGranted.revision, {x: 0.5, z: 0.5});
    assert.equal(moved.statusCode, 200, moved.body);

    assert.equal((await request('PUT', accessPath, player1.token, {level: 'view'})).statusCode, 200);
    assert.equal((await placed(player2.token, lanternPlacement)).canEdit, false);
  });

  await t.test('a hidden object is seen only by those who control it and the GM', async () => {
    const object = await placed(player1.token, lanternPlacement);
    const hidden = await putState(player1.token, lanternPlacement, object.revision, {hidden: true});
    assert.equal(hidden.statusCode, 200, hidden.body);
    assert.equal(hidden.json().hidden, true);

    assert.equal(await placed(player2.token, lanternPlacement), undefined);
    assert.equal((await placed(owner.token, lanternPlacement)).hidden, true);

    const shown = await putState(player1.token, lanternPlacement, hidden.json().revision, {hidden: false});
    assert.equal(shown.json().hidden, false);
  });

  await t.test('a shared object is moved by anyone, but only moved', async () => {
    assert.equal((await request('PATCH', `${charactersPath}/${lantern.id}/shared`, player2.token, {shared: true})).statusCode, 403);
    assert.equal((await request('PATCH', `${charactersPath}/${lantern.id}/shared`, player1.token, {shared: true})).statusCode, 200);

    const asOther = await placed(player2.token, lanternPlacement);
    assert.deepEqual([asOther.canEdit, asOther.canMove, asOther.shared], [false, true, true]);
    assert.equal((await putState(player2.token, lanternPlacement, asOther.revision, {x: 1.5})).statusCode, 200);

    const again = await placed(player2.token, lanternPlacement);
    assert.equal((await putState(player2.token, lanternPlacement, again.revision, {x: 1.5, hidden: true})).statusCode, 403);
    assert.equal((await putState(player2.token, lanternPlacement, again.revision, {x: 1.5, animationName: 'Idle'})).statusCode, 403);

    await request('PATCH', `${charactersPath}/${lantern.id}/shared`, player1.token, {shared: false});
  });

  const box = (await request('POST', charactersPath, player1.token, {kind: 'object', name: 'Ящик на фонаре'})).json();
  let boxPlacement = '';

  await t.test('attaching a new placement to one you control resolves the combined world position', async () => {
    const created = await request('POST', objectsPath, player1.token, {
      characterId: box.id, x: 1, y: 0.5, z: -1, snapToGrid: false, parentObjectId: lanternPlacement,
    });
    assert.equal(created.statusCode, 201, created.body);
    boxPlacement = created.json().id;

    const scene = await sceneAs(player1.token);
    const parent = scene.objects.find((o: any) => o.id === lanternPlacement);
    const child = scene.objects.find((o: any) => o.id === boxPlacement);
    assert.equal(child.world_x, parent.world_x + 1);
    assert.equal(child.world_y, parent.world_y + 0.5);
    assert.equal(child.world_z, parent.world_z - 1);
  });

  await t.test('attaching to an object you do not control is rejected', async () => {
    const strangers = (await request('POST', charactersPath, player2.token, {kind: 'object', name: 'Чужая верёвка'})).json();
    const response = await request('POST', objectsPath, player2.token, {
      characterId: strangers.id, x: 0, z: 0, snapToGrid: false, parentObjectId: lanternPlacement,
    });
    assert.equal(response.statusCode, 403, response.body);
  });

  await t.test('reparenting a placement under its own descendant is rejected as a cycle', async () => {
    const parent = await placed(player1.token, lanternPlacement);
    const response = await putState(player1.token, lanternPlacement, parent.revision, {snapToGrid: false, parentObjectId: boxPlacement});
    assert.equal(response.statusCode, 400);
  });

  await t.test('removing a parent from the scene detaches its children and leaves them where they were', async () => {
    const before = await placed(player1.token, boxPlacement);
    assert.equal((await request('DELETE', `${objectsPath}/${lanternPlacement}`, player1.token)).statusCode, 204);

    const child = await placed(player1.token, boxPlacement);
    assert.ok(child, 'the attached object stays on the scene');
    assert.equal(child.parent_object_id, null);
    assert.deepEqual([child.world_x, child.world_y, child.world_z], [before.world_x, before.world_y, before.world_z]);
  });

  let statuePlacement = '';
  let statueRevision = 0;

  await t.test('a placement without animationName has none', async () => {
    const statue = (await request('POST', charactersPath, player1.token, {kind: 'object', name: 'Статуя', modelAssetId: modelId})).json();
    const created = await request('POST', objectsPath, player1.token, {characterId: statue.id, x: 0, z: 0, snapToGrid: false});
    assert.equal(created.statusCode, 201, created.body);
    const object = await placed(player1.token, created.json().id);
    assert.equal(object.animation_name, null);
    statuePlacement = object.id;
    statueRevision = object.revision;
  });

  await t.test('PUT with an animationName sets and returns it', async () => {
    const response = await putState(player1.token, statuePlacement, statueRevision, {x: 0, z: 0, snapToGrid: false, animationName: 'Idle'});
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().animation_name, 'Idle');
    statueRevision = response.json().revision;
  });

  await t.test('PUT with animationName: null clears it again', async () => {
    const response = await putState(player1.token, statuePlacement, statueRevision, {x: 0, z: 0, snapToGrid: false, animationName: null});
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().animation_name, null);
    statueRevision = response.json().revision;
  });

  await t.test('PUT without animationName is rejected — the route treats the body as full state', async () => {
    const response = await request('PUT', `${objectsPath}/${statuePlacement}`, player1.token, {
      x: 0, y: 0, z: 0, rotationY: 0, scale: 1, snapToGrid: false, parentObjectId: null, revision: statueRevision,
    });
    assert.equal(response.statusCode, 400);
  });

  await t.test('the GM’s object is visible to every player, but not editable by them', async () => {
    const cart = (await request('POST', charactersPath, owner.token, {kind: 'object', name: 'Телега'})).json();
    const created = await request('POST', objectsPath, owner.token, {characterId: cart.id});
    assert.equal(created.statusCode, 201, created.body);

    const seenByPlayer = await placed(player2.token, created.json().id);
    assert.ok(seenByPlayer, 'player should see the GM-placed object');
    assert.equal(seenByPlayer.canEdit, false);
    assert.equal((await putState(player2.token, created.json().id, seenByPlayer.revision, {x: 1.5})).statusCode, 403);
  });

  await t.test('deleting an object removes its placements on every scene', async () => {
    const otherScene = (await request('POST', `/campaigns/${campaignId}/scenes`, owner.token, {name: 'Second'})).json().id;
    const traveller = (await request('POST', charactersPath, player1.token, {kind: 'character', name: 'Путник'})).json();
    await request('POST', objectsPath, player1.token, {characterId: traveller.id});
    await request('POST', `/campaigns/${campaignId}/scenes/${otherScene}/objects`, player1.token, {characterId: traveller.id});
    assert.equal(Number((await pg.query<{n: string}>('SELECT count(*) AS n FROM scene_objects WHERE character_id=$1', [traveller.id])).rows[0]!.n), 2);

    assert.equal((await request('DELETE', `${charactersPath}/${traveller.id}`, player1.token)).statusCode, 204);
    assert.equal(Number((await pg.query<{n: string}>('SELECT count(*) AS n FROM scene_objects WHERE character_id=$1', [traveller.id])).rows[0]!.n), 0);
  });
});
