import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('summons and beast shapes', async t => {
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
  const gm = await register('gm_summon'), alice = await register('alice_summon');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Вызов'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  assert.equal((await request('POST', '/campaigns/join', alice.token, {code})).statusCode, 201);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Поляна', widthCells: 21, heightCells: 21})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const mage = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Ведунья', level: 17, intelligence: 20})).json();
  const knight = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Рыцарь', level: 3})).json();
  const goblin = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', wisdom: 1})).json();
  await pg.query('UPDATE characters SET challenge_rating=0.25, hp_max=7, hp_current=7 WHERE id=$1', [goblin.id]);
  await pg.query('UPDATE characters SET hp_max=24, hp_current=24 WHERE id=$1', [knight.id]);
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: mage.id, x: 0, z: 0});
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: knight.id, x: -1, z: 0});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 3, z: 0});
  await pg.query(
    `INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES
       ($1,$2,1,4,4), ($1,$2,2,3,3), ($1,$2,3,3,3), ($1,$2,4,3,3), ($1,$2,5,3,3), ($1,$2,8,1,1)`,
    [campaignId, mage.id],
  );
  const learn = async (index: string) => {
    const made = await request('POST', `${base}/characters/${mage.id}/spells`, alice.token, {source: 'srd', srdIndex: index});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const cast = (spellId: string, body: any = {}) => request('POST', `${base}/characters/${mage.id}/spells/${spellId}/cast`, alice.token, {sceneId, ...body});
  const onScene = async (): Promise<string[]> => (await request('GET', scenePath, alice.token)).json().objects.map((object: any) => object.name as string);
  const summoned = async () => (await pg.query<any>(
    `SELECT id, name, owner_user_id, kind, disposition, intelligence, sheet_extra FROM characters WHERE campaign_id=$1 AND sheet_extra ? 'summon' ORDER BY name`, [campaignId],
  )).rows;
  const hurt = async (characterId: string, amount: number) => {
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: `1d1+${amount - 1}`})).json();
    return (await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId, mode: 'damage'})).json();
  };

  const familiar = await learn('find-familiar');
  await t.test('the spell view lists the forms', async () => {
    const list = (await request('GET', `${base}/characters/${mage.id}/spells`, alice.token)).json().spells;
    const view = list.find((entry: any) => entry.id === familiar).spell.summon;
    assert.equal(view.kind, 'familiar');
    assert.ok(view.forms.some((form: any) => form.index === 'owl' && form.name === 'Сова'));
  });

  await t.test('«Поиск фамильяра»: an owl next to her, hers, on her side, without attacks', async () => {
    const far = await cast(familiar, {beast: 'owl', place: {x: 5, z: 0}});
    assert.equal(far.statusCode, 400, 'beyond 10 feet');
    assert.match(far.json().message, /дальше 10/);
    assert.equal((await cast(familiar, {beast: 'wolf', place: {x: 1, z: 0}})).statusCode, 400, 'a wolf is no familiar');
    const done = await cast(familiar, {beast: 'owl', place: {x: 1, z: 1}});
    assert.ok(done.statusCode < 300, done.body);
    const [owl] = await summoned();
    assert.equal(owl.name, 'Сова (Ведунья)');
    assert.deepEqual([owl.owner_user_id, owl.kind, owl.disposition, owl.sheet_extra.summon.kind, owl.sheet_extra.creatureType], [alice.user.id, 'npc', 'friendly', 'familiar', 'фея']);
    assert.equal((await pg.query<any>('SELECT count(*)::int AS n FROM character_weapons WHERE character_id=$1', [owl.id])).rows[0].n, 0, 'a familiar cannot attack');
    assert.ok((await onScene()).includes('Сова (Ведунья)'));
    assert.ok(done.json().targets.some((entry: any) => entry.summoned === 'Сова'));
  });

  await t.test('a second familiar sends the first away', async () => {
    assert.ok((await cast(familiar, {beast: 'cat', place: {x: 1, z: -1}})).statusCode < 300);
    const names = await onScene();
    assert.ok(names.includes('Кошка (Ведунья)') && !names.includes('Сова (Ведунья)'));
    assert.deepEqual((await summoned()).map(row => row.name), ['Кошка (Ведунья)'], 'the owl sheet is purged on the next read');
  });

  const conjure = await learn('conjure-animals');
  await t.test('«Призыв животных»: eight wolves of CR 1/4, held by concentration', async () => {
    assert.equal((await cast(conjure, {beast: 'brown-bear', conjureOption: 2, place: {x: 0, z: 4}})).statusCode, 400, 'a brown bear is CR 1, not 1/2');
    const done = await cast(conjure, {beast: 'wolf', conjureOption: 3, place: {x: 0, z: 4}});
    assert.ok(done.statusCode < 300, done.body);
    const wolves = (await summoned()).filter(row => row.sheet_extra.summon.kind === 'conjure-animals');
    assert.equal(wolves.length, 8);
    const held = (await pg.query<any>(`SELECT parameters FROM character_effects WHERE campaign_id=$1 AND effect_code='summoned' AND character_id = ANY($2::uuid[])`, [campaignId, wolves.map(row => row.id)])).rows;
    assert.ok(held.every(row => row.parameters.concentrationOf === mage.id));
    assert.equal((await onScene()).filter(name => name.startsWith('Волк (Ведунья)')).length, 8, 'each in its own square');
  });

  await t.test('a wolf at 0 hit points disappears', async () => {
    const wolf = (await summoned()).find(row => row.sheet_extra.summon.kind === 'conjure-animals')!;
    const result = await hurt(wolf.id, 20);
    assert.ok(result.notices?.some((notice: any) => /исчезает/.test(notice.title)) ?? true);
    assert.ok(!(await onScene()).includes(wolf.name));
    assert.equal((await summoned()).filter(row => row.sheet_extra.summon.kind === 'conjure-animals').length, 7);
  });

  const polymorph = await learn('polymorph');
  await t.test('«Превращение» ends the conjuring (new concentration): the wolves go', async () => {
    assert.equal((await cast(polymorph, {beast: 'brown-bear', targetIds: [goblin.id]})).statusCode, 400, 'CR 1 bear for a CR 1/4 goblin');
    const done = await cast(polymorph, {beast: 'rat', targetIds: [goblin.id]});
    assert.ok(done.statusCode < 300, done.body);
    assert.equal((await onScene()).filter(name => name.startsWith('Волк')).length, 0);
    const rat = (await pg.query<any>('SELECT hp_current, hp_max, strength, intelligence, wisdom, size FROM characters WHERE id=$1', [goblin.id])).rows[0];
    assert.deepEqual([rat.hp_current, rat.hp_max, rat.strength, rat.intelligence, rat.wisdom, rat.size], [1, 1, 2, 2, 10, 'tiny'], 'a rat, mind too');
    assert.equal(done.json().targets.find((entry: any) => entry.characterId === goblin.id).shaped, 'Крыса');
  });

  await t.test('her concentration ends — the goblin is himself again', async () => {
    const effect = (await pg.query<any>(`SELECT id FROM character_effects WHERE character_id=$1 AND effect_code='concentration' AND active`, [mage.id])).rows[0];
    assert.equal((await request('DELETE', `${base}/characters/${mage.id}/effects/${effect.id}`, alice.token)).statusCode, 204);
    const back = (await pg.query<any>('SELECT hp_max, strength, wisdom, size FROM characters WHERE id=$1', [goblin.id])).rows[0];
    assert.deepEqual([back.strength, back.wisdom, back.size], [10, 1, 'medium']);
  });

  await t.test('a willing ally makes no save; the beast falls — the rest of the damage carries over', async () => {
    const rolls = async () => (await pg.query<any>('SELECT count(*)::int AS n FROM roll_log WHERE campaign_id=$1 AND character_id=$2', [campaignId, knight.id])).rows[0].n;
    const before = await rolls();
    const own = (await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [knight.id])).rows[0].hp_current;
    const done = await cast(polymorph, {beast: 'brown-bear', targetIds: [knight.id]});
    assert.ok(done.statusCode < 300, done.body);
    assert.equal(await rolls(), before, 'no saving throw for a willing ally');
    assert.equal((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [knight.id])).rows[0].hp_current, 34);
    await hurt(knight.id, 35);
    const after = (await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [knight.id])).rows[0].hp_current;
    assert.equal(after, Math.max(0, own - 1), '1 damage carried over');
  });

  const shapes = await learn('animal-shapes');
  await t.test('«Облик зверей»: only willing creatures, up to CR 4 and Large', async () => {
    assert.equal((await cast(shapes, {beast: 'giant-elk', targetIds: [knight.id]})).statusCode, 400, 'Huge is too big');
    const done = await cast(shapes, {beast: 'wolf', targetIds: [knight.id, goblin.id]});
    assert.ok(done.statusCode < 300, done.body);
    const targets = done.json().targets;
    assert.equal(targets.find((entry: any) => entry.characterId === knight.id).shaped, 'Волк');
    assert.ok(!targets.find((entry: any) => entry.characterId === goblin.id)?.shaped, 'the goblin is not willing');
  });
});
