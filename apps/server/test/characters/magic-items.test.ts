import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('magic items', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 100_000});
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

  const gm = await register('gm_magic'), alice = await register('alice_magic');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Magic'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;

  const hero = (await request('POST', `${base}/characters`, alice.token, {
    kind: 'character', name: 'Лира', strength: 10, constitution: 12, hpMax: 30, hpCurrent: 30, armorClass: 14, speedFeet: 30, level: 4,
  })).json();
  const bran = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Бран', hpMax: 20, hpCurrent: 20, armorClass: 12, level: 1})).json();

  const sheet = async (id = hero.id) => (await pg.query<any>('SELECT armor_class, strength, constitution, hp_max, hp_current, speed_feet::float8 AS speed, damage_resistances FROM characters WHERE id=$1', [id])).rows[0];
  const saveBonuses = async (id = hero.id) => (await pg.query<any>('SELECT custom_bonus FROM character_saves WHERE character_id=$1 ORDER BY ability', [id])).rows.map(row => row.custom_bonus);
  const items = async (token = alice.token, id = hero.id) => (await request('GET', `${base}/characters/${id}/items`, token)).json();
  const gift = async (srdIndex: string, id = hero.id) => {
    const response = await request('POST', `${base}/characters/${id}/items`, gm.token, {srdIndex});
    assert.equal(response.statusCode, 201, response.body);
    return response.json().item.id as string;
  };
  const equip = (itemId: string, equipped = true, token = alice.token) => request('POST', `${base}/characters/${itemId}/equip`, token, {equipped});
  const attune = (itemId: string, attuned = true, token = alice.token) => request('POST', `${base}/characters/${itemId}/attune`, token, {attuned});
  const view = async (itemId: string) => (await items()).items.find((item: any) => item.id === itemId).magic;

  await t.test('SRD list; only the GM gives magic items', async () => {
    const list = (await request('GET', '/srd/magic-items', alice.token)).json();
    assert.ok(list.items.length >= 10);
    assert.match(list.attribution, /CC-BY-4.0/);
    assert.equal((await request('POST', `${base}/characters/${hero.id}/items`, alice.token, {srdIndex: 'ring-of-protection'})).statusCode, 403);
    assert.equal((await request('POST', `${base}/characters/${hero.id}/items`, gm.token, {srdIndex: 'nope'})).statusCode, 404);
  });

  let ring = '';
  await t.test('ring of protection: worn and attuned — +1 AC and saves; given away — off the sheet', async () => {
    ring = await gift('ring-of-protection');
    let magic = await view(ring);
    assert.deepEqual([magic.rarityLabel, magic.requiresAttunement, magic.attuned, magic.equipped, magic.active, magic.bonusText], ['редкий', true, false, false, false, 'КД +1, спасброски +1']);
    assert.equal((await equip(ring)).statusCode, 200);
    assert.equal((await sheet()).armor_class, 14, 'not attuned — does nothing yet');
    const attuned = await attune(ring);
    assert.equal(attuned.statusCode, 200, attuned.body);
    assert.match(attuned.json().message, /Лира настраивается на «Кольцо защиты»: КД \+1, спасброски \+1/);
    assert.equal((await sheet()).armor_class, 15);
    assert.deepEqual(await saveBonuses(), [1, 1, 1, 1, 1, 1]);
    assert.deepEqual((await items()).fromItems, ['КД +1, спасброски +1']);
    assert.match((await attune(ring)).json().message, /уже настроен/);

    const given = await request('PUT', `${base}/characters/${ring}/container`, alice.token, {containerId: bran.id});
    assert.equal(given.statusCode, 200, given.body);
    assert.deepEqual([(await sheet()).armor_class, await saveBonuses()], [14, [0, 0, 0, 0, 0, 0]]);
    magic = (await items(alice.token, bran.id)).items.find((item: any) => item.id === ring).magic;
    assert.deepEqual([magic.equipped, magic.attuned, magic.active], [false, false, false], 'a new holder must put it on and attune');
    assert.equal((await sheet(bran.id)).armor_class, 12);
    await request('PUT', `${base}/characters/${ring}/container`, alice.token, {containerId: hero.id});
  });

  await t.test('no more than three attuned items; gauntlets set Strength 19 while worn', async () => {
    const cloak = await gift('cloak-of-protection');
    const gauntlets = await gift('gauntlets-of-ogre-power');
    const headband = await gift('headband-of-intellect');
    await attune(ring);
    await attune(cloak);
    assert.equal((await attune(gauntlets)).statusCode, 200);
    assert.match((await attune(headband)).json().message, /уже настроен на 3 предмета/);
    assert.equal((await items()).attunedCount, 3);
    assert.equal((await sheet()).strength, 10, 'attuned but not worn');
    await equip(gauntlets);
    assert.equal((await sheet()).strength, 19);
    await equip(gauntlets, false);
    assert.equal((await sheet()).strength, 10);
    await attune(cloak, false);
    assert.equal((await attune(headband)).statusCode, 200, 'a freed slot can be used');

    await equip(gauntlets);
    assert.equal((await sheet()).strength, 19);
    assert.equal((await request('DELETE', `${base}/characters/${gauntlets}`, alice.token)).statusCode, 204);
    assert.equal((await sheet()).strength, 10);
    await attune(headband, false);
    await attune(ring, false);
  });

  await t.test('amulet of health raises hit points with Constitution; a ring of resistance halves fire', async () => {
    const amulet = await gift('amulet-of-health');
    await attune(amulet);
    await equip(amulet);
    let now = await sheet();
    assert.deepEqual([now.constitution, now.hp_max, now.hp_current], [19, 42, 42]);
    await equip(amulet, false);
    now = await sheet();
    assert.deepEqual([now.constitution, now.hp_max, now.hp_current], [12, 30, 30]);
    await attune(amulet, false);

    const fireRing = await gift('ring-of-resistance');
    await attune(fireRing);
    await equip(fireRing);
    assert.deepEqual((await sheet()).damage_resistances, ['fire']);
    const roll = (await request('POST', `${base}/rolls`, gm.token, {formula: '1d1+9'})).json();
    const burned = (await request('POST', `${base}/rolls/${roll.id}/apply`, gm.token, {characterId: hero.id, mode: 'damage', damageType: 'fire'})).json();
    assert.deepEqual([burned.applied, burned.modified], [5, 'resisted']);
    await equip(fireRing, false);
    assert.deepEqual((await sheet()).damage_resistances, []);
    await attune(fireRing, false);
    await pg.query('UPDATE characters SET hp_current=hp_max WHERE id=$1', [hero.id]);
  });

  await t.test('wand: spend charges, 1d6+1 back at dawn, the last charge may destroy it', async () => {
    const wand = await gift('wand-of-magic-missiles');
    const spend = (count: number, token = alice.token) => request('POST', `${base}/characters/${wand}/charges`, token, {spend: count});
    const spent = await spend(3);
    assert.equal(spent.statusCode, 200, spent.body);
    assert.deepEqual([spent.json().current, spent.json().max], [4, 7]);
    assert.equal(spent.json().message, 'Лира: «Палочка волшебных стрел» — 3 заряда (осталось 4/7).');
    assert.match((await spend(5)).json().message, /4 из 7 зарядов — на 5 не хватит/);
    const chat = (await request('GET', `${base}/chat`, alice.token)).json().messages;
    assert.ok(chat.some((message: any) => message.body.startsWith('Лира: «Палочка волшебных стрел» — 3 заряда')));

    assert.equal((await request('PUT', `${base}/time`, gm.token, {advanceMinutes: 1440})).statusCode, 200);
    const after = await items();
    assert.equal(after.recharged.length, 1, JSON.stringify(after.recharged));
    const charges = after.items.find((item: any) => item.id === wand).magic.charges;
    assert.ok(charges.current >= 6 && charges.current <= 7, JSON.stringify(charges));
    assert.equal(charges.rechargeLabel, 'на рассвете');
    const rolls = (await request('GET', `${base}/rolls`, gm.token)).json().rolls;
    assert.ok(rolls.some((entry: any) => entry.label === 'На рассвете: Палочка волшебных стрел' && entry.formula === '1d6+1'));
    assert.equal((await items()).recharged.length, 0, 'once per dawn');

    assert.equal((await request('POST', `${base}/characters/${wand}/charges`, alice.token, {set: 1})).statusCode, 403);
    assert.equal((await request('POST', `${base}/characters/${wand}/charges`, gm.token, {set: 1})).json().current, 1);
    const last = await spend(1);
    assert.match(last.json().message, /Последний заряд — к20: /);
    const roll = (await request('GET', `${base}/rolls`, gm.token)).json().rolls.find((entry: any) => entry.label === 'Последний заряд: Палочка волшебных стрел');
    assert.ok(roll);
    assert.equal(last.json().destroyed, roll.total === 1);
    if (last.json().destroyed) assert.match((await spend(1)).json().message, /уничтожен/);
    else assert.match((await spend(1)).json().message, /0 из 7 зарядов/);
  });

  await t.test('the GM makes an item magical: charges back after a long rest; copies are fresh', async () => {
    const amulet = (await request('POST', `${base}/characters`, alice.token, {kind: 'object', name: 'Амулет предков'})).json();
    await request('PUT', `${base}/characters/${amulet.id}/container`, alice.token, {containerId: hero.id});
    const body = {rarity: 'rare', description: 'Шепчет советы.', chargesMax: 3, recharge: 'long', bonuses: {speed: 10}};
    assert.equal((await request('PUT', `${base}/characters/${amulet.id}/magic`, alice.token, body)).statusCode, 403);
    assert.match((await request('PUT', `${base}/characters/${amulet.id}/magic`, gm.token, {...body, rechargeFormula: 'много'})).json().message, /вида 1d6\+1/);
    const made = await request('PUT', `${base}/characters/${amulet.id}/magic`, gm.token, body);
    assert.equal(made.statusCode, 200, made.body);
    assert.deepEqual([made.json().magic.charges.current, made.json().magic.bonusText], [3, 'скорость +10 фут.']);
    await equip(amulet.id);
    assert.equal((await sheet()).speed, 40);
    await request('POST', `${base}/characters/${amulet.id}/charges`, alice.token, {spend: 2});
    const rest = await request('POST', `${base}/characters/${hero.id}/rest`, alice.token, {kind: 'long'});
    assert.equal(rest.statusCode, 200, rest.body);
    assert.ok(JSON.stringify(rest.json()).includes('Амулет предков: заряды 3/3'), rest.body);

    const copy = (await request('POST', `${base}/characters/${amulet.id}/duplicate`, gm.token, {count: 1})).json().characters[0];
    const copied = (await pg.query<any>('SELECT equipped, attuned_to, applied, charges_current, charges_max, bonuses FROM magic_items WHERE character_id=$1', [copy.id])).rows[0];
    assert.deepEqual([copied.equipped, copied.attuned_to, copied.applied, copied.charges_current, copied.bonuses], [false, null, null, 3, {speed: 10}]);

    assert.equal((await request('DELETE', `${base}/characters/${amulet.id}/magic`, gm.token)).statusCode, 204);
    assert.equal((await sheet()).speed, 30, 'a mundane amulet gives nothing');
  });

  await t.test('attunement is not done in a fight; plain items cannot be worn for magic', async () => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Бой', widthCells: 6, heightCells: 6})).json().id;
    await request('POST', `${base}/scenes/${sceneId}/objects`, alice.token, {characterId: hero.id, x: 0.5, z: 0.5});
    await request('POST', `${base}/scenes/${sceneId}/initiative/start`, gm.token, {});
    assert.match((await attune(ring)).json().message, /не в бою/);
    const rope = (await request('POST', `${base}/characters`, alice.token, {kind: 'object', name: 'Верёвка'})).json();
    await request('PUT', `${base}/characters/${rope.id}/container`, alice.token, {containerId: hero.id});
    assert.match((await equip(rope.id)).json().message, /обычный предмет/);
    assert.equal((await request('GET', `${base}/characters/${hero.id}/items`, gm.token)).json().gm, true);
  });
});
