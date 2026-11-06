import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';
import '../lssImporter.ts';

test('money, prices and merchants', async t => {
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

  const gm = await register('gm_shop'), alice = await register('alice_shop'), bob = await register('bob_shop');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Shop'})).json().id;
  for (const player of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', player.token, {code});
  }
  const characters = `/campaigns/${campaignId}/characters`;
  const hero = (await request('POST', characters, alice.token, {kind: 'character', name: 'Лиэна'})).json();
  const friend = (await request('POST', characters, bob.token, {kind: 'character', name: 'Бран'})).json();
  const trader = (await request('POST', characters, gm.token, {kind: 'npc', name: 'Лавочник', disposition: 'friendly'})).json();
  const sheet = async (id: string, token = gm.token) => (await request('GET', `${characters}/${id}`, token)).json();
  const patch = async (token: string, id: string, body: any) =>
    request('PATCH', `${characters}/${id}`, token, {revision: (await sheet(id)).revision, ...body});
  const wallet = async (id: string) => {
    const s = await sheet(id);
    return {cp: s.cp, sp: s.sp, ep: s.ep, gp: s.gp, pp: s.pp};
  };

  await t.test('a wallet in the sheet; only the GM makes a merchant', async () => {
    assert.equal((await patch(alice.token, hero.id, {coins: {gp: 10, sp: 5}})).statusCode, 200);
    assert.deepEqual(await wallet(hero.id), {cp: 0, sp: 5, ep: 0, gp: 10, pp: 0});
    assert.equal((await patch(alice.token, hero.id, {coins: {gp: -1}})).statusCode, 400);
    assert.equal((await patch(alice.token, hero.id, {merchant: true})).statusCode, 403);
    assert.equal((await patch(gm.token, hero.id, {merchant: true})).statusCode, 400, 'a merchant is an NPC');
    assert.equal((await patch(gm.token, trader.id, {merchant: true})).statusCode, 200);
  });

  await t.test('gear from the SRD list goes into the inventory with its price and weight', async () => {
    const gear = (await request('GET', '/srd/gear', alice.token)).json().gear;
    assert.ok(gear.length >= 50);
    assert.deepEqual(gear.find((item: any) => item.index === 'rope-hempen-50-feet'), {
      index: 'rope-hempen-50-feet', nameRu: 'Пеньковая верёвка (50 футов)', category: 'gear', priceCp: 100, weightLb: 10,
      desc: '2 хита; разорвать — проверка Силы со СЛ 17.',
    }, 'with its description for the «Справочник»');
    assert.equal((await request('POST', `${characters}/${trader.id}/gear`, alice.token, {srdIndex: 'torch'})).statusCode, 403);
    const rope = await request('POST', `${characters}/${trader.id}/gear`, gm.token, {srdIndex: 'rope-hempen-50-feet'});
    assert.equal(rope.statusCode, 201, rope.body);
    await request('POST', `${characters}/${trader.id}/gear`, gm.token, {srdIndex: 'potion-of-healing'});
    const shop = (await request('GET', `${characters}/${trader.id}/shop`, alice.token)).json();
    assert.deepEqual(shop.goods.map((item: any) => [item.name, item.price_cp]), [['Зелье лечения', 5000], ['Пеньковая верёвка (50 футов)', 100]]);
  });

  await t.test('buying pays with change and puts the thing into the buyer’s pack', async () => {
    const goods = (await request('GET', `${characters}/${trader.id}/shop`, alice.token)).json().goods;
    const rope = goods.find((item: any) => item.price_cp === 100);
    const potion = goods.find((item: any) => item.price_cp === 5000);
    assert.equal((await request('POST', `${characters}/${trader.id}/buy`, bob.token, {itemId: rope.id, buyerId: hero.id})).statusCode, 403);
    const poor = await request('POST', `${characters}/${trader.id}/buy`, alice.token, {itemId: potion.id, buyerId: hero.id});
    assert.equal(poor.statusCode, 400);
    assert.match(poor.json().message, /Не хватает денег/);
    const bought = await request('POST', `${characters}/${trader.id}/buy`, alice.token, {itemId: rope.id, buyerId: hero.id});
    assert.equal(bought.statusCode, 200, bought.body);
    assert.deepEqual(await wallet(hero.id), {cp: 0, sp: 5, ep: 0, gp: 9, pp: 0});
    const ropeNow = await sheet(rope.id);
    assert.equal(ropeNow.owner_user_id, alice.user.id, 'hers now');
    assert.equal((await request('POST', `${characters}/${trader.id}/buy`, alice.token, {itemId: rope.id, buyerId: hero.id})).statusCode, 400, 'already sold');
  });

  await t.test('selling gets half the price; an item without a price is not bought', async () => {
    const rope = (await request('GET', `${characters}/${hero.id}/contents`, alice.token)).json();
    const ropeId = (rope.contents ?? rope.items ?? rope.objects ?? []).find((item: any) => item.name.startsWith('Пеньковая'))?.id;
    assert.ok(ropeId, JSON.stringify(rope));
    const sold = await request('POST', `${characters}/${trader.id}/sell`, alice.token, {itemId: ropeId, sellerId: hero.id});
    assert.equal(sold.statusCode, 200, sold.body);
    assert.equal(sold.json().incomeCp, 50);
    assert.deepEqual(await wallet(hero.id), {cp: 0, sp: 10, ep: 0, gp: 9, pp: 0});
    const junk = (await request('POST', characters, alice.token, {kind: 'object', name: 'Камешек'})).json();
    await request('PUT', `${characters}/${junk.id}/container`, alice.token, {containerId: hero.id});
    const refused = await request('POST', `${characters}/${trader.id}/sell`, alice.token, {itemId: junk.id, sellerId: hero.id});
    assert.equal(refused.statusCode, 400);
    assert.match(refused.json().message, /нет цены/);
  });

  await t.test('magic items have a price by rarity, the GM sets prices and stocks own goods', async () => {
    const given = await request('POST', `${characters}/${hero.id}/items`, gm.token, {srdIndex: 'cloak-of-protection'});
    assert.equal(given.statusCode, 201, given.body);
    assert.equal(given.json().item.price_cp, 40000);
    const offers = (await request('GET', `${characters}/${trader.id}/offers/${hero.id}`, alice.token)).json().offers;
    const cloak = offers.find((offer: any) => offer.id === given.json().item.id);
    assert.deepEqual([cloak.priceCp, cloak.incomeCp, cloak.rarity], [40000, 20000, 'uncommon']);
    assert.equal((await request('GET', `${characters}/${trader.id}/offers/${hero.id}`, bob.token)).statusCode, 403, 'not his hero');
    await pg.query('UPDATE characters SET price_cp=NULL WHERE id=$1', [cloak.id]);
    const sold = await request('POST', `${characters}/${trader.id}/sell`, alice.token, {itemId: cloak.id, sellerId: hero.id});
    assert.equal(sold.statusCode, 200, sold.body);
    assert.equal(sold.json().incomeCp, 20000);
    const forPlayer = (await request('GET', `${characters}/${trader.id}/shop`, alice.token)).json();
    assert.equal(forPlayer.canManage, false);
    const cloakGood = forPlayer.goods.find((good: any) => good.id === cloak.id);
    assert.deepEqual([Number(cloakGood.price_cp), cloakGood.rarity], [40000, 'uncommon']);
    const goodPath = `${characters}/${trader.id}/goods/${cloak.id}`;
    assert.equal((await request('PUT', goodPath, alice.token, {priceCp: 1})).statusCode, 403);
    assert.equal((await request('PUT', goodPath, gm.token, {priceCp: 75000})).statusCode, 200);
    const forGm = (await request('GET', `${characters}/${trader.id}/shop`, gm.token)).json();
    assert.equal(forGm.canManage, true);
    const repriced = forGm.goods.find((good: any) => good.id === cloak.id);
    assert.deepEqual([Number(repriced.price_cp), repriced.default_price], [75000, false]);
    assert.equal((await request('POST', `${characters}/${trader.id}/goods`, alice.token, {name: 'Подделка', priceCp: 1})).statusCode, 403);
    const own = await request('POST', `${characters}/${trader.id}/goods`, gm.token, {name: 'Карта сокровищ', priceCp: 2500, weightLb: 0.1, text: 'Крестик у старой мельницы.'});
    assert.equal(own.statusCode, 201, own.body);
    assert.deepEqual([own.json().item.name, own.json().item.price_cp], ['Карта сокровищ', 2500]);
    assert.equal((await sheet(own.json().item.id)).sheet_extra?.text?.about?.value, 'Крестик у старой мельницы.');
    assert.ok((await request('GET', `${characters}/${trader.id}/shop`, alice.token)).json().goods.some((good: any) => good.name === 'Карта сокровищ'));
    const stocked = await request('POST', `${characters}/${trader.id}/items`, gm.token, {srdIndex: 'ring-of-protection'});
    assert.equal(stocked.json().item.price_cp, 400000, 'rare — 4000 gp');
  });

  await t.test('money passes from hand to hand', async () => {
    assert.equal((await request('POST', `${characters}/${hero.id}/coins/give`, bob.token, {toCharacterId: friend.id, amountCp: 100})).statusCode, 403);
    assert.equal((await request('POST', `${characters}/${hero.id}/coins/give`, alice.token, {toCharacterId: friend.id, amountCp: 1_000_000})).statusCode, 400);
    assert.equal((await request('POST', `${characters}/${hero.id}/coins/give`, alice.token, {toCharacterId: friend.id, amountCp: 250})).statusCode, 200);
    assert.deepEqual(await wallet(friend.id), {cp: 0, sp: 5, ep: 0, gp: 2, pp: 0});
    assert.equal(Object.values(await wallet(hero.id)).reduce((a: number, b: any) => a + b, 0) > 0, true);
  });

  await t.test('imported sheets bring their coins into the wallet', async () => {
    const original = {
      edition: '2014', sheetEdition: '2014', spells: {prepared: []},
      data: JSON.stringify({
        jsonType: 'character', name: {value: 'Импортированный'},
        stats: {str: {score: 10}, dex: {score: 10}, con: {score: 10}, int: {score: 10}, wis: {score: 10}, cha: {score: 10}},
        vitality: {'hp-current': {value: 5}, 'hp-max': {value: 5}, 'hp-temp': {value: 0}, ac: {value: 10}, speed: {value: 30}, darkvision: {value: 0}},
        info: {}, subInfo: {}, saves: {}, skills: {}, spellsInfo: {}, spells: {}, weaponsList: [], text: {}, resources: {}, conditions: [],
        coins: {gp: {value: 12}, sp: 3, cp: 'много'},
      }),
    };
    const draft = await request('POST', `/campaigns/${campaignId}/imports`, alice.token, {importer: 'lss', original});
    assert.equal(draft.statusCode < 300, true, draft.body);
    const confirmed = await request('POST', `/campaigns/${campaignId}/imports/${draft.json().id}/confirm`, alice.token, {draftRevision: draft.json().draft_revision});
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    const imported = await wallet(confirmed.json().characterId);
    assert.deepEqual([imported.gp, imported.sp, imported.cp], [12, 3, 0], 'a word instead of a number counts as nothing');
  });
});
