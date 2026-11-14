import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {buildApp} from '../../../src/app.ts';
import {ASSETS_DIR} from '../../../src/system/asset-routes.ts';
import {createTestDatabase} from '../../helpers.ts';

test('the GM rewrites what a condition does; custom conditions and diseases work the same way', async t => {
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

  const gm = await register('gm_rules_cond'), alice = await register('alice_rules_cond');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Conditions'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'action_economy','flag','Экономия действий','false'::jsonb,$2)`, [campaignId, gm.user.id]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Склеп', widthCells: 10, heightCells: 3})).json().id;
  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Лира', level: 5, hpMax: 30, hpCurrent: 30, speedFeet: 30})).json();
  const ghoul = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Упырь', disposition: 'hostile', hpMax: 90, hpCurrent: 90, armorClass: 1})).json();
  const rat = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Крыса', disposition: 'hostile', hpMax: 90, hpCurrent: 90, armorClass: 1})).json();
  for (const [token, id, x] of [[alice.token, hero.id, -0.5], [gm.token, ghoul.id, 0.5], [gm.token, rat.id, -1.5]] as const) {
    assert.equal((await request('POST', `${base}/scenes/${sceneId}/objects`, token, {characterId: id, x, z: 0})).statusCode, 201);
  }
  const dagger = (await request('POST', `${base}/characters/${hero.id}/weapons`, alice.token, {name: 'Кинжал', ability: 'dexterity', proficient: true, damageFormula: '1d4+@mod', damageType: 'piercing'})).json();
  const attack = (targetCharacterId: string) => request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'attack', key: dagger.id, targetCharacterId, sceneId});
  const frighten = () => request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [hero.id], code: 'frightened', sourceCharacterId: ghoul.id});
  const rules = async (token = gm.token) => (await request('GET', `${base}/condition-rules`, token)).json();

  await t.test('everyone reads the rules; the SRD ones come first with their own words; only the GM edits', async () => {
    const view = await rules(alice.token);
    assert.equal(view.canEdit, false);
    assert.equal(view.rules.length, 27, '14 conditions, 3 diseases and 10 poisons of the SRD');
    const frightened = view.rules.find((rule: any) => rule.code === 'frightened');
    assert.equal(frightened.summary, 'Его броски атаки — с помехой, пока источник в поле зрения. Его проверки — с помехой, пока источник в поле зрения. Не может по своей воле приблизиться к источнику, пока видит его.');
    assert.deepEqual([frightened.standard, frightened.changed], [true, false]);
    assert.equal((await request('PUT', `${base}/condition-rules/frightened`, alice.token, {clauses: []})).statusCode, 403);
    assert.equal((await rules()).canEdit, true);
  });

  await t.test('SRD fear: attacks at disadvantage while the source is in sight', async () => {
    assert.equal((await frighten()).statusCode, 200);
    const rolled = (await attack(ghoul.id)).json();
    assert.ok(rolled.outcome.reasons.includes('помеха: испуган'), rolled.outcome.reasons.join('; '));
  });

  await t.test('the GM decides fear forbids attacking the source: the ghoul is off limits, the rat is not', async () => {
    const saved = await request('PUT', `${base}/condition-rules/frightened`, gm.token, {
      clauses: [{kind: 'cannot-attack', values: {whom: 'source'}}, {kind: 'cannot-approach', values: {whileSeen: true}}, {kind: 'bogus'}, {kind: 'speed', values: {mode: 'flying'}}],
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json().clauses.map((clause: any) => [clause.kind, clause.values.whom ?? clause.values.mode ?? clause.values.whileSeen]), [
      ['cannot-attack', 'source'], ['cannot-approach', true], ['speed', 'zero'],
    ], 'unknown clauses dropped, unknown values back to the default');
    assert.equal(saved.json().changed, true);
    const refused = await attack(ghoul.id);
    assert.equal(refused.statusCode, 400);
    assert.match(refused.json().message, /«испуган» — атаковать «Упырь» нельзя/);
    const rat_ = await attack(rat.id);
    assert.equal(rat_.statusCode, 201, rat_.body);
    assert.ok(!(rat_.json().outcome.reasons ?? []).includes('помеха: испуган'), 'no disadvantage left in this campaign');
  });

  await t.test('another GM: fear forbids any attack; reset brings the SRD back', async () => {
    await request('PUT', `${base}/condition-rules/frightened`, gm.token, {clauses: [{kind: 'cannot-attack', values: {whom: 'anyone'}}]});
    assert.equal((await attack(rat.id)).statusCode, 400);
    const reset = await request('DELETE', `${base}/condition-rules/frightened`, gm.token);
    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal(reset.json().reset, true);
    assert.equal(reset.json().rules.find((rule: any) => rule.code === 'frightened').changed, false);
    assert.ok(((await attack(rat.id)).json().outcome.reasons ?? []).includes('помеха: испуган'));
  });

  await t.test('a disease of the GM: created, applied, ruling rolls, kept while it is on a creature', async () => {
    const created = await request('POST', `${base}/condition-rules`, gm.token, {
      name: 'Гниль мумии', kind: 'disease', icon: 'skull', description: 'Проклятая болезнь мумии.',
      clauses: [{kind: 'own-rolls', values: {rolls: 'saves', ability: 'constitution', effect: 'disadvantage'}}, {kind: 'speed', values: {mode: 'half'}}],
    });
    assert.equal(created.statusCode, 201, created.body);
    const rot = created.json();
    assert.match(rot.code, /^custom_[a-z0-9]+$/);
    assert.equal(rot.summary, 'Его спасброски Телосложения — с помехой. Скорость вдвое меньше.');
    assert.equal((await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [hero.id], code: 'custom_nosuchthing'})).statusCode, 404);
    const applied = await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [hero.id], code: rot.code});
    assert.equal(applied.statusCode, 200, applied.body);
    const save = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'save', key: 'constitution'})).json();
    assert.ok((save.outcome?.reasons ?? []).includes('помеха: Гниль мумии'), JSON.stringify(save).slice(0, 400));
    const blocked = await request('DELETE', `${base}/condition-rules/${rot.code}`, gm.token);
    assert.equal(blocked.statusCode, 409);
    assert.match(blocked.json().message, /Лира/);
    await pg.query('DELETE FROM character_effects WHERE effect_code=$1', [rot.code]);
    assert.equal((await request('DELETE', `${base}/condition-rules/${rot.code}`, gm.token)).statusCode, 200);
    assert.equal((await rules()).rules.length, 27);
  });

  await t.test('own icons: a picture or another line icon, for SRD conditions too; resetting the rules keeps the look', async () => {
    const boundary = '----conditionIconBoundary';
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('condition icon')]);
    const upload = (token: string) => asApp(() => app.inject({
      method: 'POST', url: `${base}/assets?kind=object_image`,
      headers: {authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}`},
      payload: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fear.png"\r\nContent-Type: image/png\r\n\r\n`),
        png, Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    }));
    const uploaded = await upload(gm.token);
    assert.equal(uploaded.statusCode, 201, uploaded.body);
    const assetId = uploaded.json().id as string;
    t.after(() => unlink(join(ASSETS_DIR, `${assetId}.png`)).catch(() => {}));

    const srd = (await rules()).rules.find((rule: any) => rule.code === 'frightened');
    const looked = await request('PUT', `${base}/condition-rules/frightened`, gm.token, {clauses: srd.clauses, icon: 'skull', iconAssetId: assetId});
    assert.equal(looked.statusCode, 200, looked.body);
    assert.deepEqual([looked.json().icon, looked.json().iconAssetId, looked.json().iconChanged, looked.json().changed], ['skull', assetId, true, false]);
    assert.equal((await pg.query<any>('SELECT clauses FROM campaign_conditions WHERE campaign_id=$1 AND code=$2', [campaignId, 'frightened'])).rows[0].clauses, null, 'SRD clauses are not copied');
    assert.equal((await rules(alice.token)).rules.find((rule: any) => rule.code === 'frightened').iconAssetId, assetId, 'players see the picture too');
    assert.ok(((await attack(rat.id)).json().outcome.reasons ?? []).includes('помеха: испуган'), 'the look does not touch the rules');

    await request('PUT', `${base}/condition-rules/frightened`, gm.token, {clauses: [{kind: 'cannot-attack', values: {whom: 'anyone'}}]});
    const reset = (await request('DELETE', `${base}/condition-rules/frightened`, gm.token)).json().rules.find((rule: any) => rule.code === 'frightened');
    assert.deepEqual([reset.changed, reset.iconChanged, reset.iconAssetId, reset.summary], [false, true, assetId, srd.summary]);

    const back = await request('PUT', `${base}/condition-rules/frightened`, gm.token, {clauses: srd.clauses, icon: srd.icon, iconAssetId: null});
    assert.deepEqual([back.json().iconChanged, back.json().iconAssetId], [false, null]);
    assert.equal((await pg.query<any>('SELECT count(*)::int AS n FROM campaign_conditions WHERE campaign_id=$1', [campaignId])).rows[0].n, 0, 'nothing left to store');

    const stranger = await register('stranger_rules_cond');
    const otherCampaign = (await request('POST', '/campaigns', stranger.token, {name: 'Other'})).json().id;
    const foreign = await request('PUT', `${base}/condition-rules/poisoned`, gm.token, {clauses: [], iconAssetId: otherCampaign});
    assert.equal(foreign.statusCode, 400);
    assert.match(foreign.json().message, /Картинка для значка не найдена/);

    const plague = await request('POST', `${base}/condition-rules`, gm.token, {name: 'Чума', kind: 'disease', icon: 'sprout', iconAssetId: assetId, clauses: []});
    assert.equal(plague.statusCode, 201, plague.body);
    assert.equal(plague.json().iconAssetId, assetId);
  });

  await t.test('the attack ban covers harmful spells too: no fire bolt at the source, the rat is fair game', async () => {
    const bolt = (await pg.query<any>(`INSERT INTO character_spells(campaign_id, character_id, source, srd_index) VALUES ($1,$2,'srd','fire-bolt') RETURNING id`, [campaignId, hero.id])).rows[0].id;
    const cast = (targetId: string) => request('POST', `${base}/characters/${hero.id}/spells/${bolt}/cast`, alice.token, {targetIds: [targetId], sceneId});
    assert.equal((await request('PUT', `${base}/condition-rules/frightened`, gm.token, {clauses: [{kind: 'cannot-attack', values: {whom: 'source'}}]})).statusCode, 200);
    const refused = await cast(ghoul.id);
    assert.equal(refused.statusCode, 400, refused.body);
    assert.match(refused.json().message, /«испуган» — вредить «Упырь» заклинанием нельзя/);
    const fair = await cast(rat.id);
    assert.ok(fair.statusCode < 300, fair.body);
    await request('DELETE', `${base}/condition-rules/frightened`, gm.token);
  });

  await t.test('poisons and diseases run their course: a repeat save at the end of the turn, or after a long rest with exhaustion on a failure', async () => {
    const heroCodes = async () => (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active ORDER BY effect_code', [hero.id])).rows.map(row => row.effect_code);
    const venom = (await request('POST', `${base}/condition-rules`, gm.token, {
      name: 'Яд виверны', kind: 'poison', icon: 'poison',
      clauses: [{kind: 'own-rolls', values: {rolls: 'checks', effect: 'disadvantage'}}, {kind: 'repeat-save', values: {ability: 'constitution', dc: '8', when: 'turn-end'}}],
    })).json();
    assert.equal(venom.summary, 'Его проверки — с помехой. Спасбросок Телосложения (СЛ 8) в конце каждого своего хода: успех снимает состояние.');
    await pg.query('UPDATE characters SET constitution=30 WHERE id=$1', [hero.id]);
    await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [hero.id], code: venom.code});
    const initiative = `${base}/scenes/${sceneId}/initiative`;
    const heroEntry = (await request('POST', `${initiative}/join`, alice.token, {characterId: hero.id})).json().id;
    const ratEntry = (await request('POST', `${initiative}/join`, gm.token, {characterId: rat.id})).json().id;
    await request('PATCH', `${initiative}/${heroEntry}`, gm.token, {score: 20});
    await request('PATCH', `${initiative}/${ratEntry}`, gm.token, {score: 10});
    await request('POST', `${initiative}/advance`, gm.token);
    assert.ok((await heroCodes()).includes(venom.code), 'nothing at the start of the turn');
    await request('POST', `${initiative}/advance`, gm.token);
    assert.ok(!(await heroCodes()).includes(venom.code), 'shaken off at the end of the turn');
    const thrown = (await request('GET', `${base}/rolls`, gm.token)).json().rolls.find((roll: any) => roll.label.includes('против «Яд виверны»'));
    assert.deepEqual([thrown.outcome.dc, thrown.outcome.success], [8, true]);
    await request('DELETE', initiative, gm.token);

    await pg.query(`INSERT INTO campaign_rules(campaign_id, key, kind, label, value, updated_by) VALUES ($1,'long_rest_daily','flag','Долгий отдых раз в сутки','false'::jsonb,$2)`, [campaignId, gm.user.id]);
    const rot = (await request('POST', `${base}/condition-rules`, gm.token, {
      name: 'Сырая гниль', kind: 'disease', icon: 'sprout',
      clauses: [{kind: 'repeat-save', values: {ability: 'constitution', dc: '25', when: 'long-rest', wins: '2', onFail: 'exhaustion'}}],
    })).json();
    assert.equal(rot.summary, 'Спасбросок Телосложения (СЛ 25) после каждого долгого отдыха: 2 успеха снимают состояние, каждый провал — степень истощения.');
    await request('POST', `${base}/conditions/apply`, gm.token, {targetIds: [hero.id], code: rot.code});
    await pg.query('UPDATE characters SET constitution=10 WHERE id=$1', [hero.id]);
    const rest = () => request('POST', `${base}/characters/${hero.id}/rest`, alice.token, {kind: 'long'});
    const sick = await rest();
    assert.equal(sick.statusCode, 200, sick.body);
    assert.match(sick.json().summary, /«Сырая гниль» держится, истощение 1/);
    assert.deepEqual((await heroCodes()).filter(code => code === rot.code || code.startsWith('exhaustion')), [rot.code, 'exhaustion_1'].sort());

    await request('PUT', `${base}/condition-rules/${rot.code}`, gm.token, {clauses: [{kind: 'repeat-save', values: {ability: 'constitution', dc: '8', when: 'long-rest', wins: '2', onFail: 'exhaustion'}}]});
    await pg.query('UPDATE characters SET constitution=30 WHERE id=$1', [hero.id]);
    assert.match((await rest()).json().summary, /«Сырая гниль»: успех 1 из 2/);
    assert.ok((await heroCodes()).includes(rot.code));
    assert.match((await rest()).json().summary, /«Сырая гниль» прошло/);
    assert.deepEqual((await heroCodes()).filter(code => code === rot.code || code.startsWith('exhaustion')), [], 'cured, and the rests took the exhaustion away');
  });
});
