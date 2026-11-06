import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {convertLegacySpells} from '../../src/spells/spell-template-routes.ts';
import {createTestDatabase} from '../helpers.ts';

test('SRD spell templates: default, a campaign edit that casts, reset; legacy campaign spells get a template', async t => {
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
  const gm = await register('gm_srdtpl'), alice = await register('alice_srdtpl');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'SRD по-своему'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Поле', widthCells: 20, heightCells: 20})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const mage = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Чародейка', hpMax: 40, hpCurrent: 40, level: 5, intelligence: 18})).json();
  const goblin = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 500, hpCurrent: 500, armorClass: 1})).json();
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: mage.id, x: 0.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 8.5, z: 0.5});
  await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,20,20), ($1,$2,3,9,9)`, [campaignId, mage.id]);
  const entry = (await request('POST', `${base}/characters/${mage.id}/spells`, alice.token, {source: 'srd', srdIndex: 'fireball'})).json().id as string;
  const fireball = async () => {
    const templateId = (await request('POST', `${scenePath}/templates`, alice.token, {shape: 'circle', x: 8.5, z: 0.5, direction: 0, sizeFeet: 20, label: 'Огненный шар'})).json().id;
    const cast = await request('POST', `${base}/characters/${mage.id}/spells/${entry}/cast`, alice.token, {sceneId, templateId, slotLevel: 3});
    assert.ok(cast.statusCode < 300, cast.body);
    return cast.json();
  };
  const srd = `${base}/srd-templates/fireball`;

  await t.test('the default template: auto-converted, marked for review; only the GM may edit', async () => {
    const view = (await request('GET', srd, alice.token)).json();
    assert.equal(view.overridden, false);
    assert.equal(view.canEdit, false);
    assert.deepEqual(view.template.origin, {srd: 'fireball', reviewed: false});
    assert.equal(view.template.passport.name, 'Огненный шар');
    assert.equal((await request('GET', srd, gm.token)).json().canEdit, true);
    assert.equal((await request('PUT', srd, alice.token, {template: view.template})).statusCode, 403);
    assert.equal((await request('GET', `${base}/srd-templates/no-such-spell`, gm.token)).statusCode, 404);
  });

  await t.test('the GM edits Fireball for this campaign: cold 10d6 — the cast follows the table, the list shows it', async () => {
    const view = (await request('GET', srd, gm.token)).json();
    const t2 = view.template;
    const damage = t2.actions[0].outcomes.fail.find((effect: any) => effect.kind === 'damage');
    damage.values.formula = '10к6';
    damage.values.damageType = 'cold';
    const saved = await request('PUT', srd, gm.token, {template: t2});
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().overridden, true);
    assert.deepEqual(saved.json().template.origin, {srd: 'fireball', reviewed: true});
    assert.deepEqual((await request('GET', `${base}/srd-templates`, gm.token)).json().overrides.map((row: any) => row.index), ['fireball']);
    const cast = await fireball();
    assert.equal(cast.damageRoll.formula, '10d6');
    assert.equal(cast.mechanics.damageType, 'cold');
    const listed = (await request('GET', `${base}/characters/${mage.id}/spells`, alice.token)).json().spells.find((row: any) => row.id === entry).spell;
    assert.equal(listed.templated, true);
    assert.equal(listed.mechanics.damageType, 'cold');
  });

  await t.test('reset to SRD: the default template and the text mechanics again', async () => {
    const reset = await request('DELETE', srd, gm.token);
    assert.equal(reset.json().overridden, false);
    const cast = await fireball();
    assert.equal(cast.damageRoll.formula, '8d6');
    assert.equal(cast.mechanics.damageType, 'fire');
  });

  await t.test('a campaign spell from before templates: its flat fields become a template it casts by', async () => {
    const legacy = (await pg.query<any>(
      `INSERT INTO campaign_spells (campaign_id, created_by, name, level, school, status, range, description, attack_kind, damage_formula, damage_type)
       VALUES ($1,$2,'Ледяная стрела',1,'Evocation','approved','60 футов','Луч холода.','ranged','2d8','cold') RETURNING id`,
      [campaignId, gm.user.id],
    )).rows[0].id as string;
    assert.equal(await convertLegacySpells(db), 1);
    assert.equal(await convertLegacySpells(db), 0, 'a second run changes nothing');
    const template = (await pg.query<any>('SELECT template FROM campaign_spells WHERE id=$1', [legacy])).rows[0].template;
    assert.equal(template.actions[0].check.kind, 'attack');
    const learned = (await request('POST', `${base}/characters/${mage.id}/spells`, gm.token, {source: 'custom', customSpellId: legacy})).json().id as string;
    let landed: any = null;
    for (let i = 0; i < 40 && !landed; i++) {
      const done = await request('POST', `${base}/characters/${mage.id}/spells/${learned}/cast`, alice.token, {sceneId, targetIds: [goblin.id], slotLevel: 1});
      assert.ok(done.statusCode < 300, done.body);
      const attack = done.json().targets?.[0]?.attack;
      if (attack?.hit && !attack.critical) landed = done.json();
    }
    assert.ok(landed, 'hit without a critical at least once');
    assert.equal(landed.damageRoll.formula, '2d8');
    assert.equal(landed.mechanics.damageType, 'cold');
  });
});
