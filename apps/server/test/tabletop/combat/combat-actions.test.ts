import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('grapple, shove, escape, help, rituals', async t => {
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
  const gm = await register('gm_actions'), alice = await register('alice_actions');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Actions'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const hero = async (name: string, className: string, level: number, extra: any = {}, sheetExtra: any = {}) => {
    const made = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 60, hpCurrent: 60, level, speedFeet: 30, ...extra})).json();
    await pg.query('UPDATE characters SET class_name=$2, sheet_extra=$3::jsonb WHERE id=$1', [made.id, className, JSON.stringify(sheetExtra)]);
    return made;
  };
  const npc = async (name: string, extra: any = {}) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 100, hpCurrent: 100, armorClass: 1, speedFeet: 30, strength: 1, dexterity: 1, ...extra,
  })).json();
  const athlete = async (id: string) => pg.query(`INSERT INTO character_skills(campaign_id, character_id, skill_index, proficient, expertise) VALUES($1,$2,'athletics',true,true)`, [campaignId, id]);
  const scene = async (name: string, members: Array<[string, string, number, number]>) => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name, widthCells: 24, heightCells: 12})).json().id;
    for (const [token, characterId, x, z] of members) {
      const placed = await request('POST', `${base}/scenes/${sceneId}/objects`, token, {characterId, x, z});
      assert.equal(placed.statusCode, 201, placed.body);
    }
    return sceneId as string;
  };
  const act = (characterId: string, body: any, token = alice.token) => request('POST', `${base}/characters/${characterId}/combat-action`, token, body);
  const effects = async (id: string) => (await pg.query<any>('SELECT effect_code, parameters FROM character_effects WHERE character_id=$1 AND active', [id])).rows;
  const position = async (sceneId: string, id: string) => {
    const row = (await pg.query<any>('SELECT x::float8 AS x, z::float8 AS z FROM scene_objects WHERE scene_id=$1 AND character_id=$2', [sceneId, id])).rows[0];
    return [Number(row.x), Number(row.z)];
  };

  const strong = await hero('Борец', 'Воин', 20, {strength: 30});
  await athlete(strong.id);
  const weak = await hero('Хлюпик', 'Волшебник', 1, {strength: 1, dexterity: 1});

  await t.test('grapple: a contest of Athletics; the target is held, by whom is remembered', async () => {
    const goblin = await npc('Гоблин');
    const far = await npc('Дальний');
    const giant = await npc('Великан', {size: 'huge', strength: 1});
    const sceneId = await scene('Арена', [[alice.token, strong.id, 0.5, 0.5], [gm.token, goblin.id, 1.5, 0.5], [gm.token, far.id, 6.5, 0.5], [gm.token, giant.id, 0.5, 2.5]]);
    const held = await act(strong.id, {action: 'grapple', targetId: goblin.id, sceneId});
    assert.equal(held.statusCode, 201, held.body);
    assert.equal(held.json().won, true);
    assert.match(held.json().message, /«Захват» — Атлетика \d+ против (Атлетики|Акробатики) -?\d+ у «Гоблин»: схвачен/);
    const grappled = (await effects(goblin.id)).find((effect: any) => effect.effect_code === 'grappled');
    assert.equal(grappled.parameters.sourceCharacterId, strong.id);
    assert.match((await act(strong.id, {action: 'grapple', targetId: goblin.id, sceneId})).json().message, /уже держит/);
    assert.match((await act(strong.id, {action: 'grapple', targetId: far.id, sceneId})).json().message, /дальше 5 футов/);
    assert.match((await act(strong.id, {action: 'grapple', targetId: giant.id, sceneId})).json().message, /слишком велик/);
    const rolls = (await pg.query<any>(`SELECT label FROM roll_log WHERE label LIKE 'Захват%' ORDER BY created_at`)).rows.map(row => row.label);
    assert.ok(rolls.includes('Захват: Атлетика — Борец') && rolls.includes('Захват: сопротивление — Гоблин'), rolls.join('; '));

    const escape = await act(goblin.id, {action: 'escape', sceneId}, gm.token);
    assert.equal(escape.statusCode, 201, escape.body);
    assert.equal(escape.json().won, false);
    assert.ok((await effects(goblin.id)).some((effect: any) => effect.effect_code === 'grappled'));
    await pg.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'grappled','{"source":"apply","escapeDc":15}'::jsonb)`, [campaignId, strong.id]);
    const free = (await act(strong.id, {action: 'escape'})).json();
    assert.equal(free.won, true, 'Athletics +22 against DC 15');
    assert.match(free.message, /против СЛ 15: вырвался/);
    assert.ok(!(await effects(strong.id)).some((effect: any) => effect.effect_code === 'grappled'));
    assert.equal((await act(weak.id, {action: 'escape'})).statusCode, 400, 'not grappled');
  });

  await t.test('shove: prone or 5 feet away; the loser does nothing; Shield Master shoves as a bonus action', async () => {
    const orc = await npc('Орк');
    const sceneId = await scene('Мост', [[alice.token, strong.id, 0.5, 0.5], [gm.token, orc.id, 1.5, 0.5], [alice.token, weak.id, 0.5, 1.5]]);
    assert.equal((await act(strong.id, {action: 'shove-prone', targetId: orc.id, sceneId})).json().won, true);
    assert.ok((await effects(orc.id)).some((effect: any) => effect.effect_code === 'prone'));
    const before = await position(sceneId, orc.id);
    const push = (await act(strong.id, {action: 'shove-push', targetId: orc.id, sceneId})).json();
    assert.match(push.message, /оттолкнут на 5 фт\./);
    assert.deepEqual(await position(sceneId, orc.id), [before[0]! + 1, before[1]]);
    const tough = await npc('Скала', {strength: 30});
    await pg.query('UPDATE characters SET challenge_rating=20 WHERE id=$1', [tough.id]);
    await athlete(tough.id);
    assert.equal((await request('POST', `${base}/scenes/${sceneId}/objects`, gm.token, {characterId: tough.id, x: 1.5, z: 1.5})).statusCode, 201);
    const lost = (await act(weak.id, {action: 'shove-prone', targetId: tough.id, sceneId})).json();
    assert.equal(lost.won, false);
    assert.ok(!(await effects(tough.id)).some((effect: any) => effect.effect_code === 'prone'));
    assert.match((await act(strong.id, {action: 'shove-prone', targetId: tough.id, sceneId, using: 'bonus'})).json().message, /Мастер щита/);
    const shield = await hero('Щитоносец', 'Воин', 20, {strength: 30}, {feats: ['shield-master']});
    await athlete(shield.id);
    assert.equal((await request('POST', `${base}/scenes/${sceneId}/objects`, alice.token, {characterId: shield.id, x: 2.5, z: 1.5})).statusCode, 201);
    assert.equal((await act(shield.id, {action: 'shove-prone', targetId: orc.id, sceneId, using: 'bonus'})).statusCode, 201);
  });

  await t.test('in combat a grapple takes one attack of the Attack action', async () => {
    const wolf = await npc('Волк');
    const sceneId = await scene('Лес', [[alice.token, strong.id, 0.5, 0.5], [gm.token, wolf.id, 1.5, 0.5]]);
    const ids: Record<string, string> = {};
    for (const [id, score] of [[strong.id, 30], [wolf.id, 5]] as const) {
      ids[id] = (await request('POST', `${base}/scenes/${sceneId}/initiative/join`, gm.token, {characterId: id})).json().id;
      await request('PATCH', `${base}/scenes/${sceneId}/initiative/${ids[id]}`, gm.token, {score});
    }
    await request('POST', `${base}/scenes/${sceneId}/initiative/advance`, gm.token, {});
    assert.equal((await act(strong.id, {action: 'grapple', targetId: wolf.id, sceneId})).statusCode, 201);
    const entry = (await pg.query<any>('SELECT action_used, attacks_made FROM initiative_entries WHERE id=$1', [ids[strong.id]])).rows[0];
    assert.equal(entry.action_used || entry.attacks_made > 0, true, 'one attack spent');
    await pg.query(`DELETE FROM character_effects WHERE character_id=$1 AND effect_code='grappled'`, [wolf.id]);
    assert.equal((await act(wolf.id, {action: 'help', targetId: wolf.id, sceneId}, gm.token)).statusCode, 400, 'not your turn — and not yourself');
  });

  await t.test('help: advantage to the ally’s next check, or to the first attack on a foe next to the helper', async () => {
    const helper = await hero('Помощник', 'Плут', 3);
    const ally = await hero('Союзник', 'Воин', 3, {strength: 10});
    const foe = await npc('Разбойник', {armorClass: 1});
    const distant = await npc('Вдалеке');
    const sceneId = await scene('Лагерь', [[alice.token, helper.id, 0.5, 0.5], [alice.token, ally.id, 0.5, 1.5], [gm.token, foe.id, 1.5, 0.5], [gm.token, distant.id, 8.5, 0.5]]);
    const help = await act(helper.id, {action: 'help', targetId: ally.id, sceneId});
    assert.equal(help.statusCode, 201, help.body);
    const check = async () => (await request('POST', `${base}/rolls/check`, alice.token, {characterId: ally.id, kind: 'skill', key: 'athletics'})).json();
    const helped = await check();
    assert.equal(helped.dice_results.length, 2);
    assert.ok(helped.outcome.reasons.includes('преимущество: помощь: Помощник'));
    assert.equal((await check()).dice_results.length, 1, 'spent');

    assert.equal((await act(helper.id, {action: 'help', targetId: ally.id, foeId: distant.id, sceneId})).statusCode, 400, 'the foe must be next to the helper');
    assert.equal((await act(helper.id, {action: 'help', targetId: ally.id, foeId: foe.id, sceneId})).statusCode, 201);
    const sword = (await request('POST', `${base}/characters/${ally.id}/weapons`, alice.token, {name: 'Меч', ability: 'strength', proficient: false, damageFormula: '1d1'})).json();
    const strike = (await request('POST', `${base}/rolls/check`, alice.token, {characterId: ally.id, kind: 'attack', key: sword.id, targetCharacterId: foe.id, sceneId})).json();
    assert.equal(strike.outcome.advantage, 'adv');
    assert.ok(strike.outcome.reasons.includes('преимущество: помощь: Помощник'));
    assert.equal((await check()).dice_results.length, 1, 'the attack help is not a check help');
    assert.ok(!(await effects(ally.id)).some((effect: any) => effect.effect_code === 'helped'), 'used up');
  });

  await t.test('rituals: no slot, ten minutes, not in a fight, only for ritual casters', async () => {
    const wizard = await hero('Книжник', 'Волшебник', 3, {intelligence: 16});
    const fighter = await hero('Рубака', 'Воин', 3);
    const learn = async (id: string, srdIndex: string) => (await request('POST', `${base}/characters/${id}/spells`, gm.token, {source: 'srd', srdIndex})).json().id as string;
    const detect = await learn(wizard.id, 'detect-magic');
    const missile = await learn(wizard.id, 'magic-missile');
    const cast = (id: string, entry: string, body: any) => request('POST', `${base}/characters/${id}/spells/${entry}/cast`, alice.token, body);
    const minutes = async () => Number((await pg.query<any>('SELECT world_minutes FROM campaigns WHERE id=$1', [campaignId])).rows[0].world_minutes);
    assert.match((await cast(wizard.id, detect, {})).json().message, /ячеек/, 'no slots — the usual way fails');
    const before = await minutes();
    const ritual = await cast(wizard.id, detect, {ritual: true});
    assert.equal(ritual.statusCode, 201, ritual.body);
    assert.equal(await minutes(), before + 10);
    assert.match((await cast(wizard.id, missile, {ritual: true})).json().message, /не ритуал/);
    assert.equal((await cast(wizard.id, detect, {ritual: true, slotLevel: 2})).statusCode, 400);
    assert.match((await cast(fighter.id, await learn(fighter.id, 'detect-magic'), {ritual: true})).json().message, /не умеет колдовать ритуалы/);
    const feat = await hero('Ритуалист', 'Воин', 3, {}, {feats: ['ritual-caster']});
    assert.equal((await cast(feat.id, await learn(feat.id, 'detect-magic'), {ritual: true})).statusCode, 201, 'the Ritual Caster feat');
    const sceneId = await scene('Бой', [[alice.token, wizard.id, 0.5, 0.5]]);
    const entryId = (await request('POST', `${base}/scenes/${sceneId}/initiative/join`, gm.token, {characterId: wizard.id})).json().id;
    await request('PATCH', `${base}/scenes/${sceneId}/initiative/${entryId}`, gm.token, {score: 10});
    await request('POST', `${base}/scenes/${sceneId}/initiative/advance`, gm.token, {});
    assert.match((await cast(wizard.id, detect, {ritual: true, sceneId})).json().message, /в бою нельзя/);
  });
});
