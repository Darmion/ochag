import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('darkness, torches and darkvision', async t => {
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

  const gm = await register('gm_light'), alice = await register('alice_light'), bob = await register('bob_light');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Light'})).json().id;
  for (const member of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: 'Подземелье', widthCells: 10, heightCells: 1})).json().id;
  const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
  const characters = `/campaigns/${campaignId}/characters`;
  const create = async (token: string, body: any) => (await request('POST', characters, token, body)).json();

  const human = await create(alice.token, {kind: 'character', name: 'Человек'});
  const elf = await create(bob.token, {kind: 'character', name: 'Эльф'});
  await db.query(`UPDATE characters SET sheet_extra='{"darkvisionFeet": 10}' WHERE id=$1`, [elf.id]);
  const near = await create(gm.token, {kind: 'npc', name: 'Гоблин в темноте', disposition: 'hostile'});
  const far = await create(gm.token, {kind: 'npc', name: 'Гоблин у факела', disposition: 'hostile'});
  const torch = await create(gm.token, {kind: 'object', name: 'Факел'});
  await pg.query(
    `INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'party_vision','flag','Обзор отряда','false'::jsonb,$2)`,
    [campaignId, gm.user.id],
  );
  await pg.query(
    `INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'one_per_cell','flag','Одно существо на клетку','false'::jsonb,$2)`,
    [campaignId, gm.user.id],
  );
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: human.id, x: -4.5, z: 0});
  await request('POST', `${scenePath}/objects`, bob.token, {characterId: elf.id, x: -4.5, z: 0});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: near.id, x: -2.5, z: 0});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: far.id, x: 3.5, z: 0});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: torch.id, x: 2.5, z: 0});
  assert.equal((await request('PUT', `${characters}/${torch.id}/state`, gm.token, {lightBrightFeet: 5, lightDimFeet: 5})).statusCode, 200);

  const seenBy = async (token: string) => {
    const scene = (await request('GET', scenePath, token)).json();
    return {
      creatures: scene.objects.filter((o: any) => o.kind === 'npc').map((o: any) => o.name).sort(),
      cells: scene.fog ? scene.fog.visibleCells.map((cell: any) => cell.x).sort((a: number, b: number) => a - b) : null,
      torch: scene.objects.find((o: any) => o.name === 'Факел')?.state?.light,
    };
  };

  await t.test('a bright scene is as before: everything in sight', async () => {
    assert.deepEqual((await seenBy(alice.token)).creatures, ['Гоблин в темноте', 'Гоблин у факела']);
  });

  await t.test('in the dark a human sees his own cell and what the torch lights', async () => {
    const patched = await request('PATCH', scenePath, gm.token, {lighting: 'dark'});
    assert.equal(patched.statusCode, 200, patched.body);
    assert.equal(patched.json().lighting, 'dark');

    const human = await seenBy(alice.token);
    assert.deepEqual(human.cells, [-4.5, 0.5, 1.5, 2.5, 3.5, 4.5]);
    assert.deepEqual(human.creatures, ['Гоблин у факела']);
    const light = (await request('GET', scenePath, alice.token)).json().fog.visibleCells
      .sort((a: any, b: any) => a.x - b.x).map((cell: any) => cell.light);
    assert.deepEqual(light, ['dark', 'dim', 'bright', 'bright', 'bright', 'dim']);
    assert.deepEqual(human.torch, {bright: 5, dim: 5, lit: true, openFlame: false, cone: false}, 'everyone sees the torch burning');
  });

  await t.test('darkvision reaches its radius even without light', async () => {
    const elf = await seenBy(bob.token);
    assert.deepEqual(elf.cells, [-4.5, -3.5, -2.5, 0.5, 1.5, 2.5, 3.5, 4.5]);
    assert.deepEqual(elf.creatures, ['Гоблин в темноте', 'Гоблин у факела']);
  });

  await t.test('anyone may put the torch out — then the corridor is dark', async () => {
    const doused = await request('POST', `${characters}/${torch.id}/interact`, alice.token, {action: 'douse'});
    assert.equal(doused.json().outcome, 'doused');
    const human = await seenBy(alice.token);
    assert.deepEqual(human.cells, [-4.5]);
    assert.deepEqual(human.creatures, []);
    assert.equal((await request('POST', `${characters}/${torch.id}/interact`, alice.token, {action: 'light'})).json().outcome, 'lit');
    assert.deepEqual((await seenBy(alice.token)).creatures, ['Гоблин у факела']);
  });

  await t.test('darkvision sees the torch’s dim edge as bright and the dark as grey (complaints, item 11)', async () => {
    const cells = (await request('GET', scenePath, bob.token)).json().fog.visibleCells;
    const at = (x: number) => cells.find((cell: any) => cell.x === x)?.light;
    assert.deepEqual([at(-4.5), at(-3.5), at(-2.5), at(0.5), at(4.5)], ['dark', 'dark', 'dark', 'dim', 'dim'], 'beyond darkvision the dim edge stays dim');
  });

  await t.test('the GM sees through the dark; a lightless object cannot be lit', async () => {
    assert.equal((await seenBy(gm.token)).cells, null, 'no fog for the GM');
    const rock = await create(gm.token, {kind: 'object', name: 'Камень'});
    await request('POST', `${scenePath}/objects`, gm.token, {characterId: rock.id, x: 0.5, z: 0});
    await request('PUT', `${characters}/${rock.id}/state`, gm.token, {blocks: false});
    assert.equal((await request('POST', `${characters}/${rock.id}/interact`, alice.token, {action: 'light'})).statusCode, 400);
  });
});
