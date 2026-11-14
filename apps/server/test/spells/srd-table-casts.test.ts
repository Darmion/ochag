import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('SRD spells cast by their tables: ready effects land where the old branches put them', async t => {
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
  const gm = (await request('POST', '/auth/register', undefined, {username: 'gm_table_casts', password: 'x'})).json();
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Table casts'})).json().id;
  const base = `/campaigns/${campaignId}`;
  const create = async (body: any) => (await request('POST', `${base}/characters`, gm.token, body)).json();
  const mage = await create({kind: 'character', name: 'Ирма', wisdom: 16, intelligence: 16, hpMax: 30, hpCurrent: 30});
  const friend = await create({kind: 'character', name: 'Борин', hpMax: 30, hpCurrent: 30});
  await pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,9,9),($1,$2,2,9,9)', [campaignId, mage.id]);
  const learn = async (srdIndex: string) => (await request('POST', `${base}/characters/${mage.id}/spells`, gm.token, {source: 'srd', srdIndex})).json().id as string;
  const cast = (spell: string, body: any = {}) => request('POST', `${base}/characters/${mage.id}/spells/${spell}/cast`, gm.token, body);
  const effect = async (characterId: string, code: string) => (
    await pg.query<{ parameters: Record<string, any> }>('SELECT parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code=$3 AND active', [campaignId, characterId, code])
  ).rows[0]?.parameters;

  await t.test('Guidance: on the touched friend, for one minute, tied to concentration', async () => {
    const response = await cast(await learn('guidance'), {targetIds: [friend.id]});
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().template?.spellId, 'guidance', 'cast by its table');
    const placed = await effect(friend.id, 'guidance');
    assert.ok(placed, 'the friend is guided');
    assert.equal(placed!.remainingRounds, 10, 'ends after a minute even while concentration holds');
    assert.equal(placed!.concentrationOf, mage.id);
  });

  await t.test('Invisibility without a target falls on the caster; Blur always does', async () => {
    assert.equal((await cast(await learn('invisibility'))).statusCode, 201);
    assert.ok(await effect(mage.id, 'invisible'), 'the caster is invisible');
    assert.equal((await cast(await learn('blur'), {targetIds: [friend.id]})).statusCode, 201);
    assert.ok(await effect(mage.id, 'blurred'), 'blur is on the caster');
    assert.equal(await effect(friend.id, 'blurred'), undefined);
  });

  await t.test('Moonbeam by its table: a zone that strikes later, no blast at the cast, and a command to move it', async () => {
    await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Поляна', widthCells: 20, heightCells: 6})).json().id;
    const scenePath = `${base}/scenes/${sceneId}`;
    const wolf = await create({kind: 'npc', name: 'Волк', disposition: 'hostile', hpMax: 60, hpCurrent: 60});
    await request('POST', `${scenePath}/objects`, gm.token, {characterId: mage.id, x: -6.5, z: 0.5});
    await request('POST', `${scenePath}/objects`, gm.token, {characterId: wolf.id, x: 0.5, z: 0.5});
    const templateId = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: 0.5, z: 0.5, sizeFeet: 5})).json().id;
    const beam = await learn('moonbeam');
    const response = await cast(beam, {sceneId, templateId, slotLevel: 2});
    assert.ok(response.statusCode < 300, response.body);
    assert.equal(response.json().template?.spellId, 'moonbeam');
    const hp = Number((await pg.query<{ hp_current: number }>('SELECT hp_current FROM characters WHERE id=$1', [wolf.id])).rows[0]!.hp_current);
    assert.equal(hp, 60, 'no damage at the cast: the beam strikes on entering or at the start of a turn');
    const zone = (await pg.query<{ spell: any; on_turn: boolean }>('SELECT spell, on_turn FROM scene_triggers WHERE scene_id=$1', [sceneId])).rows[0];
    assert.ok(zone, 'the zone is on the scene');
    assert.deepEqual(zone!.spell.actions.map((action: any) => action.when), ['zone-enter-or-start']);
    const commands = (await request('GET', `${base}/characters/${mage.id}/spell-commands?sceneId=${sceneId}`, gm.token)).json();
    const list = (Array.isArray(commands) ? commands : commands.spells ?? []).flatMap((entry: any) => entry.commands ?? []);
    assert.ok(list.some((command: any) => command.name === 'Сдвинуть луч'), JSON.stringify(commands));

    await pg.query('INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,3,9,9)', [campaignId, mage.id]);
    const stormArea = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: 3.5, z: 0.5, sizeFeet: 10})).json().id;
    const storm = await cast(await learn('sleet-storm'), {sceneId, templateId: stormArea, slotLevel: 3});
    assert.ok(storm.statusCode < 300, storm.body);
    const zones = (await pg.query<{ spell: any }>('SELECT spell FROM scene_triggers WHERE scene_id=$1 AND spell IS NOT NULL', [sceneId])).rows;
    const sleet = zones.find(row => row.spell.difficult === true);
    assert.ok(sleet, 'sleet is difficult ground');
    assert.deepEqual(sleet!.spell.actions[0].outcomes.fail.map((entry: any) => entry.values.code), ['prone'], 'a failed save knocks prone');
  });

  await t.test('Warding Bond is never on the caster', async () => {
    const bond = await learn('warding-bond');
    const self = await cast(bond, {targetIds: [mage.id]});
    assert.equal(self.statusCode, 400);
    assert.match(self.json().message, /связь не на себя/);
    assert.equal((await cast(bond, {targetIds: [friend.id]})).statusCode, 201);
    assert.ok(await effect(friend.id, 'warding_bond'));
  });
});
