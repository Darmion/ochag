import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('spells cast from items: charges instead of slots, the level chosen by charges, scrolls used up', async t => {
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

  const gm = await register('gm_wands'), alice = await register('alice_wands'), bob = await register('bob_wands');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Wands'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await request('POST', '/campaigns/join', bob.token, {code});
  const base = `/campaigns/${campaignId}`;
  const hero = (await request('POST', `${base}/characters`, alice.token, {
    kind: 'character', name: 'Лира', hpMax: 30, hpCurrent: 30, armorClass: 12, speedFeet: 30, level: 3, intelligence: 14,
  })).json();

  const gift = async (srdIndex: string, extra: Record<string, unknown> = {}) => {
    const response = await request('POST', `${base}/characters/${hero.id}/items`, gm.token, {srdIndex, ...extra});
    assert.equal(response.statusCode, 201, response.body);
    return response.json().item as {id: string; name: string};
  };
  const spells = async (token = alice.token) => (await request('GET', `${base}/characters/${hero.id}/spells`, token)).json().spells as any[];
  const cast = (id: string, body: Record<string, unknown> = {}) => request('POST', `${base}/characters/${hero.id}/spells/${id}/cast`, alice.token, body);
  const charges = async (itemId: string) => Number((await pg.query<any>('SELECT charges_current FROM magic_items WHERE character_id=$1', [itemId])).rows[0].charges_current);

  await t.test('a wand works only in hand; then its spells come with the item and the levels its charges pay for', async () => {
    const wand = await gift('wand-of-magic-detection');
    assert.equal((await spells()).some(entry => entry.item), false, 'in the pack it casts nothing');
    const refused = await cast(`item-${wand.id}-detect-magic`);
    assert.equal(refused.statusCode, 400);
    assert.match(refused.json().message, /сейчас не действует: его нужно надеть или взять в руку/);
    await request('POST', `${base}/characters/${wand.id}/equip`, alice.token, {equipped: true});
    const entry = (await spells()).find(candidate => candidate.item);
    assert.equal(entry.id, `item-${wand.id}-detect-magic`);
    assert.deepEqual(entry.item, {itemId: wand.id, name: 'Палочка обнаружения магии', levels: [{level: 1, cost: 1}], charges: {current: 3, max: 3}, dc: null, attack: null, scroll: false});
    assert.equal(entry.spell.nameRu, 'Обнаружение магии');
    assert.equal(((await spells(bob.token)) ?? []).some(candidate => candidate.item), false, 'another player does not see them');

    const done = await cast(entry.id);
    assert.equal(done.statusCode, 201, done.body);
    assert.deepEqual([done.json().item.cost, done.json().item.left], [1, 2]);
    assert.equal(await charges(wand.id), 2);
    assert.match((await cast(entry.id, {pact: true})).json().message, /без ячейк/);
  });

  await t.test('a wand of magic missiles: each extra charge raises the level; not enough charges — refused', async () => {
    const wand = await gift('wand-of-magic-missiles');
    await request('POST', `${base}/characters/${wand.id}/equip`, alice.token, {equipped: true});
    const entry = (await spells()).find(candidate => candidate.id === `item-${wand.id}-magic-missile`);
    assert.deepEqual(entry.item.levels.slice(0, 3), [{level: 1, cost: 1}, {level: 2, cost: 2}, {level: 3, cost: 3}]);
    assert.equal(entry.item.levels.length, 7);
    const three = await cast(entry.id, {slotLevel: 3});
    assert.equal(three.statusCode, 201, three.body);
    assert.equal(await charges(wand.id), 4);
    const tooMuch = await cast(entry.id, {slotLevel: 5});
    assert.equal(tooMuch.statusCode, 400);
    assert.match(tooMuch.json().message, /на уровне 1 \(1 зар\.\), 2 \(2 зар\.\), 3 \(3 зар\.\), 4 \(4 зар\.\)/);
  });

  await t.test('a scroll holds a spell of its level, cast once with the scroll numbers', async () => {
    assert.equal((await request('POST', `${base}/characters/${hero.id}/items`, gm.token, {srdIndex: 'spell-scroll-1st'})).statusCode, 400);
    const wrong = await request('POST', `${base}/characters/${hero.id}/items`, gm.token, {srdIndex: 'spell-scroll-1st', spell: 'fireball'});
    assert.match(wrong.json().message, /заклинание 1 круга, а «Огненный шар» — 3 круга/);
    assert.equal((await request('POST', `${base}/characters/${hero.id}/items`, gm.token, {srdIndex: 'ring-of-protection', spell: 'shield'})).statusCode, 400);
    const scroll = await gift('spell-scroll-1st', {spell: 'detect-magic'});
    assert.equal(scroll.name, 'Свиток заклинания (1 круг): «Обнаружение магии»');
    const entry = (await spells()).find(candidate => candidate.id === `item-${scroll.id}-detect-magic`);
    assert.deepEqual([entry.item.scroll, entry.item.dc, entry.item.attack, entry.item.levels], [true, 13, 5, [{level: 1, cost: 0}]]);
    const read = await cast(entry.id);
    assert.equal(read.statusCode, 201, read.body);
    assert.equal(read.json().item.used, true);
    assert.equal(Boolean((await pg.query('SELECT 1 FROM characters WHERE id=$1', [scroll.id])).rows[0]), false, 'the scroll crumbles');
    assert.equal((await cast(entry.id)).statusCode, 404);
  });

  await t.test('the longest SRD texts fit: the deck of many things', async () => {
    const deck = await gift('deck-of-many-things');
    const description = (await pg.query<any>('SELECT description FROM magic_items WHERE character_id=$1', [deck.id])).rows[0].description;
    assert.ok(description.length > 5000);
    assert.match(description, /Визирь\. В любой момент в течение года/);
  });
});
