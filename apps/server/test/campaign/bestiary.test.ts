import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('SRD bestiary', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db);
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

  const gm = await register('gm_bestiary'), alice = await register('alice_bestiary'), outsider = await register('out_bestiary');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Bestiary'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Пещера', widthCells: 10, heightCells: 10})).json().id;
  const sheet = async (id: string) => (await request('GET', `${base}/characters/${id}`, gm.token)).json();
  const spawn = (body: any, token = gm.token) => request('POST', `${base}/bestiary/spawn`, token, body);

  await t.test('the reference lists SRD monsters with their attribution', async () => {
    assert.equal((await request('GET', '/srd/monsters')).statusCode, 401);
    const result = (await request('GET', '/srd/monsters', alice.token)).json();
    assert.ok(result.monsters.length >= 50);
    assert.match(result.attribution, /Creative Commons Attribution 4\.0/);
    const goblin = result.monsters.find((m: any) => m.index === 'goblin');
    assert.equal(goblin.nameRu, 'Гоблин');
    assert.equal(goblin.crText, '1/4');
    assert.equal(goblin.xp, 50);
    assert.match(goblin.attackLines[0], /^Скимитар\. Рукопашная атака оружием: \+4 к попаданию/);
  });

  let goblinIds: string[] = [];

  await t.test('only the GM brings monsters in; three goblins and an ogre take their own cells around the point', async () => {
    assert.equal((await spawn({monsters: [{index: 'goblin', count: 1}]}, alice.token)).statusCode, 403);
    assert.equal((await spawn({monsters: [{index: 'goblin', count: 1}]}, outsider.token)).statusCode, 404);
    assert.equal((await spawn({monsters: [{index: 'tarrasque', count: 1}]})).statusCode, 400);
    assert.equal((await spawn({monsters: [{index: 'goblin', count: 20}, {index: 'orc', count: 11}]})).statusCode, 400);

    const created = await spawn({monsters: [{index: 'goblin', count: 3}, {index: 'ogre', count: 1}], sceneId, x: 0.5, z: 0.5});
    assert.equal(created.statusCode, 201, created.body);
    const {characters, placements} = created.json();
    assert.deepEqual(characters.map((c: any) => c.name), ['Гоблин 1', 'Гоблин 2', 'Гоблин 3', 'Огр']);
    assert.deepEqual(characters.map((c: any) => c.hp), [7, 7, 7, 59]);
    assert.equal(placements.length, 4);
    assert.deepEqual([placements[0].x, placements[0].z], [0.5, 0.5], 'the first stands on the chosen cell');
    const cells = new Set<string>();
    for (const [index, placement] of placements.entries()) {
      const n = index === 3 ? 2 : 1;
      for (let dx = 0; dx < n; dx += 1) for (let dz = 0; dz < n; dz += 1) {
        const key = `${placement.x - n / 2 + 0.5 + dx}:${placement.z - n / 2 + 0.5 + dz}`;
        assert.ok(!cells.has(key), `cell ${key} twice`);
        cells.add(key);
      }
    }
    goblinIds = characters.slice(0, 3).map((c: any) => c.id);

    const goblin = await sheet(goblinIds[0]!);
    assert.equal(goblin.kind, 'npc');
    assert.equal(goblin.disposition, 'hostile');
    assert.equal(goblin.challenge_rating, 0.25);
    assert.equal(goblin.armor_class, 15);
    assert.equal(goblin.size, 'small');
    assert.equal(goblin.sheet_extra.darkvisionFeet, 60);
    assert.match(goblin.sheet_extra.text.actions.value, /Короткий лук\. Дальнобойная атака оружием: \+4/);
    assert.deepEqual(goblin.weapons.map((w: any) => [w.name, w.damage_formula, w.weapon_kind, w.attack_bonus]), [['Короткий лук', '1d6+2', 'ranged', 0], ['Скимитар', '1d6+2', 'melee', 0]]);
    const skill = (await pg.query(`SELECT skill_index, proficient, expertise FROM character_skills WHERE character_id=$1`, [goblinIds[0]])).rows;
    assert.deepEqual(skill, [{skill_index: 'stealth', proficient: true, expertise: true}]);

    const single = (await spawn({monsters: [{index: 'owlbear', count: 1}]})).json();
    assert.equal(single.characters[0].name, 'Совомедведь', 'the only one keeps the plain name');
    assert.deepEqual(single.placements, []);
  });

  await t.test('a monster rolls by its sheet: proficiency from the challenge rating, odd SRD bonuses kept', async () => {
    const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Лиэна', hpMax: 300, armorClass: 1})).json();
    await pg.query('UPDATE characters SET hp_current=300 WHERE id=$1', [hero.id]);
    const goblin = await sheet(goblinIds[0]!);
    const scimitar = goblin.weapons.find((w: any) => w.name === 'Скимитар');
    const roll = await request('POST', `${base}/rolls/check`, gm.token, {characterId: goblin.id, kind: 'attack', key: scimitar.id, targetCharacterId: hero.id});
    assert.equal(roll.statusCode, 201, roll.body);
    assert.equal(roll.json().modifier, 4, 'Dex +2 and proficiency +2 by CR 1/4');
    const stealth = await request('POST', `${base}/rolls/check`, gm.token, {characterId: goblin.id, kind: 'skill', key: 'stealth'});
    assert.equal(stealth.json().modifier, 6, 'expertise in Stealth');

    const ghoul = (await spawn({monsters: [{index: 'ghoul', count: 1}]})).json().characters[0];
    const bite = (await sheet(ghoul.id)).weapons.find((w: any) => w.name === 'Укус');
    assert.equal(bite.attack_bonus, -2);
    const ghoulRoll = await request('POST', `${base}/rolls/check`, gm.token, {characterId: ghoul.id, kind: 'attack', key: bite.id, targetCharacterId: hero.id});
    assert.equal(ghoulRoll.json().modifier, 2, 'the SRD ghoul bites at +2');

    const dragon = (await spawn({monsters: [{index: 'young-red-dragon', count: 1}]})).json().characters[0];
    const dragonBite = (await sheet(dragon.id)).weapons.find((w: any) => w.name === 'Укус');
    assert.deepEqual([dragonBite.extra_damage_formula, dragonBite.extra_damage_type], ['1d6', 'fire']);
    await pg.query('UPDATE characters SET hp_current=300 WHERE id=$1', [hero.id]);
    let result: any = null;
    for (let attempt = 0; attempt < 12 && !result?.damage; attempt += 1) {
      result = (await request('POST', `${base}/rolls/check`, gm.token, {characterId: dragon.id, kind: 'attack', key: dragonBite.id, targetCharacterId: hero.id})).json();
    }
    assert.equal(result.modifier, 10);
    assert.ok(result.damage, 'hits AC 1 with +10');
    assert.ok(result.extraDamage, 'and burns too');
    assert.equal(result.extraDamage.roll.outcome.damageType, 'fire');
    assert.match(result.extraDamage.roll.label, /^Урон: Укус \(огонь\) → Лиэна/);
    const hp = (await sheet(hero.id)).hp_current;
    assert.equal(hp, 300 - result.damage.applied - result.extraDamage.applied);
  });

  await t.test('rolled hit points come from the hit dice', async () => {
    const {characters} = (await spawn({monsters: [{index: 'goblin', count: 5}], hp: 'roll'})).json();
    for (const goblin of characters) {
      assert.ok(goblin.hp >= 2 && goblin.hp <= 12, `2d6: ${goblin.hp}`);
      assert.equal((await sheet(goblin.id)).hp_max, goblin.hp);
    }
  });

  await t.test('spellcasters get their SRD spells, slots and casting ability', async () => {
    const acolyte = (await spawn({monsters: [{index: 'acolyte', count: 1}]})).json().characters[0];
    const spells = (await pg.query<any>(`SELECT srd_index FROM character_spells WHERE character_id=$1 ORDER BY srd_index`, [acolyte.id])).rows.map(row => row.srd_index);
    assert.deepEqual(spells, ['bless', 'cure-wounds', 'light', 'sacred-flame', 'sanctuary', 'thaumaturgy']);
    const slots = (await pg.query(`SELECT level, current, max FROM character_spell_slots WHERE character_id=$1`, [acolyte.id])).rows;
    assert.deepEqual(slots, [{level: 1, current: 3, max: 3}]);
    assert.equal((await sheet(acolyte.id)).spellcasting_ability, 'wisdom');
  });

  await t.test('an encounter straight from the bestiary deploys fresh sheets', async () => {
    assert.equal((await request('POST', `${base}/encounters/bestiary`, alice.token, {name: 'Засада', monsters: [{index: 'wolf', count: 2}]})).statusCode, 403);
    const saved = await request('POST', `${base}/encounters/bestiary`, gm.token, {name: 'Волчья стая', monsters: [{index: 'wolf', count: 3}, {index: 'dire-wolf', count: 1}]});
    assert.equal(saved.statusCode, 201, saved.body);
    const listed = (await request('GET', `${base}/encounters`, gm.token)).json().find((e: any) => e.name === 'Волчья стая');
    assert.deepEqual(listed.members.map((m: any) => m.name), ['Волк', 'Волк', 'Волк', 'Лютоволк']);
    const deployed = await request('POST', `${base}/encounters/${listed.id}/deploy`, gm.token, {sceneId, x: -3.5, z: 3.5});
    assert.equal(deployed.statusCode, 201, deployed.body);
    const names = deployed.json().characters.map((c: any) => c.name);
    assert.deepEqual(names, ['Волк 1', 'Волк 2', 'Волк 3', 'Лютоволк 1']);
    const wolf = await sheet(deployed.json().characters[0].id);
    assert.equal(wolf.hp_current, 11);
    assert.equal(wolf.weapons[0].name, 'Укус');
  });

  await t.test('copies keep what section 8 added: hazard, secrecy, open flame, price and the merchant', async () => {
    const barrel = (await request('POST', `${base}/characters`, gm.token, {kind: 'object', name: 'Бочка масла'})).json();
    const state = await request('PUT', `${base}/characters/${barrel.id}/state`, gm.token, {
      hazard: {types: ['fire'], radiusFeet: 10, formula: '2d6', damageType: 'fire', save: 'dexterity', dc: 12, halfOnSuccess: true},
      secretDc: 15, lightBrightFeet: 10, lightDimFeet: 10, lit: true, lightOpenFlame: true,
    });
    assert.equal(state.statusCode, 200, state.body);
    await pg.query('UPDATE characters SET price_cp=200, weight_lb=40 WHERE id=$1', [barrel.id]);
    const copy = (await request('POST', `${base}/characters/${barrel.id}/duplicate`, gm.token, {count: 1})).json().characters[0];
    const copied = (await pg.query<any>(`SELECT hazard, secret_dc, light_open_flame FROM object_states WHERE character_id=$1`, [copy.id])).rows[0];
    assert.equal(copied.hazard.formula, '2d6');
    assert.equal(copied.secret_dc, 15);
    assert.equal(copied.light_open_flame, true);
    const copiedSheet = await sheet(copy.id);
    assert.deepEqual([copiedSheet.price_cp, copiedSheet.weight_lb], [200, 40]);

    const trader = (await request('POST', `${base}/characters`, gm.token, {kind: 'npc', name: 'Лавочник'})).json();
    await request('PATCH', `${base}/characters/${trader.id}`, gm.token, {revision: (await sheet(trader.id)).revision, merchant: true, coins: {gp: 7}});
    const traderCopy = (await request('POST', `${base}/characters/${trader.id}/duplicate`, gm.token, {count: 1})).json().characters[0];
    const traderSheet = await sheet(traderCopy.id);
    assert.deepEqual([traderSheet.merchant, traderSheet.gp], [true, 7]);
  });
});
