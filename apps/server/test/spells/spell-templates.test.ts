import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {buildApp} from '../../src/app.ts';
import {ASSETS_DIR} from '../../src/system/asset-routes.ts';
import {createTestDatabase} from '../helpers.ts';
import {emptyAction, emptyEffect, emptyTemplate, type SpellTemplate} from '../../../../packages/domain/spells/spell-template.ts';

test('spell templates: create, review, versions, apply elsewhere, cast by the table', async t => {
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
  const gm = await register('gm_tpl'), alice = await register('alice_tpl');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Шаблоны'})).json().id;
  const otherCampaign = (await request('POST', '/campaigns', gm.token, {name: 'Другая кампания'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const tpl = `${base}/spell-templates`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Поле', widthCells: 20, heightCells: 20})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  function iceStrike(): SpellTemplate {
    const s = emptyTemplate();
    s.passport = {...s.passport, name: 'Ледяной удар', level: 0, school: 'evocation', description: 'Совершите дальнобойную атаку заклинанием.'};
    s.casting = {...s.casting, rangeValue: 60};
    const hit = emptyAction('Удар');
    hit.check = {...hit.check, kind: 'attack', attackRange: 'ranged'};
    const cold = emptyEffect('damage');
    Object.assign(cold.values, {formula: '2к8', damageType: 'cold'});
    const slow = emptyEffect('speed');
    Object.assign(slow.values, {mode: 'minus', feet: 10, lasts: 'caster-next-start'});
    hit.outcomes.hit = [cold, slow];
    s.actions = [hit];
    return s;
  }
  function stoneSkin(): SpellTemplate {
    const s = emptyTemplate();
    s.passport = {...s.passport, name: 'Каменный покров', level: 1, school: 'abjuration'};
    s.casting = {...s.casting, range: 'self'};
    s.duration = {...s.duration, kind: 'minutes', value: 10};
    s.targeting = {...s.targeting, kind: 'self'};
    const wrap = emptyAction('Покров');
    wrap.who = 'caster';
    const mods: Array<[string, Record<string, unknown>]> = [
      ['ac', {mode: 'floor', value: 17}],
      ['defense', {mode: 'resistance', types: ['fire']}],
      ['checks', {roll: 'save', ability: 'wisdom', mode: 'advantage'}],
      ['speed', {mode: 'plus', feet: 10}],
      ['defense', {mode: 'condition-immunity', conditions: ['frightened']}],
      ['special', {text: 'Кожа звенит, как камень, — враги это слышат'}],
    ];
    wrap.outcomes.always = mods.map(([kind, values]) => {
      const effect = emptyEffect(kind as any);
      Object.assign(effect.values, values);
      return effect;
    });
    s.actions = [wrap];
    return s;
  }

  await t.test('suggestions from a Russian description', async () => {
    const result = await request('POST', `${tpl}/suggest`, alice.token, {description: 'Все существа в сфере радиусом 20 футов должны совершить спасбросок Ловкости. При провале существо получает 8d6 урона огнём, при успехе — половину урона.', level: 3});
    assert.equal(result.statusCode, 200, result.body);
    const paths = result.json().suggestions.map((entry: any) => entry.path);
    assert.ok(paths.includes('targeting.shape') && paths.includes('actions[+]'), JSON.stringify(paths));
  });

  let gmSpell = '';
  await t.test('the GM creates — approved at once, version 1 in the history', async () => {
    const made = await request('POST', tpl, gm.token, {template: iceStrike(), submit: true});
    assert.equal(made.statusCode, 201, made.body);
    const body = made.json();
    gmSpell = body.spell.id;
    assert.equal(body.spell.status, 'approved');
    assert.equal(body.spell.templateVersion, 1);
    assert.equal(body.history.length, 1);
    assert.equal(body.canReview, true);
  });

  let playerSpell = '';
  await t.test('a player: draft, unresolved suggestions block, errors block, rework, approve with edits', async () => {
    const draft = await request('POST', tpl, alice.token, {template: stoneSkin(), suggestions: {items: [{status: 'suggested', path: 'casting.time'}]}});
    assert.equal(draft.statusCode, 201, draft.body);
    playerSpell = draft.json().spell.id;
    assert.equal(draft.json().spell.status, 'draft');
    const blocked = await request('PUT', `${tpl}/${playerSpell}`, alice.token, {template: stoneSkin(), suggestions: {items: [{status: 'suggested'}]}, submit: true});
    assert.match(blocked.json().message, /непринятые подсказки/);
    const broken = stoneSkin();
    broken.duration = {...broken.duration, kind: 'instant', concentration: true};
    assert.match((await request('PUT', `${tpl}/${playerSpell}`, alice.token, {template: broken, submit: true})).json().message, /Концентрация у мгновенного/);
    const sent = await request('PUT', `${tpl}/${playerSpell}`, alice.token, {template: stoneSkin(), suggestions: {items: [{status: 'accepted'}]}, submit: true});
    assert.equal(sent.json().spell.status, 'pending', sent.body);
    assert.equal((await request('POST', `${tpl}/${playerSpell}/review`, alice.token, {decision: 'approve'})).statusCode, 403, 'a player cannot review');
    const rework = await request('POST', `${tpl}/${playerSpell}/review`, gm.token, {decision: 'rework', note: 'Слишком сильно для 1 круга'});
    assert.deepEqual([rework.json().spell.status, rework.json().spell.reviewNote], ['rework', 'Слишком сильно для 1 круга']);
    await request('PUT', `${tpl}/${playerSpell}`, alice.token, {template: stoneSkin(), submit: true});
    const edited = stoneSkin();
    edited.passport.level = 2;
    const approved = await request('POST', `${tpl}/${playerSpell}/review`, gm.token, {decision: 'approve', template: edited});
    assert.equal(approved.json().spell.status, 'approved', approved.body);
    assert.equal(approved.json().spell.template.passport.level, 2, 'approved with the GM’s edits');
  });

  await t.test('a player edits an approved spell: a pending version, the old one stays in play', async () => {
    const changed = stoneSkin();
    changed.passport.level = 2;
    changed.passport.name = 'Каменный покров (сильнее)';
    const proposed = await request('PUT', `${tpl}/${playerSpell}`, alice.token, {template: changed, submit: true});
    assert.equal(proposed.json().proposal.status, 'pending', proposed.body);
    assert.equal(proposed.json().spell.template.passport.name, 'Каменный покров', 'still the old one in play');
    await request('POST', `${tpl}/${playerSpell}/review`, gm.token, {decision: 'reject', note: 'нет'});
    assert.equal((await request('GET', `${tpl}/${playerSpell}`, gm.token)).json().spell.template.passport.name, 'Каменный покров');
    await request('PUT', `${tpl}/${playerSpell}`, alice.token, {template: changed, submit: true});
    const accepted = await request('POST', `${tpl}/${playerSpell}/review`, gm.token, {decision: 'approve'});
    assert.deepEqual([accepted.json().spell.template.passport.name, accepted.json().spell.templateVersion], ['Каменный покров (сильнее)', 2]);
    await request('PUT', `${tpl}/${playerSpell}`, gm.token, {template: {...stoneSkin(), passport: {...stoneSkin().passport, level: 2}}});
  });

  await t.test('apply in another of the GM’s campaigns: a copy, then the same copy updated; the special window toggle', async () => {
    const others = (await request('GET', `${tpl}/other-campaigns`, gm.token)).json().campaigns.map((entry: any) => entry.id);
    assert.deepEqual(others, [otherCampaign]);
    const first = await request('POST', `${tpl}/${gmSpell}/apply`, gm.token, {campaignIds: [otherCampaign]});
    assert.deepEqual(first.json().applied.map((entry: any) => entry.created), [true], first.body);
    const again = await request('POST', `${tpl}/${gmSpell}/apply`, gm.token, {campaignIds: [otherCampaign]});
    assert.deepEqual(again.json().applied.map((entry: any) => entry.created), [false]);
    assert.equal((await request('POST', `${tpl}/${gmSpell}/apply`, alice.token, {campaignIds: [otherCampaign]})).statusCode, 403);
    assert.equal((await request('PATCH', `${tpl}/${playerSpell}/special`, gm.token, {notify: false})).json().specialNotify, false);
    await request('PATCH', `${tpl}/${playerSpell}/special`, gm.token, {notify: true});
  });

  await t.test('a picture: own upload kept, a foreign id dropped, a library path kept; another campaign gets its own copy', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('spell picture')]);
    const boundary = '----spellPictureBoundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="frost.png"\r\nContent-Type: image/png\r\n\r\n`),
      png, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const uploaded = await asApp(() => app.inject({method: 'POST', url: `${base}/assets?kind=object_image`, headers: {authorization: `Bearer ${alice.token}`, 'content-type': `multipart/form-data; boundary=${boundary}`}, payload: body}));
    assert.equal(uploaded.statusCode, 201, uploaded.body);
    const assetId = uploaded.json().id as string;
    t.after(() => unlink(join(ASSETS_DIR, `${assetId}.png`)).catch(() => {}));

    const pictured = (art: string, name: string) => ({...iceStrike(), passport: {...iceStrike().passport, name, art}});
    const own = await request('POST', tpl, gm.token, {template: pictured(assetId, 'Ледяной удар с картинкой'), submit: true});
    assert.equal(own.statusCode, 201, own.body);
    assert.equal(own.json().spell.template.passport.art, assetId);
    const foreign = await request('POST', tpl, gm.token, {template: pictured('0c2b1e5a-1111-4222-8333-944445555666', 'Чужая картинка'), submit: true});
    assert.equal(foreign.json().spell.template.passport.art, '');
    const library = await request('POST', tpl, gm.token, {template: pictured('items/magic/cold/ice-shard', 'Из библиотеки'), submit: true});
    assert.equal(library.json().spell.template.passport.art, 'items/magic/cold/ice-shard');

    const applied = (await request('POST', `${tpl}/${own.json().spell.id}/apply`, gm.token, {campaignIds: [otherCampaign]})).json().applied[0];
    const there = (await request('GET', `/campaigns/${otherCampaign}/spell-templates/${applied.spellId}`, gm.token)).json();
    const copyId = there.spell.template.passport.art as string;
    assert.match(copyId, /^[0-9a-f-]{36}$/);
    assert.notEqual(copyId, assetId);
    t.after(() => unlink(join(ASSETS_DIR, `${copyId}.png`)).catch(() => {}));
    const served = await asApp(() => app.inject({method: 'GET', url: `/campaigns/${otherCampaign}/assets/${copyId}`, headers: {authorization: `Bearer ${gm.token}`}}));
    assert.equal(served.statusCode, 200);
    assert.deepEqual(Buffer.from(served.rawPayload), await readFile(join(ASSETS_DIR, `${assetId}.png`)));
  });

  const hero = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 40, hpCurrent: 40, level: 5, ...extra})).json();
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name, disposition: 'hostile', hpMax: 200, hpCurrent: 200, armorClass: 1, ...extra})).json();
  const effect = async (characterId: string, effectCode: string) =>
    (await pg.query<any>('SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code=$2 AND active', [characterId, effectCode])).rows.map(row => row.parameters);
  const learn = async (characterId: string, customSpellId: string) => {
    const made = await request('POST', `${base}/characters/${characterId}/spells`, gm.token, {source: 'custom', customSpellId});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const cast = (characterId: string, entry: string, body: any) => request('POST', `${base}/characters/${characterId}/spells/${entry}/cast`, alice.token, {sceneId, ...body});

  const mage = await hero('Чародейка', {intelligence: 18, wisdom: 12, armorClass: 12, speedFeet: 30});
  const goblin = await npc('Гоблин');
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: mage.id, x: 0.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 2.5, z: 0.5});
  await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,9,9), ($1,$2,2,9,9)`, [campaignId, mage.id]);

  await t.test('cast «Ледяной удар»: the table’s attack, damage and a short slow', async () => {
    const entry = await learn(mage.id, gmSpell);
    const list = (await request('GET', `${base}/characters/${mage.id}/spells`, alice.token)).json().spells;
    const view = list.find((row: any) => row.id === entry).spell;
    assert.equal(view.mechanics.attack, 'ranged');
    assert.equal(view.needsTarget, true);
    let landed: any = null;
    for (let i = 0; i < 40 && !landed; i++) {
      const done = await cast(mage.id, entry, {targetIds: [goblin.id]});
      assert.ok(done.statusCode < 300, done.body);
      const attack = done.json().targets?.[0]?.attack;
      if (attack?.hit && !attack.critical) landed = done.json();
    }
    assert.ok(landed, 'hit without a critical at least once');
    assert.equal(landed.damageRoll.formula, '2d8');
    assert.deepEqual((await effect(goblin.id, 'slowed')).map(row => row.feet), [10]);
  });

  await t.test('cast «Каменный покров» on oneself: AC floor, fire resistance, WIS advantage, +10 ft, no fear, a note for the GM', async () => {
    const entry = await learn(mage.id, playerSpell);
    const done = await cast(mage.id, entry, {slotLevel: 2});
    assert.ok(done.statusCode < 300, done.body);
    assert.deepEqual(done.json().template.manual, ['«Покров»: особое — мастеру: «Кожа звенит, как камень, — враги это слышат»']);
    const mods = await effect(mage.id, 'spell_mod');
    assert.deepEqual(mods.map(row => row.kind).sort(), ['ac', 'checks', 'defense', 'defense', 'speed']);
    await pg.query('UPDATE scene_objects SET x=1.5 WHERE character_id=$1', [goblin.id]);
    const bite = (await request('POST', `${base}/characters/${goblin.id}/weapons`, gm.token, {name: 'Укус', ability: 'strength', proficient: false, damageFormula: '1d1'})).json().id;
    const preview = (await request('GET', `${base}/rolls/attack-preview?characterId=${goblin.id}&key=${bite}&targetCharacterId=${mage.id}&sceneId=${sceneId}&advantage=none`, gm.token)).json();
    assert.ok(Math.abs(Number(preview.hitChance) - 0.2) < 0.051, JSON.stringify(preview));
    const fire = (await request('POST', `${base}/rolls`, gm.token, {formula: '1d1+9'})).json();
    const burned = (await request('POST', `${base}/rolls/${fire.id}/apply`, gm.token, {characterId: mage.id, mode: 'damage', damageType: 'fire'})).json();
    assert.equal(burned.applied, 5, JSON.stringify(burned));
    const save = await request('POST', `${base}/rolls/check`, alice.token, {characterId: mage.id, kind: 'save', key: 'wisdom'});
    assert.ok(JSON.stringify(save.json().outcome).includes('каменный покров'), JSON.stringify(save.json().outcome));
    const scared = await request('POST', `${base}/characters/${mage.id}/conditions`, gm.token, {code: 'frightened'});
    assert.equal((await effect(mage.id, 'frightened')).length, 0, `immune: ${scared.body}`);
    await request('POST', `${scenePath}/initiative/join`, alice.token, {characterId: mage.id});
    await pg.query('UPDATE initiative_entries SET is_current = (character_id = $1) WHERE scene_id=$2', [mage.id, sceneId]);
    const placement = (await pg.query<any>('SELECT id FROM scene_objects WHERE character_id=$1', [mage.id])).rows[0].id;
    const reach = (await request('GET', `${scenePath}/objects/${placement}/reach`, alice.token)).json();
    assert.equal(reach.budget, 40, JSON.stringify(reach));
    await pg.query('DELETE FROM initiative_entries WHERE scene_id=$1', [sceneId]);
  });

  await t.test('a spell not yet approved does not cast', async () => {
    const draft = await request('POST', tpl, alice.token, {template: {...iceStrike(), passport: {...iceStrike().passport, name: 'Черновой удар'}}});
    const learned = await request('POST', `${base}/characters/${mage.id}/spells`, alice.token, {source: 'custom', customSpellId: draft.json().spell.id});
    assert.equal(learned.statusCode, 201, learned.body);
    assert.match((await cast(mage.id, learned.json().id, {targetIds: [goblin.id]})).json().message, /ещё не одобрено/);
  });
});
