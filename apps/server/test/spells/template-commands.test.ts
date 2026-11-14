import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';
import {emptyAction, emptyEffect, emptyTemplate, type Effect, type EffectKind} from '../../../../packages/domain/spells/spell-template.ts';

test('template commands and the end of a spell', async t => {
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
  const gm = await register('gm_cmd'), alice = await register('alice_cmd'), bob = await register('bob_cmd');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Команды'})).json().id;
  for (const member of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Башня', widthCells: 20, heightCells: 20})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const effect = (kind: EffectKind, values: Record<string, unknown>): Effect => Object.assign(emptyEffect(kind), {values: {...emptyEffect(kind).values, ...values}});

  const bolt = emptyTemplate();
  bolt.passport = {...bolt.passport, name: 'Цепкая молния', level: 1, school: 'evocation', description: 'Молния'};
  bolt.casting = {...bolt.casting, rangeValue: 30};
  bolt.duration = {...bolt.duration, kind: 'minutes', value: 1, concentration: true};
  const first = emptyAction('Удар молнии');
  first.outcomes.always = [effect('damage', {formula: '1', damageType: 'lightning'})];
  const again = emptyAction('Разряд');
  again.when = 'command';
  again.outcomes.always = [effect('damage', {formula: '3', damageType: 'lightning'})];
  bolt.actions = [first, again];
  bolt.commands = [{id: 'c1', name: 'Снова разряд', cost: 'action', when: 'after-cast', does: 'run-action', feet: 0, actionId: again.id, limit: 'turn', limitCount: 1}];
  const fade = emptyAction('Оцепенение');
  fade.outcomes.always = [effect('condition', {code: 'prone', duration: 'rounds', rounds: 1})];
  bolt.ending = {...bolt.ending, onEnd: [fade]};
  const made = await request('POST', `${base}/spell-templates`, gm.token, {template: bolt, submit: true});
  assert.equal(made.statusCode, 201, made.body);

  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Чародейка', hpMax: 40, hpCurrent: 40, level: 5, charisma: 18})).json();
  const goblin = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 100, hpCurrent: 100})).json();
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: 0.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 3.5, z: 0.5});
  await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,9,9)`, [campaignId, hero.id]);
  const entry = (await request('POST', `${base}/characters/${hero.id}/spells`, gm.token, {source: 'custom', customSpellId: made.json().spell.id})).json().id;
  const hp = async () => Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [goblin.id])).rows[0].hp_current);
  const commands = async (token = alice.token) => request('GET', `${base}/characters/${hero.id}/spell-commands?sceneId=${sceneId}`, token);
  const use = (effectId: string, token = alice.token) => request('POST', `${base}/characters/${hero.id}/spell-commands/${effectId}`, token, {commandId: 'c1', sceneId, targetIds: [goblin.id]});
  const prone = async () => (await pg.query<any>(`SELECT 1 FROM character_effects WHERE character_id=$1 AND effect_code='prone' AND active`, [goblin.id])).rows.length;

  const initiative = `${scenePath}/initiative`;
  const mine = (await request('POST', `${initiative}/join`, alice.token, {characterId: hero.id})).json().id;
  const theirs = (await request('POST', `${initiative}/join`, gm.token, {characterId: goblin.id})).json().id;
  await request('PATCH', `${initiative}/${mine}`, gm.token, {score: 20});
  await request('PATCH', `${initiative}/${theirs}`, gm.token, {score: 5});
  await request('POST', `${initiative}/advance`, gm.token, {});

  let effectId = '';
  await t.test('after casting the button waits for the next turn, then works once a turn', async () => {
    const cast = await request('POST', `${base}/characters/${hero.id}/spells/${entry}/cast`, alice.token, {sceneId, targetIds: [goblin.id]});
    assert.ok(cast.statusCode < 300, cast.body);
    assert.deepEqual(cast.json().template.manual, []);
    assert.equal((await commands(bob.token)).statusCode, 403, 'not someone else’s caster');
    const listed = (await commands()).json().spells;
    assert.equal(listed.length, 1);
    effectId = listed[0].effectId;
    assert.deepEqual(listed[0].commands.map((command: any) => [command.name, command.blocked]), [['Снова разряд', 'со следующего хода']]);
    assert.match((await use(effectId)).json().message, /со следующего хода/);
    await request('POST', `${initiative}/advance`, gm.token, {});
    await request('POST', `${initiative}/advance`, gm.token, {});
    const before = await hp();
    const used = await use(effectId);
    assert.equal(used.statusCode, 200, used.body);
    assert.equal(await hp(), before - 3, 'the command runs its action from the table');
    assert.match(used.json().lines[0].text, /3 урона/);
    assert.match((await use(effectId)).json().message, /уже в этот ход/);
  });

  await t.test('ending the concentration runs the action at the end', async () => {
    assert.equal(await prone(), 0);
    const held = (await pg.query<any>(`SELECT id FROM character_effects WHERE character_id=$1 AND effect_code='concentration' AND active`, [hero.id])).rows[0];
    assert.equal((await request('DELETE', `${base}/characters/${hero.id}/effects/${held.id}`, alice.token)).statusCode, 204);
    assert.equal(await prone(), 1, 'on end: the target is knocked down');
    assert.equal((await commands()).json().spells.length, 0, 'the spell and its buttons are gone');
    assert.equal((await use(effectId)).statusCode, 404);
  });
});
