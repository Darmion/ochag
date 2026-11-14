import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';
import {emptyAction, emptyEffect, emptyTemplate, type Effect, type EffectKind, type SpellTemplate} from '../../../../packages/domain/spells/spell-template.ts';

test('template runtime: other outcomes, second actions, a pull and actions at turn boundaries', async t => {
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
  const gm = await register('gm_runtime'), alice = await register('alice_runtime');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Движок'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Поле', widthCells: 20, heightCells: 20})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const effect = (kind: EffectKind, values: Record<string, unknown>): Effect => {
    const made = emptyEffect(kind);
    Object.assign(made.values, values);
    return made;
  };
  const spell = (name: string, build: (s: SpellTemplate) => void) => {
    const s = emptyTemplate();
    s.passport = {...s.passport, name, level: 1, school: 'evocation', description: name};
    s.casting = {...s.casting, rangeValue: 60};
    build(s);
    return s;
  };
  const approved = async (template: SpellTemplate) => {
    const made = await request('POST', `${base}/spell-templates`, gm.token, {template, submit: true});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().spell.id as string;
  };
  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Чародейка', hpMax: 40, hpCurrent: 40, level: 5, intelligence: 18})).json();
  const goblin = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 500, hpCurrent: 500, armorClass: 1})).json();
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: 0.5, z: 0.5});
  const goblinAt = (await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 4.5, z: 0.5})).json().id;
  await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,20,20)`, [campaignId, hero.id]);
  const learn = async (customSpellId: string) => (await request('POST', `${base}/characters/${hero.id}/spells`, gm.token, {source: 'custom', customSpellId})).json().id as string;
  const cast = (entry: string, body: any) => request('POST', `${base}/characters/${hero.id}/spells/${entry}/cast`, alice.token, {sceneId, ...body});
  const effects = async (characterId: string, code: string) =>
    (await pg.query<any>('SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code=$2 AND active', [characterId, code])).rows.map(row => row.parameters);
  const hp = async (characterId: string) => (await pg.query<any>('SELECT hp_current, hp_temp FROM characters WHERE id=$1', [characterId])).rows[0];

  await t.test('a save’s success has its own effect, and a second action at casting reaches the caster', async () => {
    const grip = await approved(spell('Ледяная хватка', s => {
      const grab = emptyAction('Хватка');
      grab.check = {...grab.check, kind: 'save', ability: 'constitution'};
      grab.outcomes.fail = [effect('damage', {formula: '2к6', damageType: 'cold'})];
      grab.outcomes.success = [effect('speed', {mode: 'minus', feet: 10, lasts: 'rounds', lastsRounds: 2})];
      const warmth = emptyAction('Тепло');
      warmth.who = 'caster';
      warmth.outcomes.always = [effect('temp-hp', {formula: '5'})];
      s.actions = [grab, warmth];
    }));
    const entry = await learn(grip);
    await pg.query('UPDATE characters SET spell_save_dc_override=1 WHERE id=$1', [hero.id]);
    const easy = await cast(entry, {targetIds: [goblin.id]});
    assert.ok(easy.statusCode < 300, easy.body);
    assert.equal(easy.json().targets.find((row: any) => row.characterId === goblin.id).save.success, true);
    assert.deepEqual((await effects(goblin.id, 'spell_mod')).map(row => [row.kind, row.values.mode, row.values.feet, row.remainingRounds]), [['speed', 'minus', 10, 2]], 'the success outcome is applied, not left to the GM');
    assert.equal((await hp(hero.id)).hp_temp, 5, 'the caster gets the second action');
    assert.ok(!easy.json().template.manual.length, JSON.stringify(easy.json().template.manual));
    assert.ok(easy.json().targets.some((row: any) => row.characterId === hero.id && row.notes?.some((note: string) => /5 врем\. хитов/.test(note))));

    await pg.query('UPDATE characters SET spell_save_dc_override=30 WHERE id=$1', [hero.id]);
    const before = (await hp(goblin.id)).hp_current;
    const hard = await cast(entry, {targetIds: [goblin.id]});
    assert.equal(hard.json().targets.find((row: any) => row.characterId === goblin.id).save.success, false);
    assert.ok((await hp(goblin.id)).hp_current < before, 'the fail outcome — the table’s own damage');
    await pg.query('UPDATE characters SET spell_save_dc_override=NULL WHERE id=$1', [hero.id]);
  });

  await t.test('a second damage and a pull of the same outcome are not left to the GM', async () => {
    const whip = await approved(spell('Хлыст молний', s => {
      const lash = emptyAction('Хлыст');
      lash.outcomes.always = [effect('damage', {formula: '1к4', damageType: 'lightning'}), effect('damage', {formula: '1', damageType: 'thunder'}), effect('move', {mode: 'pull', feet: 10})];
      s.actions = [lash];
    }));
    const entry = await learn(whip);
    const done = await cast(entry, {targetIds: [goblin.id]});
    assert.ok(done.statusCode < 300, done.body);
    assert.deepEqual(done.json().template.manual, []);
    const at = (await pg.query<any>('SELECT x FROM scene_objects WHERE id=$1', [goblinAt])).rows[0];
    assert.equal(at.x, 2.5, 'pulled 10 feet toward the caster');
    const note = done.json().targets.find((row: any) => row.characterId === goblin.id).notes.join(' ');
    assert.match(note, /звук/);
    assert.match(note, /притянут на 10 фт/);
    const closer = await cast(entry, {targetIds: [goblin.id]});
    assert.ok(closer.json().targets.find((row: any) => row.characterId === goblin.id).notes.some((text: string) => /притянут на 5 фт/.test(text)), 'stops next to the caster');
    assert.equal((await pg.query<any>('SELECT x FROM scene_objects WHERE id=$1', [goblinAt])).rows[0].x, 1.5);
  });

  await t.test('an action at the end of the target’s turn burns once, then it is gone', async () => {
    const arrow = await approved(spell('Кислотная стрела', s => {
      const shot = emptyAction('Стрела');
      shot.outcomes.always = [effect('damage', {formula: '1к4', damageType: 'acid'})];
      const burn = emptyAction('Жжение');
      burn.when = 'target-turn-end';
      burn.times = 'spell';
      burn.outcomes.always = [effect('damage', {formula: '2', damageType: 'acid'})];
      s.duration = {...s.duration, kind: 'rounds', value: 2};
      s.actions = [shot, burn];
    }));
    const entry = await learn(arrow);
    const initiative = `${scenePath}/initiative`;
    const mine = (await request('POST', `${initiative}/join`, alice.token, {characterId: hero.id})).json().id;
    const theirs = (await request('POST', `${initiative}/join`, gm.token, {characterId: goblin.id})).json().id;
    await request('PATCH', `${initiative}/${mine}`, gm.token, {score: 20});
    await request('PATCH', `${initiative}/${theirs}`, gm.token, {score: 5});
    await request('POST', `${initiative}/advance`, gm.token, {});
    const done = await cast(entry, {targetIds: [goblin.id]});
    assert.ok(done.statusCode < 300, done.body);
    assert.equal((await effects(goblin.id, 'spell_action')).length, 1);
    assert.deepEqual(done.json().template.manual, [], 'the later burn is not a manual note any more');
    await request('POST', `${initiative}/advance`, gm.token, {});
    const before = (await hp(goblin.id)).hp_current;
    await request('POST', `${initiative}/advance`, gm.token, {});
    assert.equal((await hp(goblin.id)).hp_current, before - 2, 'the acid burns at the end of its turn');
    assert.equal((await effects(goblin.id, 'spell_action')).length, 0, 'once per spell — gone');
    const rolls = (await request('GET', `${base}/rolls`, gm.token)).json().rolls;
    assert.ok(rolls.some((roll: any) => /^Урон: Жжение — Гоблин/.test(roll.label)), JSON.stringify(rolls.slice(0, 3).map((roll: any) => roll.label)));
  });
});
