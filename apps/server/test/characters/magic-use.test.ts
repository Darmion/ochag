import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('the full SRD magic item list: potions, magic weapons from a base, spell bonuses', async t => {
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

  const gm = await register('gm_potions'), alice = await register('alice_potions');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Potions'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  const base = `/campaigns/${campaignId}`;
  const hero = (await request('POST', `${base}/characters`, alice.token, {
    kind: 'character', name: 'Лира', hpMax: 40, hpCurrent: 10, armorClass: 12, speedFeet: 30, level: 5, intelligence: 16, className: 'Волшебник 5',
  })).json();

  const gift = async (srdIndex: string, extra: Record<string, unknown> = {}) => {
    const response = await request('POST', `${base}/characters/${hero.id}/items`, gm.token, {srdIndex, ...extra});
    assert.equal(response.statusCode, 201, response.body);
    return response.json().item as {id: string; name: string};
  };
  const use = (itemId: string, token = alice.token) => request('POST', `${base}/characters/${itemId}/use-magic`, token, {});
  const hp = async () => Number((await pg.query<any>('SELECT hp_current FROM characters WHERE id=$1', [hero.id])).rows[0].hp_current);
  const exists = async (id: string) => Boolean((await pg.query('SELECT 1 FROM characters WHERE id=$1', [id])).rows[0]);

  await t.test('the list has every SRD 5.1 item, with weapon and armor bases for the GM', async () => {
    const list = (await request('GET', '/srd/magic-items', alice.token)).json();
    assert.equal(list.items.length, 341);
    assert.ok(list.items.every((item: any) => item.nameRu && item.kindText && item.description));
    assert.ok(list.bases.weapon.some((option: any) => option.ref === 'weapon:longsword'));
    assert.ok(list.bases.armor.some((option: any) => option.ref === 'gear:chain-mail'));
    assert.deepEqual(list.bases.shield.map((option: any) => option.ref), ['gear:shield']);
  });

  await t.test('a healing potion is drunk: hit points back, the potion gone, a line in the chat', async () => {
    const potion = await gift('potion-of-healing-greater');
    assert.equal(potion.name, 'Зелье большого лечения');
    const view = (await request('GET', `${base}/characters/${hero.id}/items`, alice.token)).json().items.find((item: any) => item.id === potion.id).magic;
    assert.equal(view.useLabel, 'Выпить');
    const drunk = await use(potion.id);
    assert.equal(drunk.statusCode, 200, drunk.body);
    assert.match(drunk.json().summary, /^Лира: «Зелье большого лечения» — \+\d+ хитов \(4d4\+4: \d+\)\.$/);
    assert.ok(await hp() >= 18, 'at least 8 back');
    assert.equal(await exists(potion.id), false);
    assert.equal((await use(potion.id)).statusCode, 404);
    const chat = (await pg.query<any>('SELECT body FROM chat_messages WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 1', [campaignId])).rows[0];
    assert.match(chat.body, /Зелье большого лечения/);
  });

  await t.test('a resistance potion gives an hour of the right resistance; a ring is not drunk', async () => {
    const potion = await gift('potion-of-resistance-fire');
    assert.match((await use(potion.id)).json().summary, /сопротивление огню на 1 ч/);
    const ward = (await pg.query<any>(`SELECT parameters FROM character_effects WHERE character_id=$1 AND effect_code='energy_ward'`, [hero.id])).rows[0];
    assert.deepEqual([ward.parameters.damageType, ward.parameters.remainingRounds, ward.parameters.sourceName], ['fire', 600, 'Зелье сопротивления огню']);
    const ring = await gift('ring-of-protection');
    assert.match((await use(ring.id)).json().message, /так не используют/);
  });

  await t.test('in combat a potion costs the action', async () => {
    const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Зал', widthCells: 10, heightCells: 10})).json().id;
    await request('POST', `${base}/scenes/${sceneId}/objects`, alice.token, {characterId: hero.id, x: 1.5, z: 1.5});
    assert.equal((await request('POST', `${base}/scenes/${sceneId}/initiative/start`, gm.token, {})).statusCode, 201);
    const first = await gift('potion-of-heroism');
    const second = await gift('potion-of-climbing');
    const drunk = await use(first.id);
    assert.equal(drunk.statusCode, 200, drunk.body);
    assert.match(drunk.json().summary, /10 временных хитов, благословение на 1 ч/);
    const again = await use(second.id);
    assert.equal(again.statusCode, 400);
    assert.match(again.json().message, /действие в этот ход уже потрачено/);
    assert.equal((await request('DELETE', `${base}/scenes/${sceneId}/initiative`, gm.token)).statusCode, 204);
  });

  await t.test('a magic weapon made from a longsword hits with its bonus; a wrong base is refused', async () => {
    assert.equal((await request('POST', `${base}/characters/${hero.id}/items`, gm.token, {srdIndex: 'weapon-2', base: 'gear:chain-mail'})).statusCode, 400);
    const sword = await gift('weapon-2', {base: 'weapon:longsword'});
    assert.equal(sword.name, 'Длинный меч +2');
    const equipped = await request('POST', `${base}/characters/${sword.id}/equip-slot`, alice.token, {slot: 'main_hand'});
    assert.equal(equipped.statusCode, 200, equipped.body);
    const attack = (await pg.query<any>('SELECT id FROM character_weapons WHERE character_id=$1 AND source_item_id=$2', [hero.id, sword.id])).rows[0];
    assert.ok(attack, 'the sword became an attack');
    const roll = await request('POST', `${base}/rolls/check`, alice.token, {characterId: hero.id, kind: 'attack', key: attack.id});
    assert.equal(roll.statusCode, 201, roll.body);
    assert.equal(roll.json().modifier, 2, 'Strength 10, no proficiency with longswords for a wizard, +2 from the sword');
    assert.match(JSON.stringify(roll.json()), /магическое оружие \+2/);
  });

  await t.test('the robe of the archmagi adds 2 to spell attacks and DCs while it works', async () => {
    const before = (await request('GET', `${base}/characters/${hero.id}/spellcasting`, alice.token)).json();
    const robe = await gift('robe-of-the-archmagi');
    await request('POST', `${base}/characters/${robe.id}/equip`, alice.token, {equipped: true});
    assert.equal((await request('POST', `${base}/characters/${robe.id}/attune`, alice.token, {attuned: true})).statusCode, 200);
    const after = (await request('GET', `${base}/characters/${hero.id}/spellcasting`, alice.token)).json();
    assert.deepEqual([after.dc - before.dc, after.attack - before.attack], [2, 2]);
    await request('POST', `${base}/characters/${robe.id}/equip`, alice.token, {equipped: false});
    const off = (await request('GET', `${base}/characters/${hero.id}/spellcasting`, alice.token)).json();
    assert.deepEqual([off.dc, off.attack], [before.dc, before.attack]);
  });
});
