import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('counterspell chains and the ready counterspell', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000, reactionWindowMs: 3000});
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
  const gm = await register('gm_chain'), alice = await register('alice_chain');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Chain'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Башня', widthCells: 12, heightCells: 6})).json().id;
  const create = async (token: string, body: any) => (await request('POST', `${base}/characters`, token, body)).json();
  const learn = async (token: string, characterId: string, srdIndex: string) => {
    const made = await request('POST', `${base}/characters/${characterId}/spells`, token, {source: 'srd', srdIndex});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const slots = (characterId: string, level: number, count: number) => pg.query(
    `INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT (campaign_id, character_id, level) DO UPDATE SET current=$4, max=$4`,
    [campaignId, characterId, level, count],
  );
  const left = async (characterId: string, level: number) =>
    (await pg.query<any>('SELECT current FROM character_spell_slots WHERE character_id=$1 AND level=$2', [characterId, level])).rows[0]?.current as number;
  const hp = async (id: string) => (await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current as number;

  const wizard = await create(alice.token, {kind: 'character', name: 'Мелвин', intelligence: 16, hpMax: 200, hpCurrent: 200});
  const mage = await create(gm.token, {kind: 'npc', name: 'Маг', disposition: 'hostile', intelligence: 16, hpMax: 200, hpCurrent: 200});
  const pupil = await create(gm.token, {kind: 'npc', name: 'Ученик', disposition: 'hostile', hpMax: 50, hpCurrent: 50});
  await learn(alice.token, wizard.id, 'counterspell');
  const fuchsMissile = await learn(alice.token, wizard.id, 'magic-missile');
  const fuchsBolt = await learn(alice.token, wizard.id, 'fire-bolt');
  await learn(gm.token, mage.id, 'counterspell');
  const missile = await learn(gm.token, mage.id, 'magic-missile');
  await learn(gm.token, pupil.id, 'counterspell');
  for (const id of [wizard.id, mage.id, pupil.id]) await slots(id, 3, 5);
  await slots(mage.id, 1, 9);
  await slots(wizard.id, 1, 9);
  for (const [token, id, x] of [[alice.token, wizard.id, -2.5], [gm.token, mage.id, 2.5], [gm.token, pupil.id, 3.5]] as const) {
    await request('POST', `${base}/scenes/${sceneId}/objects`, token, {characterId: id, x, z: 0.5});
  }
  const mageCasts = () => request('POST', `${base}/characters/${mage.id}/spells/${missile}/cast`, gm.token, {targetIds: [wizard.id], sceneId});
  const counter = (windowId: string, token: string, characterId: string) => request('POST', `${base}/counterspell/${windowId}`, token, {characterId});
  const decline = (windowId: string, token: string, characterId: string) => request('POST', `${base}/counterspell/${windowId}/decline`, token, {characterId});

  await t.test('a counter can be countered back: the mage answers Fuchs — the missile flies', async () => {
    const before = await hp(wizard.id);
    const cast = await mageCasts();
    assert.equal(cast.statusCode, 202);
    const answered = await counter(cast.json().pending.windowId, alice.token, wizard.id);
    assert.equal(answered.statusCode, 202, `Fuchs’s counter waits for the other side: ${answered.body}`);
    const back = await counter(answered.json().pending.windowId, gm.token, mage.id);
    assert.equal(back.statusCode, 200, back.body);
    assert.equal(back.json().countered, true, 'a 3rd-level slot against a 3rd-level counterspell — no check');
    assert.ok(await hp(wizard.id) < before, 'the missile hit after all');
    assert.deepEqual([await left(wizard.id, 3), await left(mage.id, 3), await left(mage.id, 1)], [4, 4, 8]);
  });

  await t.test('the other side declines — the counter goes through', async () => {
    const before = await hp(wizard.id);
    const cast = await mageCasts();
    const answered = await counter(cast.json().pending.windowId, alice.token, wizard.id);
    assert.equal(answered.statusCode, 202);
    const nested = answered.json().pending.windowId;
    assert.equal((await decline(nested, gm.token, mage.id)).statusCode, 204);
    assert.equal((await decline(nested, gm.token, pupil.id)).statusCode, 204);
    assert.equal(await hp(wizard.id), before, 'countered — no missile');
  });

  await t.test('a ready counterspell answers by itself; it does not bother with cantrips', async () => {
    assert.equal((await request('PUT', `${base}/characters/${mage.id}/reactions`, gm.token, {counterspell: true})).json().autoReactions.join(), 'counterspell');
    await pg.query(`DELETE FROM character_spells WHERE character_id=$1 AND srd_index='counterspell'`, [wizard.id]);
    const mageHp = await hp(mage.id);
    const pupilSlots = await left(pupil.id, 3);
    const cast = await request('POST', `${base}/characters/${wizard.id}/spells/${fuchsMissile}/cast`, alice.token, {targetIds: [mage.id], sceneId});
    assert.equal(cast.statusCode, 201, `no question at all: ${cast.body}`);
    assert.ok(cast.json().countered, 'countered by the ready mage');
    assert.equal(await hp(mage.id), mageHp);
    assert.equal(await left(pupil.id, 3), pupilSlots, 'the pupil was not asked — the mage answered first');

    const bolt = await request('POST', `${base}/characters/${wizard.id}/spells/${fuchsBolt}/cast`, alice.token, {targetIds: [mage.id], sceneId});
    assert.equal(bolt.statusCode, 202, 'a cantrip: the ready mage lets it be, the pupil is still asked');
    assert.deepEqual((await decline(bolt.json().pending.windowId, gm.token, pupil.id)).statusCode, 204);
  });

  await t.test('a ready counterspell stops an automatic Shield', async () => {
    await learn(alice.token, wizard.id, 'shield');
    await request('PUT', `${base}/characters/${wizard.id}/reactions`, alice.token, {shield: true});
    await pg.query('UPDATE characters SET armor_class=11 WHERE id=$1', [wizard.id]);
    const staff = (await request('POST', `${base}/characters/${mage.id}/weapons`, gm.token, {name: 'Посох', ability: 'strength', proficient: false, damageFormula: '1d1', rangeFeet: 60})).json();
    let stopped: any = null;
    for (let i = 0; i < 200 && !stopped; i += 1) {
      const strike = (await request('POST', `${base}/rolls/check`, gm.token, {characterId: mage.id, kind: 'attack', key: staff.id, targetCharacterId: wizard.id, sceneId})).json();
      if (strike.outcome.shieldCountered) stopped = strike;
      assert.equal(strike.outcome.shield, undefined, 'never a working shield');
    }
    assert.ok(stopped, 'a shield that would have helped was countered');
    assert.equal(stopped.outcome.hit, true, 'the blow lands');
    const shielded = (await pg.query<any>(`SELECT 1 FROM character_effects WHERE character_id=$1 AND effect_code='shield_spell' AND active`, [wizard.id])).rows.length;
    assert.equal(shielded, 0);
  });
});
