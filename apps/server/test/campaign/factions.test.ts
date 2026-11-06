import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('factions', async t => {
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
  const gm = await register('gm_factions'), alice = await register('alice_factions'), bob = await register('bob_factions');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Factions'})).json().id;
  for (const player of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', player.token, {code});
  }
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const factions = `${base}/factions`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Рынок', widthCells: 12, heightCells: 12})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const creature = async (token: string, fields: any) => (await request('POST', `${base}/characters`, token, {hpMax: 20, hpCurrent: 20, speedFeet: 30, armorClass: 12, ...fields})).json();
  const lira = await creature(alice.token, {kind: 'character', name: 'Лира', strength: 16, level: 3});
  const bran = await creature(bob.token, {kind: 'character', name: 'Бран', level: 3});
  const goblin = await creature(gm.token, {kind: 'npc', name: 'Гоблин', disposition: 'hostile'});
  const trader = await creature(gm.token, {kind: 'npc', name: 'Лавочник', disposition: 'friendly'});
  for (const [entry, x, z, token] of [[lira, 0.5, 0.5, alice.token], [bran, 1.5, 0.5, bob.token], [goblin, -0.5, 0.5, gm.token], [trader, 0.5, 1.5, gm.token]] as const) {
    assert.equal((await request('POST', `${scenePath}/objects`, token, {characterId: entry.id, x, z})).statusCode, 201);
  }
  const axe = (await request('POST', `${base}/characters/${lira.id}/weapons`, alice.token, {
    name: 'Секира', ability: 'strength', proficient: true, damageFormula: '1d12+@str', damageType: 'slashing',
  })).json();

  const list = async (token = gm.token) => (await request('GET', factions, token)).json();
  const system = async (code: string) => (await list()).factions.find((faction: any) => faction.system === code);
  const sides = async (token: string) => Object.fromEntries((await request('GET', scenePath, token)).json().objects.map((object: any) => [object.name, object.side]));
  const objectOf = async (token: string, characterId: string) => (await request('GET', scenePath, token)).json().objects.find((object: any) => object.character_id === characterId);
  const setFactions = (characterId: string, factionIds: string[]) => request('PUT', `${base}/characters/${characterId}/factions`, gm.token, {factionIds});
  const relate = (a: string, b: string, relation: string, restrictions: string[] = []) => request('PUT', `${factions}/relations`, gm.token, {a, b, relation, restrictions});
  let guild = '';

  await t.test('built-in «Отряд» and «Враги»; only the GM manages factions, a player sees just their own', async () => {
    const all = await list();
    assert.equal(all.manage, true);
    const party = all.factions.find((faction: any) => faction.system === 'party');
    const enemies = all.factions.find((faction: any) => faction.system === 'enemies');
    assert.equal(party.name, 'Отряд');
    assert.deepEqual(party.rights, ['shared-vision', 'see-hp']);
    assert.deepEqual(party.members.map((member: any) => member.name).sort(), ['Бран', 'Лавочник', 'Лира']);
    assert.deepEqual(enemies.members.map((member: any) => member.name), ['Гоблин']);
    assert.equal(all.relations.length, 1);
    assert.equal(all.relations[0].relation, 'enemy');

    assert.equal((await request('POST', factions, alice.token, {name: 'Мои'})).statusCode, 403);
    assert.equal((await request('POST', factions, gm.token, {name: 'x'.repeat(61)})).statusCode, 400);
    const created = await request('POST', factions, gm.token, {name: 'Гильдия воров'});
    assert.equal(created.statusCode, 201, created.body);
    guild = created.json().id;
    assert.equal((await request('DELETE', `${factions}/${party.id}`, gm.token)).statusCode, 400, 'a built-in faction stays');

    const mine = await list(alice.token);
    assert.equal(mine.manage, false);
    assert.deepEqual(mine.factions.map((faction: any) => faction.name), ['Отряд']);
    assert.deepEqual(mine.relations, [], 'who is hostile to whom is the GM’s secret');
  });

  await t.test('token sides follow factions, for each viewer; the GM also sees the faction ids', async () => {
    assert.deepEqual(await sides(alice.token), {Лира: 'self', Бран: 'ally', Гоблин: 'enemy', Лавочник: 'ally'});
    const forGm = await sides(gm.token);
    assert.deepEqual(forGm, {Лира: 'ally', Бран: 'ally', Гоблин: 'enemy', Лавочник: 'ally'});
    const party = await system('party');
    assert.deepEqual((await objectOf(gm.token, lira.id)).factions, [party.id]);
    const seen = await objectOf(alice.token, goblin.id);
    assert.equal(seen.factions, undefined, 'a player gets no faction ids');
    assert.equal(seen.factions_explicit, undefined);

    assert.equal((await setFactions(goblin.id, [guild])).statusCode, 200);
    assert.equal((await relate(guild, party.id, 'ally')).statusCode, 200);
    assert.equal((await sides(alice.token)).Гоблин, 'ally');
    assert.equal((await relate(party.id, guild, 'neutral')).statusCode, 200);
    assert.equal((await sides(alice.token)).Гоблин, 'neutral');
    assert.equal((await list()).relations.length, 1, 'neutral without restrictions is not stored');
    assert.equal((await request('DELETE', `${base}/characters/${goblin.id}/factions`, gm.token)).statusCode, 200);
    assert.equal((await sides(alice.token)).Гоблин, 'enemy');
  });

  await t.test('rights: allies’ hit points, and acting with an ally’s creature', async () => {
    const party = await system('party');
    assert.notEqual((await objectOf(alice.token, bran.id)).hp, null, '«Отряд» sees the party’s hit points');
    assert.equal((await request('PATCH', `${factions}/${party.id}`, gm.token, {rights: ['shared-vision']})).statusCode, 200);
    assert.equal((await objectOf(alice.token, bran.id)).hp, null);
    assert.equal((await objectOf(alice.token, bran.id)).canEdit, false);
    const check = () => request('POST', `${base}/rolls/check`, alice.token, {characterId: bran.id, kind: 'skill', key: 'perception'});
    assert.equal((await check()).statusCode, 403);
    assert.equal((await request('PATCH', `${factions}/${party.id}`, gm.token, {rights: ['shared-vision', 'see-hp', 'control']})).statusCode, 200);
    assert.equal((await objectOf(alice.token, bran.id)).canEdit, true, '«Управлять своими» — like an edit grant');
    assert.equal((await check()).statusCode, 201);
    assert.equal((await objectOf(alice.token, goblin.id)).canEdit, false, 'not an enemy');
    await request('PATCH', `${factions}/${party.id}`, gm.token, {rights: ['shared-vision', 'see-hp']});
  });

  await t.test('bonuses: attack for the whole faction, AC of the target — with the reasons', async () => {
    const party = await system('party'), enemies = await system('enemies');
    const preview = async () => (await request('GET', `${base}/rolls/attack-preview?characterId=${lira.id}&key=${axe.id}&targetCharacterId=${goblin.id}&sceneId=${sceneId}`, alice.token)).json();
    const plain = await preview();
    assert.equal((await request('PATCH', `${factions}/${party.id}`, gm.token, {bonuses: [{kind: 'attack', value: 2}]})).statusCode, 200);
    const better = await preview();
    assert.ok(better.hitChance > plain.hitChance, JSON.stringify(better));
    assert.ok(better.reasons.includes('фракция «Отряд» +2'), JSON.stringify(better.reasons));
    assert.equal((await request('PATCH', `${factions}/${enemies.id}`, gm.token, {bonuses: [{kind: 'ac', value: 5}]})).statusCode, 200);
    const guarded = await preview();
    assert.ok(guarded.hitChance < better.hitChance);
    assert.ok(guarded.reasons.includes('КД цели: фракция «Враги» +5'), JSON.stringify(guarded.reasons));

    const swing = await request('POST', `${base}/rolls/check`, alice.token, {characterId: lira.id, kind: 'attack', key: axe.id, targetCharacterId: goblin.id, sceneId});
    assert.equal(swing.statusCode, 201, swing.body);
    assert.ok(swing.json().outcome.reasons.includes('фракция «Отряд» +2'), JSON.stringify(swing.json().outcome));
    assert.equal(swing.json().modifier, 7);
    await request('PATCH', `${factions}/${party.id}`, gm.token, {bonuses: []});
    await request('PATCH', `${factions}/${enemies.id}`, gm.token, {bonuses: []});
  });

  await t.test('«Не по своим»: an attack at an ally asks first; without the flag it just happens', async () => {
    const swing = (warnFriendly: boolean) => request('POST', `${base}/rolls/check`, alice.token, {
      characterId: lira.id, kind: 'attack', key: axe.id, targetCharacterId: bran.id, sceneId, warnFriendly,
    });
    const warned = await swing(true);
    assert.equal(warned.statusCode, 409, warned.body);
    assert.equal(warned.json().error, 'FRIENDLY_FIRE');
    assert.deepEqual(warned.json().details, {harmful: true, targets: [{id: bran.id, name: 'Бран'}]});
    assert.match(warned.json().message, /«Бран» — ваш союзник/);
    const enemy = await request('POST', `${base}/rolls/check`, alice.token, {characterId: lira.id, kind: 'attack', key: axe.id, targetCharacterId: goblin.id, sceneId, warnFriendly: true});
    assert.equal(enemy.statusCode, 201, 'an enemy — no question');
    assert.equal((await swing(false)).statusCode, 201, 'confirmed — the blow lands');

    const cure = (await pg.query<any>(`INSERT INTO character_spells(campaign_id, character_id, source, srd_index) VALUES ($1,$2,'srd','cure-wounds') RETURNING id`, [campaignId, lira.id])).rows[0].id;
    await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,1,2,2)`, [campaignId, lira.id]);
    const cast = (targetId: string, warnFriendly: boolean) => request('POST', `${base}/characters/${lira.id}/spells/${cure}/cast`, alice.token, {targetIds: [targetId], sceneId, warnFriendly});
    const healEnemy = await cast(goblin.id, true);
    assert.equal(healEnemy.statusCode, 409, healEnemy.body);
    assert.deepEqual(healEnemy.json().details, {harmful: false, targets: [{id: goblin.id, name: 'Гоблин'}]});
    assert.match(healEnemy.json().message, /ваш враг\. Всё равно помочь/);
    const slots = async () => (await pg.query<any>('SELECT current FROM character_spell_slots WHERE character_id=$1 AND level=1', [lira.id])).rows[0].current;
    assert.equal(await slots(), 2, 'the question costs no slot');
    assert.equal((await cast(bran.id, true)).statusCode, 201, 'healing an ally — no question');
    assert.equal(await slots(), 1);
  });

  await t.test('«Не торгуют» between factions closes the shop', async () => {
    const party = await system('party');
    await request('PATCH', `${base}/characters/${trader.id}`, gm.token, {revision: (await request('GET', `${base}/characters/${trader.id}`, gm.token)).json().revision, merchant: true});
    await request('POST', `${base}/characters/${trader.id}/gear`, gm.token, {srdIndex: 'torch'});
    const torch = (await request('GET', `${base}/characters/${trader.id}/shop`, alice.token)).json().goods[0];
    await pg.query('UPDATE characters SET gp=5 WHERE id=$1', [lira.id]);
    assert.equal((await setFactions(trader.id, [guild])).statusCode, 200);
    assert.equal((await relate(guild, party.id, 'neutral', ['no-trade'])).statusCode, 200);
    const refused = await request('POST', `${base}/characters/${trader.id}/buy`, alice.token, {itemId: torch.id, buyerId: lira.id});
    assert.equal(refused.statusCode, 403);
    assert.match(refused.json().message, /не торгует с вашей фракцией/);
    assert.equal((await relate(guild, party.id, 'neutral')).statusCode, 200);
    assert.equal((await request('POST', `${base}/characters/${trader.id}/buy`, alice.token, {itemId: torch.id, buyerId: lira.id})).statusCode, 200);
  });

  await t.test('group turns go by factions: allied factions in a row act together', async () => {
    const party = await system('party');
    const initiative = `${scenePath}/initiative`;
    for (const [entry, token] of [[lira, alice.token], [goblin, gm.token], [bran, bob.token], [trader, gm.token]] as const) {
      assert.equal((await request('POST', `${initiative}/join`, token, {characterId: entry.id})).statusCode, 201);
    }
    for (const [entry, score] of [[lira, 20], [goblin, 15], [bran, 10], [trader, 5]] as const) {
      await pg.query('UPDATE initiative_entries SET score=$2 WHERE character_id=$1', [entry.id, score]);
    }
    const current = async () => (await request('GET', initiative, gm.token)).json().entries.filter((entry: any) => entry.is_current).map((entry: any) => entry.name).sort();
    await setFactions(goblin.id, [guild]);
    await relate(guild, party.id, 'ally');
    await request('POST', `${initiative}/start`, gm.token, {});
    assert.deepEqual(await current(), ['Бран', 'Гоблин', 'Лавочник', 'Лира'], 'the guild is allied — one group');
    await relate(guild, party.id, 'enemy');
    assert.equal((await request('POST', `${initiative}/advance`, gm.token)).statusCode, 204);
    assert.deepEqual(await current(), ['Лира'], 'now the goblin splits the line');
    assert.equal((await request('POST', `${initiative}/advance`, gm.token)).statusCode, 204);
    assert.deepEqual(await current(), ['Гоблин'], 'Бран comes next and is hostile to the guild — the goblin acts alone');
  });

  await t.test('loot «поровну»: coins split among allied heroes on the scene, the remainder to the looter', async () => {
    const corpse = await creature(gm.token, {kind: 'npc', name: 'Разбойник', disposition: 'hostile', hpCurrent: 0});
    await request('POST', `${scenePath}/objects`, gm.token, {characterId: corpse.id, x: 3.5, z: 3.5});
    await pg.query(`INSERT INTO character_effects(campaign_id, character_id, effect_code) VALUES ($1,$2,'dead')`, [campaignId, corpse.id]);
    await pg.query('UPDATE characters SET gp=11, sp=1 WHERE id=$1', [corpse.id]);
    await pg.query('UPDATE characters SET gp=0, sp=0 WHERE id = ANY($1::uuid[])', [[lira.id, bran.id]]);
    const taken = await request('POST', `${scenePath}/loot/${corpse.id}`, gm.token, {looterId: lira.id, itemIds: [], coins: true, share: true});
    assert.equal(taken.statusCode, 200, taken.body);
    assert.deepEqual(taken.json().shares.map((share: any) => [share.name, share.coins.gp, share.coins.sp]), [['Лира', 6, 1], ['Бран', 5, 0]]);
    const wallets = (await pg.query('SELECT name, gp, sp FROM characters WHERE id = ANY($1::uuid[]) ORDER BY name', [[lira.id, bran.id, corpse.id]])).rows;
    assert.deepEqual(wallets.map((row: any) => [row.name, row.gp, row.sp]), [['Бран', 5, 0], ['Лира', 6, 1], ['Разбойник', 0, 0]]);
  });

  await t.test('a copy keeps its own factions; a deleted creature leaves no membership behind', async () => {
    const copies = await request('POST', `${base}/characters/${goblin.id}/duplicate`, gm.token, {count: 1});
    assert.equal(copies.statusCode, 201, copies.body);
    const copy = copies.json().characters[0];
    const guildRow = (await list()).factions.find((faction: any) => faction.id === guild);
    assert.ok(guildRow.members.some((member: any) => member.id === copy.id && member.explicit), JSON.stringify(guildRow.members));
    assert.equal((await request('DELETE', `${base}/characters/${copy.id}`, gm.token)).statusCode, 204);
    assert.equal((await pg.query('SELECT 1 FROM faction_members WHERE character_id=$1', [copy.id])).rows.length, 0);
  });
});
