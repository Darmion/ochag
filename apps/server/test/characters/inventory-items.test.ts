import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';
import {loadSlowdown} from '../../src/characters/inventory-state.ts';
import {campaignFlag} from '../../src/tabletop/rolls/dice.ts';

test('inventory: buy and stack, equip on the doll, gear AC, use, split, give, ammo and load', async t => {
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
  const gm = await register('gm_inventory'), alice = await register('alice_inventory'), bob = await register('bob_inventory');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Inventory'})).json().id;
  for (const player of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', player.token, {code});
  }
  const base = `/campaigns/${campaignId}`;
  const hero = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Хельга', className: 'Воин', level: 1, strength: 15, dexterity: 14, constitution: 14, hpMax: 12})).json();
  const friend = (await request('POST', `${base}/characters`, bob.token, {kind: 'character', name: 'Ульф', className: 'Следопыт', level: 1, dexterity: 16, hpMax: 11})).json();
  await pg.query('UPDATE characters SET gp=15, armor_class=12 WHERE id=$1', [hero.id]);
  const inventory = async (id = hero.id, token = alice.token) => (await request('GET', `${base}/characters/${id}/inventory`, token)).json();
  const add = (body: any, token = alice.token, id = hero.id) => request('POST', `${base}/characters/${id}/inventory`, token, body);
  const find = async (name: string, id = hero.id) => (await inventory(id, id === hero.id ? alice.token : bob.token)).items.find((item: any) => item.name === name);
  const equip = (itemId: string, slot: string | null, token = alice.token, extra: any = {}) => request('POST', `${base}/characters/${itemId}/equip-slot`, token, {slot, ...extra});

  await t.test('the reference sells packs by the unit; the wallet pays atomically; stacks merge', async () => {
    const sword = await add({ref: 'weapon:longsword', quantity: 1, buy: true});
    assert.equal(sword.statusCode, 201, sword.body);
    assert.deepEqual(sword.json().wallet, {cp: 0, sp: 0, ep: 0, gp: 0, pp: 0});
    const broke = await add({ref: 'weapon:longsword', quantity: 1, buy: true});
    assert.equal(broke.statusCode, 400);
    assert.match(broke.json().message, /Не хватает денег/);
    assert.equal((await add({ref: 'gear:arrows-20', quantity: 2})).json().added, 40);
    const again = (await add({ref: 'gear:arrows-20', quantity: 1})).json();
    assert.deepEqual([again.added, again.merged], [20, true]);
    const arrows = await find('Стрелы');
    assert.deepEqual([arrows.quantity, arrows.priceCp, arrows.weightLb, arrows.category], [60, 5, 0.05, 'ammo']);
    assert.equal((await add({ref: 'weapon:longsword', quantity: 1}, bob.token)).statusCode, 403, 'not their hero');
  });

  await t.test('own items: a slot from the player; only the GM marks one infinite', async () => {
    assert.equal((await add({quantity: 1, custom: {name: 'Оберег из клыка', category: 'gear', wear: 'neck', weightLb: 0.1}})).statusCode, 201);
    assert.deepEqual((await find('Оберег из клыка')).slots, ['neck']);
    assert.equal((await add({quantity: 1, custom: {name: 'Колчан изобилия', category: 'ammo', infinite: true}})).statusCode, 403);
    assert.equal((await add({quantity: 1, custom: {name: 'Бездонные стрелы', category: 'ammo', infinite: true}}, gm.token)).statusCode, 201);
  });

  await t.test('the doll: armour on the body, a sword gets its attack, a greatsword pushes sword and shield back into the bag', async () => {
    await add({ref: 'gear:chain-mail', quantity: 1});
    await add({ref: 'gear:shield', quantity: 1});
    await add({ref: 'weapon:greatsword', quantity: 1});
    const chain = await find('Кольчуга'), shield = await find('Щит'), sword = await find('Длинный меч'), great = await find('Двуручный меч');
    assert.equal((await equip(chain.id, 'body')).statusCode, 200);
    assert.equal((await equip(sword.id, 'main_hand')).statusCode, 200);
    assert.equal((await equip(shield.id, 'off_hand')).statusCode, 200);
    assert.equal((await equip(chain.id, 'neck')).statusCode, 400, 'armour is not worn on the neck');
    const sheet = (await request('GET', `${base}/characters/${hero.id}`, alice.token)).json();
    const attack = sheet.weapons.find((weapon: any) => weapon.name === 'Длинный меч');
    assert.ok(attack, 'equipping made an attack row');
    assert.equal((await inventory()).items.find((item: any) => item.id === sword.id).attackId, attack.id);
    const swap = await equip(great.id, 'main_hand');
    assert.equal(swap.statusCode, 200, swap.body);
    const after = (await inventory()).items;
    assert.deepEqual(
      [after.find((item: any) => item.id === great.id).slot, after.find((item: any) => item.id === sword.id).slot, after.find((item: any) => item.id === shield.id).slot],
      ['main_hand', null, null],
    );
    assert.equal((await equip(great.id, null)).statusCode, 200);
    await equip(sword.id, 'main_hand');
    await equip(shield.id, 'off_hand');
  });

  await t.test('armour class: manual stays until the player picks «by gear»', async () => {
    const view = await inventory();
    assert.deepEqual([view.holder.acMode, view.holder.armorClass, view.gearAc.value], ['manual', 12, 18], 'chain mail 16 + shield 2');
    const mode = await request('PUT', `${base}/characters/${hero.id}/ac-mode`, alice.token, {mode: 'gear'});
    assert.deepEqual(mode.json(), {mode: 'gear', armorClass: 18});
    await equip((await find('Щит')).id, null);
    assert.equal((await request('GET', `${base}/characters/${hero.id}`, alice.token)).json().armor_class, 16);
    await request('PATCH', `${base}/characters/${hero.id}`, alice.token, {revision: (await request('GET', `${base}/characters/${hero.id}`, alice.token)).json().revision, armorClass: 20});
    assert.equal((await inventory()).holder.acMode, 'manual', 'typing an AC by hand switches back to manual');
    await equip((await find('Щит')).id, 'off_hand');
    assert.equal((await request('GET', `${base}/characters/${hero.id}`, alice.token)).json().armor_class, 20, 'manual AC is left alone');
  });

  await t.test('in combat armour is not changed by the player', async () => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Бой'})).json().id;
    await request('POST', `${base}/scenes/${sceneId}/initiative/join`, gm.token, {characterId: hero.id});
    await pg.query('UPDATE initiative_entries SET is_current=true WHERE scene_id=$1', [sceneId]);
    const chain = await find('Кольчуга');
    const refused = await equip(chain.id, null);
    assert.equal(refused.statusCode, 400);
    assert.match(refused.json().message, /Доспех в бою/);
    assert.equal((await equip(chain.id, null, gm.token)).statusCode, 200, 'the GM may');
    await equip(chain.id, 'body', gm.token);
    await request('DELETE', `${base}/scenes/${sceneId}/initiative`, gm.token);
  });

  await t.test('use, split and give', async () => {
    await add({ref: 'gear:potion-of-healing', quantity: 2}, gm.token);
    const potion = await find('Зелье лечения');
    assert.equal(potion.quantity, 2);
    assert.deepEqual((await request('POST', `${base}/characters/${potion.id}/use`, alice.token, {})).json(), {left: 1, gone: false, infinite: false});
    assert.deepEqual((await request('POST', `${base}/characters/${potion.id}/use`, alice.token, {})).json(), {left: 0, gone: true, infinite: false});
    assert.equal(await find('Зелье лечения'), undefined);

    const arrows = await find('Стрелы');
    const split = await request('POST', `${base}/characters/${arrows.id}/split`, alice.token, {count: 20});
    assert.equal(split.statusCode, 200, split.body);
    const stacks = (await inventory()).items.filter((item: any) => item.name === 'Стрелы').map((item: any) => item.quantity).sort();
    assert.deepEqual(stacks, [20, 40]);
    const given = await request('POST', `${base}/characters/${split.json().itemId}/give`, alice.token, {toCharacterId: friend.id, count: 5});
    assert.equal(given.statusCode, 200, given.body);
    assert.equal((await find('Стрелы', friend.id)).quantity, 5);
    await request('POST', `${base}/characters/${split.json().itemId}/give`, alice.token, {toCharacterId: friend.id, count: 5});
    const friendArrows = (await inventory(friend.id, bob.token)).items.filter((item: any) => item.name === 'Стрелы');
    assert.deepEqual(friendArrows.map((item: any) => item.quantity), [10], 'gifts join the existing stack');
  });

  await t.test('ammunition is spent by attacks only when the GM turns the rule on; infinite never runs out', async () => {
    await pg.query(`UPDATE characters SET kind='character' WHERE id=$1`, [friend.id]);
    await add({ref: 'weapon:longbow', quantity: 1}, bob.token, friend.id);
    const bow = await find('Длинный лук', friend.id);
    await equip(bow.id, 'main_hand', bob.token);
    const bowAttack = (await request('GET', `${base}/characters/${friend.id}`, bob.token)).json().weapons.find((weapon: any) => weapon.name === 'Длинный лук');
    const shoot = () => request('POST', `${base}/rolls/check`, bob.token, {characterId: friend.id, kind: 'attack', key: bowAttack.id});
    assert.equal((await shoot()).statusCode, 201);
    assert.equal((await find('Стрелы', friend.id)).quantity, 10, 'rule off — nothing spent');
    await request('POST', `${base}/rules`, gm.token, {key: 'ammo_use', kind: 'flag', label: 'Расход боеприпасов', value: true});
    assert.equal((await shoot()).statusCode, 201);
    assert.equal((await find('Стрелы', friend.id)).quantity, 9);
    const arrows = await find('Стрелы', friend.id);
    await request('PATCH', `${base}/characters/${arrows.id}/item`, bob.token, {quantity: 1});
    await shoot();
    assert.equal(await find('Стрелы', friend.id), undefined, 'the last arrow is gone');
    const none = await shoot();
    assert.equal(none.statusCode, 400);
    assert.match(none.json().message, /Нет боеприпасов/);
    await add({quantity: 1, custom: {name: 'Стрелы света', category: 'ammo', infinite: true}}, gm.token, friend.id);
    assert.equal((await shoot()).statusCode, 201);
    assert.equal((await find('Стрелы света', friend.id)).quantity, 1, 'infinite');
  });

  await t.test('load slows down only with both rules; heavy armour without the Strength is −10 ft.', async () => {
    const slowed = () => db.transaction(q => loadSlowdown(campaignFlag, q, campaignId, hero.id, 30));
    assert.equal((await slowed()).feet, 30, 'chain mail needs STR 13, she has 15');
    await add({quantity: 6, custom: {name: 'Слиток железа', category: 'treasure', weightLb: 10}}, gm.token);
    assert.equal((await slowed()).feet, 30, 'rules are off');
    await request('POST', `${base}/rules`, gm.token, {key: 'encumbrance', kind: 'flag', label: 'Вес', value: true});
    await request('POST', `${base}/rules`, gm.token, {key: 'encumbrance_speed', kind: 'flag', label: 'Вес и скорость', value: true});
    const view = await inventory();
    assert.equal(view.weight.level, 'loaded', `${view.weight.pounds} lb against STR 15`);
    assert.deepEqual(await slowed(), {feet: 20, reasons: ['скорость −10 фт.: нагрузка']});
    await pg.query('UPDATE characters SET strength=12 WHERE id=$1', [hero.id]);
    const weak = await slowed();
    assert.ok(weak.reasons.some(reason => /тяжёлому доспеху/.test(reason)));
  });

  await t.test('armour that leaves the body by any road takes its AC along; stacks, magic and attacks follow the item', async () => {
    await pg.query('UPDATE characters SET strength=15 WHERE id=$1', [hero.id]);
    await request('PUT', `${base}/characters/${hero.id}/ac-mode`, alice.token, {mode: 'gear'});
    const ac = async () => (await request('GET', `${base}/characters/${hero.id}`, alice.token)).json().armor_class;
    await add({ref: 'gear:backpack', quantity: 1});
    const bag = await find('Рюкзак');
    assert.equal(bag.container, true, 'an empty backpack is a container');
    const chain = await find('Кольчуга');
    const before = await ac();
    assert.equal((await request('PUT', `${base}/characters/${chain.id}/container`, alice.token, {containerId: bag.id})).statusCode, 200);
    assert.equal(await ac(), before - 4, 'chain mail 16 → 10 + DEX 2 without it');
    await request('PUT', `${base}/characters/${chain.id}/container`, alice.token, {containerId: hero.id});
    await equip(chain.id, 'body');
    assert.equal(await ac(), before);
    assert.equal((await request('DELETE', `${base}/characters/${chain.id}`, alice.token)).statusCode, 204);
    assert.equal(await ac(), before - 4, 'deleting worn armour recounts too');

    await add({quantity: 1, custom: {name: 'Факел', category: 'gear', weightLb: 1, note: 'отцовский'}});
    await add({ref: 'gear:torch', quantity: 1}, bob.token, friend.id);
    const noted = (await inventory()).items.find((item: any) => item.name === 'Факел' && item.note);
    await request('POST', `${base}/characters/${noted.id}/give`, alice.token, {toCharacterId: friend.id});
    const torches = (await inventory(friend.id, bob.token)).items.filter((item: any) => item.name === 'Факел');
    assert.equal(torches.length, 2, 'a torch with a note keeps its own row');
    assert.ok(torches.some((item: any) => item.note === 'отцовский'));

    const ring = (await request('POST', `${base}/characters/${hero.id}/items`, gm.token, {srdIndex: 'ring-of-protection'})).json();
    const ringId = ring.item?.id ?? (await inventory()).items.find((item: any) => item.magic)?.id;
    await pg.query('UPDATE characters SET quantity=2 WHERE id=$1', [ringId]);
    assert.equal((await request('POST', `${base}/characters/${ringId}/give`, alice.token, {toCharacterId: friend.id, count: 1})).statusCode, 400, 'a magic item is not split by giving');

    const sword = await find('Длинный меч');
    const swordAttack = async (id: string, token: string) => (await request('GET', `${base}/characters/${id}`, token)).json().weapons.find((weapon: any) => weapon.name === 'Длинный меч');
    assert.ok(await swordAttack(hero.id, alice.token));
    await request('POST', `${base}/characters/${sword.id}/give`, alice.token, {toCharacterId: friend.id});
    assert.equal(await swordAttack(hero.id, alice.token), undefined, 'the attack made by equipping leaves with the sword');

    const wizard = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Ученик', className: 'Волшебник', level: 1, hpMax: 6})).json();
    await add({ref: 'weapon:longsword', quantity: 1}, alice.token, wizard.id);
    const blade = (await inventory(wizard.id)).items.find((item: any) => item.name === 'Длинный меч');
    await equip(blade.id, 'main_hand');
    assert.equal((await swordAttack(wizard.id, alice.token)).proficient, false, 'a wizard is not proficient with a longsword');
  });

  await t.test('migration 101 gives older heroes an item for each SRD weapon attack, or links the item they already carry', async () => {
    const veteran = (await request('POST', `${base}/characters`, alice.token, {kind: 'character', name: 'Ветеран', className: 'Воин', level: 2, hpMax: 20})).json();
    for (const fields of [{name: 'Боевой топор', srdIndex: 'battleaxe'}, {name: 'Кинжал', srdIndex: 'dagger'}]) {
      await request('POST', `${base}/characters/${veteran.id}/weapons`, alice.token, {...fields, ability: 'strength', damageFormula: '1d8+@mod', damageType: 'slashing'});
    }
    await add({quantity: 1, custom: {name: 'Кинжал', category: 'weapon'}}, alice.token, veteran.id);
    const {readFileSync} = await import('node:fs');
    const sql = readFileSync(new URL('../../../../db/migrations/101_inventory.sql', import.meta.url), 'utf8');
    await pg.exec(sql.slice(sql.indexOf('UPDATE character_weapons w SET source_item_id = ('), sql.indexOf('INSERT INTO schema_migrations')));
    const items = (await inventory(veteran.id)).items.filter((item: any) => item.category === 'weapon');
    assert.deepEqual(items.map((item: any) => item.name).sort(), ['Боевой топор', 'Кинжал'], 'one new item, the dagger already there');
    assert.ok(items.every((item: any) => item.attackId));
    assert.deepEqual([items.find((item: any) => item.name === 'Боевой топор').priceCp, items.find((item: any) => item.name === 'Боевой топор').weightLb], [1000, 4]);
    const auto = (await pg.query<any>('SELECT count(*)::int AS n FROM character_weapons WHERE character_id=$1 AND source_auto', [veteran.id])).rows[0].n;
    assert.equal(auto, 0, 'hand-made attacks stay when the item leaves');
  });

  await t.test('the doll layout is saved per hero and sanitised', async () => {
    const saved = await request('PUT', `${base}/characters/${hero.id}/doll`, alice.token, {doll: {preset: 'beast', points: {neck: {x: 2, y: 0.5}}}});
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json().doll.points.neck, {x: 1, y: 0.5, size: 1, hidden: false});
    assert.equal((await inventory()).holder.doll.preset, 'beast');
    assert.equal((await request('PUT', `${base}/characters/${hero.id}/doll`, bob.token, {doll: {preset: 'list'}})).statusCode, 403);
  });
});
