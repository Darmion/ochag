import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('character creation wizard', async t => {
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

  const gm = await register('gm_heroes'), alice = await register('alice_heroes'), bob = await register('bob_heroes'), outsider = await register('out_heroes');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Heroes'})).json().id;
  for (const player of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', player.token, {code});
  }
  const base = `/campaigns/${campaignId}`;
  const build = (body: any, token = alice.token) => request('POST', `${base}/characters/build`, token, body);
  const fighter = {
    name: 'Торин', race: 'dwarf', subrace: 'hill', className: 'fighter', method: 'standard',
    abilities: {strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8},
    background: 'acolyte', classSkills: ['athletics', 'perception'], kit: 'knight', fightingStyle: 'defense',
  };

  await t.test('the reference has races, classes, kits and backgrounds', async () => {
    assert.equal((await request('GET', '/srd/heroes')).statusCode, 401);
    const heroes = (await request('GET', '/srd/heroes', alice.token)).json();
    assert.equal(heroes.races.length, 10);
    assert.equal(heroes.races.at(-1).id, 'custom');
    assert.equal(heroes.classes.length, 12);
    const wizard = heroes.classes.find((entry: any) => entry.id === 'wizard');
    assert.equal(wizard.nameRu, 'Волшебник');
    assert.deepEqual(wizard.kits[0].gearNames.length, 2);
    assert.deepEqual(heroes.standardArray, [15, 14, 13, 12, 10, 8]);
  });

  await t.test('a player builds a hill dwarf fighter: a full sheet, kit in the pack, gold', async () => {
    assert.equal((await build(fighter, outsider.token)).statusCode, 404);
    const created = await build(fighter);
    assert.equal(created.statusCode, 201, created.body);
    const {character, summary} = created.json();
    assert.deepEqual([summary.hpMax, summary.armorClass], [14, 19]);
    const sheet = (await request('GET', `${base}/characters/${character.id}`, alice.token)).json();
    assert.equal(sheet.kind, 'character');
    const aliceId = (await request('GET', '/me', alice.token)).json().id;
    assert.equal(sheet.owner_user_id, aliceId, 'the hero belongs to the player who built it');
    assert.deepEqual([sheet.level, sheet.class_name, sheet.hit_die, sheet.hp_current, sheet.armor_class, sheet.gp], [1, 'Воин', 10, 14, 19, 15]);
    assert.deepEqual(sheet.weapons.map((w: any) => w.name).sort(), ['Длинный меч', 'Лёгкий арбалет']);
    assert.deepEqual(sheet.resources.map((r: any) => [r.name, r.current, r.max]).sort(), [['Болты', 20, 20], ['Второе дыхание', 1, 1]]);
    const bow = sheet.weapons.find((w: any) => w.name === 'Лёгкий арбалет');
    assert.equal(bow.ammo_resource_id, sheet.resources.find((r: any) => r.name === 'Болты').id);
    const contents = (await request('GET', `${base}/characters/${character.id}/contents`, alice.token)).json().contents.map((item: any) => item.name);
    assert.ok(contents.includes('Кольчуга') && contents.includes('Щит') && contents.includes('Рюкзак'), contents.join(', '));
    const saves = (await pg.query<any>('SELECT ability FROM character_saves WHERE character_id=$1 AND proficient ORDER BY ability', [character.id])).rows.map(row => row.ability);
    assert.deepEqual(saves, ['constitution', 'strength']);
    const roster = (await request('GET', `${base}/characters`, gm.token)).json().characters;
    assert.ok(roster.some((entry: any) => entry.id === character.id && entry.kind === 'character'));
  });

  await t.test('a dry run previews the hero and the problems without creating anything', async () => {
    const before = (await request('GET', `${base}/characters`, alice.token)).json().characters.length;
    const preview = await build({...fighter, name: 'Проба', dryRun: true});
    assert.equal(preview.statusCode, 200, preview.body);
    assert.deepEqual(preview.json().problems, []);
    assert.deepEqual([preview.json().summary.hpMax, preview.json().summary.armorClass], [14, 19]);
    assert.ok(preview.json().items.includes('Кольчуга'));
    const broken = (await build({...fighter, kit: 'nope', dryRun: true})).json();
    assert.match(broken.problems.join(), /набор снаряжения/);
    assert.equal((await request('GET', `${base}/characters`, alice.token)).json().characters.length, before);
  });

  await t.test('broken choices are refused with the reason', async () => {
    const twice = await build({...fighter, classSkills: ['athletics', 'insight']});
    assert.equal(twice.statusCode, 400);
    assert.match(twice.json().message, /не выбирают дважды/);
    assert.match((await build({...fighter, method: 'pointbuy', abilities: {...fighter.abilities, strength: 15, dexterity: 15, constitution: 15}})).json().message, /потрачено/);
  });

  await t.test('rolled abilities: the server rolls in the open, one hero per roll, only your own roll', async () => {
    const rolled = await request('POST', `${base}/characters/ability-roll`, alice.token);
    assert.equal(rolled.statusCode, 201, rolled.body);
    const {rollId, sets, values} = rolled.json();
    assert.equal(sets.length, 6);
    for (const set of sets) {
      assert.equal(set.dice.length, 4);
      assert.equal(set.value, [...set.dice].sort((a: number, b: number) => b - a).slice(0, 3).reduce((s: number, v: number) => s + v, 0));
    }
    const log = (await request('GET', `${base}/rolls`, gm.token)).json().rolls.find((roll: any) => roll.id === rollId);
    assert.equal(log.label, 'Характеристики: 4к6 без меньшей ×6');
    const abilities = {strength: values[0], dexterity: values[1], constitution: values[2], intelligence: values[3], wisdom: values[4], charisma: values[5]};
    const rolledHero = {...fighter, name: 'Рольф', method: 'roll', rollId, abilities};
    assert.equal((await build(rolledHero, bob.token)).statusCode, 400, 'not Bob’s roll');
    const wrong = {...abilities, strength: abilities.strength === 18 ? 3 : abilities.strength + 1};
    assert.equal((await build({...rolledHero, abilities: wrong})).statusCode, 400, 'scores must be the rolled ones');
    const ok = await build(rolledHero);
    assert.equal(ok.statusCode, 201, ok.body);
    assert.equal((await build({...rolledHero, name: 'Рольф 2'})).statusCode, 400, 'a roll builds one hero');
    assert.equal((await build({...rolledHero, rollId: undefined})).statusCode, 400);
  });

  await t.test('a wizard gets spells and slots; a tiefling knows thaumaturgy', async () => {
    const created = await build({
      name: 'Зария', race: 'tiefling', className: 'wizard', method: 'standard',
      abilities: {strength: 8, dexterity: 14, constitution: 13, intelligence: 15, wisdom: 12, charisma: 10},
      background: 'custom', backgroundSkills: ['stealth', 'insight'], classSkills: ['arcana', 'history'], kit: 'dagger',
      cantrips: ['fire-bolt', 'light', 'mage-hand'], spells: ['burning-hands', 'charm-person', 'color-spray', 'detect-magic', 'disguise-self', 'alarm'],
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().character.id;
    const spells = (await pg.query<any>('SELECT srd_index, prepared FROM character_spells WHERE character_id=$1', [id])).rows;
    assert.equal(spells.length, 3 + 6 + 1);
    assert.ok(spells.some(spell => spell.srd_index === 'thaumaturgy'));
    assert.equal(spells.filter(spell => !spell.prepared).length, 6 - 4, 'Int 16 (+3) + 1 prepared');
    const slots = (await pg.query<any>('SELECT level, current, max FROM character_spell_slots WHERE character_id=$1', [id])).rows;
    assert.deepEqual(slots, [{level: 1, current: 2, max: 2}]);
    const sheet = (await request('GET', `${base}/characters/${id}`, alice.token)).json();
    assert.deepEqual(sheet.damage_resistances, ['fire']);
    assert.equal(sheet.spellcasting_ability, 'intelligence');
  });
});
