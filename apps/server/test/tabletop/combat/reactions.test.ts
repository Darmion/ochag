import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('Shield as an automatic reaction', async t => {
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
  const gm = await register('gm_shield'), alice = await register('alice_shield');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Shield'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Башня', widthCells: 6, heightCells: 6})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const wizard = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Мелвин', armorClass: 11, hpMax: 500, hpCurrent: 500})).json();
  const ogre = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Огр', disposition: 'hostile', strength: 10, hpMax: 50, hpCurrent: 50})).json();
  const club = (await request('POST', `${base}/characters/${ogre.id}/weapons`, gm.token, {name: 'Дубина', ability: 'strength', proficient: false, damageFormula: '1d1'})).json();
  assert.ok(club.id, JSON.stringify(club));
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: wizard.id, x: 0.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: ogre.id, x: 1.5, z: 0.5});
  await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,20,20)`, [campaignId, wizard.id]);
  assert.equal((await request('POST', `${base}/characters/${wizard.id}/spells`, alice.token, {source: 'srd', srdIndex: 'shield'})).statusCode, 201);

  const attack = async () => (await request('POST', `${base}/rolls/check`, gm.token, {characterId: ogre.id, kind: 'attack', key: club.id, targetCharacterId: wizard.id, sceneId})).json();
  const slots = async () => (await pg.query<any>('SELECT current FROM character_spell_slots WHERE character_id=$1 AND level=1', [wizard.id])).rows[0].current as number;
  const shielded = async () => Boolean((await pg.query<any>(`SELECT 1 FROM character_effects WHERE character_id=$1 AND effect_code='shield_spell' AND active`, [wizard.id])).rows[0]);
  const reset = () => pg.query(`DELETE FROM character_effects WHERE character_id=$1`, [wizard.id]);

  await t.test('not ready — hits land as usual', async () => {
    const casting = (await request('GET', `${base}/characters/${wizard.id}/spellcasting`, alice.token)).json();
    assert.deepEqual([casting.knowsShield, casting.autoReactions], [true, []]);
    for (let i = 0; i < 40; i += 1) {
      const result = await attack();
      assert.equal(result.outcome.shield, undefined);
      if (result.outcome.hit) assert.ok(result.dice_results.length >= 1);
    }
    assert.equal(await slots(), 20, 'no slot spent');
  });

  await t.test('ready: a hit inside AC..AC+4 becomes a miss, spends a slot, and +5 AC stays', async () => {
    assert.equal((await request('PUT', `${base}/characters/${wizard.id}/reactions`, gm.token, {shield: 'yes'})).statusCode, 400);
    const ready = await request('PUT', `${base}/characters/${wizard.id}/reactions`, alice.token, {shield: true});
    assert.deepEqual(ready.json().autoReactions, ['shield']);
    let seenShield = false, seenHigh = false, seenNat20 = false;
    for (let i = 0; i < 200 && !(seenShield && seenHigh); i += 1) {
      await reset();
      const before = await slots();
      const result = await attack();
      const total = result.total as number;
      const nat = Math.max(...result.dice_results);
      if (result.outcome.shield) {
        seenShield = true;
        assert.ok(total >= 11 && total < 16 && nat !== 20, `shield only inside 11..15: ${total}`);
        assert.equal(result.outcome.hit, false, 'the hit became a miss');
        assert.equal(result.outcome.shield.ac, 16);
        assert.equal(await slots(), before - 1, 'a 1st-level slot spent');
        assert.ok(await shielded(), '+5 AC stays');
      } else if (result.outcome.hit) {
        assert.ok(total >= 16 || nat === 20, `a hit the shield would not stop: ${total}`);
        if (nat === 20) seenNat20 = true; else seenHigh = true;
        assert.equal(await slots(), before, 'no slot for a useless shield');
      } else {
        assert.ok(total < 11, `plain miss: ${total}`);
      }
    }
    assert.ok(seenShield, 'the shield went up at least once');
    void seenNat20;
  });

  await t.test('with the shield up the next attack faces AC 16 without spending more; start of her turn drops it', async () => {
    await reset();
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'shield_spell','{}'::jsonb)`, [campaignId, wizard.id]);
    const before = await slots();
    for (let i = 0; i < 30; i += 1) {
      const result = await attack();
      const nat = Math.max(...result.dice_results);
      if (result.outcome.hit) assert.ok(result.total >= 16 || nat === 20, `vs AC 16: ${result.total}`);
    }
    assert.equal(await slots(), before, 'the shield already up — nothing more to spend');

    const initiative = `${scenePath}/initiative`;
    const entry = (await request('POST', `${initiative}/join`, alice.token, {characterId: wizard.id})).json().id;
    await request('POST', `${initiative}/join`, gm.token, {characterId: ogre.id});
    await request('PATCH', `${initiative}/${entry}`, gm.token, {score: 30});
    await request('POST', `${initiative}/advance`, gm.token, {});
    assert.equal(await shielded(), false, 'gone at the start of her turn');
  });

  await t.test('in combat the reaction is spent once per round', async () => {
    const initiative = `${scenePath}/initiative`;
    await request('POST', `${initiative}/advance`, gm.token, {});
    let shields = 0;
    for (let i = 0; i < 120; i += 1) {
      await reset();
      await pg.query('UPDATE initiative_entries SET action_used=false, bonus_used=false, attacks_made=0, leveled_action_spell=false, bonus_spell=false WHERE character_id=$1', [ogre.id]);
      const result = await attack();
      if (result.outcome.shield) shields += 1;
    }
    assert.ok(shields <= 1, `one reaction per round, got ${shields}`);
    const used = (await pg.query<any>('SELECT reaction_used FROM initiative_entries WHERE character_id=$1', [wizard.id])).rows[0].reaction_used;
    assert.equal(used, shields === 1);
  });
});
