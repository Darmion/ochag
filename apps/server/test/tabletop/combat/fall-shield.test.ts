import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('falling, slow fall, shield master against traps and half-damage saves', async t => {
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
  const gm = await register('gm_fall'), alice = await register('alice_fall');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Falls'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const hero = async (name: string, className: string, level: number, extra: any = {}) => {
    const made = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name, hpMax: 300, hpCurrent: 300, level, speedFeet: 30, ...extra})).json();
    await pg.query('UPDATE characters SET class_name=$2 WHERE id=$1', [made.id, className]);
    return made;
  };
  const npc = async (name: string) => (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name, disposition: 'hostile', hpMax: 1000, hpCurrent: 1000, armorClass: 10, speedFeet: 30,
  })).json();
  const hp = async (id: string) => Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [id])).rows[0].hp_current);
  const codes = async (id: string) => (await pg.query<any>('SELECT effect_code FROM character_effects WHERE character_id=$1 AND active', [id])).rows.map(row => row.effect_code as string);
  const fall = (characterId: string, feet: number, token = gm.token) => request('POST', `${base}/characters/${characterId}/fall`, token, {feet});
  const lastRoll = async (characterId: string, like: string) => (await pg.query<any>(
    `SELECT formula, outcome, total FROM roll_log WHERE character_id=$1 AND label LIKE $2 ORDER BY created_at DESC LIMIT 1`, [characterId, like],
  )).rows[0];
  const saveBonus = (id: string, ability: string, bonus: number) => pg.query(
    'INSERT INTO character_saves (campaign_id, character_id, ability, proficient, custom_bonus) VALUES ($1,$2,$3,false,$4)', [campaignId, id, ability, bonus],
  );
  const shieldUp = async (id: string) => {
    const shield = (await request('POST', `${base}/characters`, alice.token, {kind: 'object', name: 'Щит'})).json();
    await pg.query('UPDATE characters SET container_id=$2 WHERE id=$1', [shield.id, id]);
  };

  await t.test('a fall: 1d6 per 10 ft (up to 20d6), prone when hurt; under 10 ft — nothing', async () => {
    const climber = await hero('Скалолаз', 'Воин', 5);
    const done = await fall(climber.id, 30);
    assert.equal(done.statusCode, 200, done.body);
    const lost = 300 - await hp(climber.id);
    assert.ok(lost >= 3 && lost <= 18, `3d6: ${lost}`);
    assert.equal(done.json().applied, lost);
    assert.ok((await codes(climber.id)).includes('prone'));
    assert.match(done.json().message, /падение с 30 фут\. — 3к6/);
    const roll = await lastRoll(climber.id, 'Падение%');
    assert.equal(roll.formula, '3d6');
    assert.equal(roll.outcome.damageType, 'bludgeoning');

    const short = await hero('Прыгун', 'Воин', 5);
    const hop = await fall(short.id, 5);
    assert.equal(hop.statusCode, 200);
    assert.match(hop.json().message, /без урона/);
    assert.ok(!(await codes(short.id)).includes('prone'));

    const deep = await hero('Бездна', 'Воин', 5, {hpMax: 500, hpCurrent: 500});
    await fall(deep.id, 500);
    assert.equal((await lastRoll(deep.id, 'Падение%')).formula, '20d6', 'no more than 20d6');

    const foe = await npc('Чужой');
    assert.equal((await fall(foe.id, 30, alice.token)).statusCode, 403, 'a player cannot drop the GM’s creature');
    assert.equal((await fall(short.id, 20, alice.token)).statusCode, 200, 'but can jump with their own');
  });

  await t.test('slow fall: a monk 4 takes 5 × monk level less, with the reaction; a spent reaction — no', async () => {
    const monk = await hero('Монах', 'Монах', 4, {dexterity: 16, wisdom: 16});
    const softly = await fall(monk.id, 30);
    assert.equal(softly.statusCode, 200, softly.body);
    assert.equal(softly.json().slowFall, 20);
    assert.equal(await hp(monk.id), 300, '3d6 − 20 — nothing');
    assert.ok(!(await codes(monk.id)).includes('prone'), 'no damage — on the feet');
    assert.ok((await lastRoll(monk.id, 'Падение%')).outcome.reasons.includes('медленное падение −20'));

    const foe = await npc('Страж');
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Обрыв', widthCells: 10, heightCells: 10})).json().id;
    await request('POST', `${base}/scenes/${sceneId}/objects`, alice.token, {characterId: monk.id, x: 0.5, z: 0.5});
    await request('POST', `${base}/scenes/${sceneId}/objects`, gm.token, {characterId: foe.id, x: 3.5, z: 0.5});
    assert.equal((await request('POST', `${base}/scenes/${sceneId}/initiative/start`, gm.token, {})).statusCode, 201);
    await pg.query('UPDATE initiative_entries SET reaction_used=true WHERE character_id=$1', [monk.id]);
    const hard = await fall(monk.id, 60);
    assert.equal(hard.json().slowFall, undefined, 'the reaction is gone');
    assert.ok(await hp(monk.id) < 300);
  });

  await t.test('shield master: +2 against a trap on one, and no damage on a saved half-damage DEX save — with the reaction', async () => {
    const guard = await hero('Щитоносец', 'Воин', 5, {dexterity: 12});
    await pg.query(`UPDATE characters SET sheet_extra = '{"feats":["shield-master"]}'::jsonb WHERE id=$1`, [guard.id]);
    await shieldUp(guard.id);
    await saveBonus(guard.id, 'dexterity', 40);
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Коридор', widthCells: 12, heightCells: 6})).json().id;
    const scenePath = `${base}/scenes/${sceneId}`;
    const placed = (await request('POST', `${scenePath}/objects`, alice.token, {characterId: guard.id, x: 0.5, z: 0.5})).json();
    const trap = await request('POST', `${scenePath}/triggers`, gm.token, {
      kind: 'enter', shape: 'circle', x: 2.5, z: 0.5, direction: 0, sizeFeet: 5, name: 'Огненная плита',
      checkKind: 'save', checkKey: 'dexterity', dc: 15, damageFormula: '1d1+19', damageType: 'fire', halfOnSuccess: true, once: false,
    });
    assert.equal(trap.statusCode, 201, trap.body);
    const object = (await request('GET', scenePath, gm.token)).json().objects.find((entry: any) => entry.id === placed.id);
    const moved = await request('PUT', `${scenePath}/objects/${placed.id}`, alice.token, {
      x: 2.5, y: object.y, z: 0.5, rotationY: 0, scale: object.scale, snapToGrid: true, parentObjectId: null, animationName: null, revision: object.revision,
    });
    assert.equal(moved.statusCode, 200, moved.body);
    const save = await lastRoll(guard.id, 'Спасбросок%Огненная плита%');
    assert.ok(save.outcome.reasons.some((reason: string) => /мастер щита/.test(reason)), JSON.stringify(save.outcome));
    assert.equal(await hp(guard.id), 300, 'saved half-damage — the shield takes it all');

    await pg.query(`DELETE FROM characters WHERE container_id=$1 AND name='Щит'`, [guard.id]);
    const spot = (await request('GET', scenePath, gm.token)).json().objects.find((entry: any) => entry.id === placed.id);
    await request('PUT', `${scenePath}/objects/${placed.id}`, alice.token, {
      x: 0.5, y: spot.y, z: 0.5, rotationY: 0, scale: spot.scale, snapToGrid: true, parentObjectId: null, animationName: null, revision: spot.revision,
    });
    const again = (await request('GET', scenePath, gm.token)).json().objects.find((entry: any) => entry.id === placed.id);
    await request('PUT', `${scenePath}/objects/${placed.id}`, alice.token, {
      x: 2.5, y: again.y, z: 0.5, rotationY: 0, scale: again.scale, snapToGrid: true, parentObjectId: null, animationName: null, revision: again.revision,
    });
    assert.equal(await hp(guard.id), 290, 'no shield — the usual half');
  });

  await t.test('shield master against a spell: saved — no damage, and the reaction is spent in combat', async () => {
    const guard = await hero('Страж щита', 'Воин', 5);
    await pg.query(`UPDATE characters SET sheet_extra = '{"feats":["shield-master"]}'::jsonb WHERE id=$1`, [guard.id]);
    await shieldUp(guard.id);
    await saveBonus(guard.id, 'dexterity', 40);
    const mage = await npc('Пиромант');
    const spellId = (await pg.query<any>(
      `INSERT INTO campaign_spells (campaign_id, created_by, name, level, school, status, range, save_ability, half_on_save, damage_formula, damage_type)
       VALUES ($1,$2,'Пламя',0,'Evocation','approved','60 feet','dexterity',true,'1d1+19','fire') RETURNING id`, [campaignId, gm.user.id],
    )).rows[0].id;
    const entry = (await request('POST', `${base}/characters/${mage.id}/spells`, gm.token, {source: 'custom', customSpellId: spellId})).json().id;
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Площадь', widthCells: 10, heightCells: 10})).json().id;
    await request('POST', `${base}/scenes/${sceneId}/objects`, alice.token, {characterId: guard.id, x: 0.5, z: 0.5});
    await request('POST', `${base}/scenes/${sceneId}/objects`, gm.token, {characterId: mage.id, x: 4.5, z: 0.5});
    const cast = () => request('POST', `${base}/characters/${mage.id}/spells/${entry}/cast`, gm.token, {sceneId, targetIds: [guard.id]});
    const first = await cast();
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(first.json().targets[0].shieldMaster, true);
    assert.equal(await hp(guard.id), 300);

    assert.equal((await request('POST', `${base}/scenes/${sceneId}/initiative/start`, gm.token, {})).statusCode, 201);
    await pg.query(`UPDATE initiative_entries SET is_current = (character_id = $2), action_used=false WHERE scene_id=$1`, [sceneId, mage.id]);
    assert.equal((await cast()).statusCode, 201);
    assert.equal(await hp(guard.id), 300, 'in combat — the reaction');
    assert.equal((await pg.query<any>('SELECT reaction_used FROM initiative_entries WHERE character_id=$1', [guard.id])).rows[0].reaction_used, true);
    await pg.query('UPDATE initiative_entries SET action_used=false WHERE character_id=$1', [mage.id]);
    const third = await cast();
    assert.equal(third.statusCode, 201, third.body);
    assert.equal(await hp(guard.id), 290, 'the reaction is spent — half');
  });
});
