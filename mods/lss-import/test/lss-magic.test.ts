import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../apps/server/src/app.ts';
import {createTestDatabase} from '../../../apps/server/test/helpers.ts';
import '../../../apps/server/test/lssImporter.ts';

const ID_SHIELD = '65d3c172f3d820fa1add4871';
const ID_SKIP = '65d3c16af3d820fa1add439a';
const ID_BOOK = '65d3c169f3d820fa1add429e';
const ID_FREE = '65d3c173f3d820fa1add48cc';

function sheet(name: string, data: Record<string, any>, spells: Record<string, any>) {
  return {
    edition: '2014', sheetEdition: '2014', spells: {mode: 'cards', ...spells},
    data: JSON.stringify({
      jsonType: 'character', name: {value: name}, proficiency: 3,
      stats: {str: {score: 10}, dex: {score: 12}, con: {score: 14}, int: {score: 16}, wis: {score: 16}, cha: {score: 16}},
      vitality: {'hp-current': {value: 30}, 'hp-max': {value: 30}, 'hp-temp': {value: 0}, ac: {value: 14}, speed: {value: 30}},
      saves: {}, skills: {}, weaponsList: [], coins: {}, resources: {}, conditions: [], text: {},
      ...data,
    }),
  };
}

test('LSS magic: pact slots, sheet DC and attack, named and numbered spells', async t => {
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

  const gm = await register('gm_magic'), alice = await register('alice_magic'), bob = await register('bob_magic');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Magic'})).json().id;
  for (const member of [alice, bob]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', member.token, {code});
  }
  const importAs = async (token: string, original: any) => {
    const draft = (await request('POST', `/campaigns/${campaignId}/imports`, token, {importer: 'lss', original})).json();
    const confirmed = await request('POST', `/campaigns/${campaignId}/imports/${draft.id}/confirm`, token, {draftRevision: draft.draft_revision});
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    return {id: confirmed.json().characterId as string, warnings: draft.warnings as string[]};
  };
  const spellsOf = async (id: string) => (await request('GET', `/campaigns/${campaignId}/characters/${id}/spells`, gm.token)).json().spells
    .map((entry: any) => [entry.srdIndex, entry.prepared, entry.granted, entry.slotless]).sort();
  const slotsOf = async (id: string) => (await pg.query<any>('SELECT level, current, max FROM character_spell_slots WHERE character_id=$1 ORDER BY level', [id])).rows;

  let cleric = '', warlock = '', wizard = '';

  await t.test('a cleric of the old template: spells by dnd.su links, DC and attack from the sheet', async () => {
    const imported = await importAs(alice.token, sheet('Ивета', {
      info: {charClass: {value: 'Жрец'}, level: {value: 5}},
      spellsInfo: {base: {code: 'wis'}, save: {value: '14'}, mod: {value: '+6'}},
      spells: {'slots-1': {value: 4, filled: 1}, 'slots-0': {filled: 1}},
      text: {
        'spells-level-0': {value: {data: '<p><a href=https://dnd.su/spells/332-resistance/>Сопротивление [Resistance]</a></p><p><a href=https://dnd.su/spells/105-guidance/>Указание [Guidance]</a></p>'}},
        'spells-level-1': {value: {data: '<p><a href=https://dnd.su/spells/145-cure_wounds/>Лечение ран [Cure wounds]</a></p><p><a href="https://dnd.su/spells/900-toll_the_dead/">Погребальный звон [Toll the dead]</a></p>'}},
      },
    }, {prepared: [ID_SHIELD, ID_SKIP], book: []}));
    cleric = imported.id;
    assert.ok(imported.warnings.some(warning => /СЛ заклинаний 14, атака заклинанием \+6; заклинания по названиям: 4/.test(warning)), JSON.stringify(imported.warnings));

    assert.deepEqual(await spellsOf(cleric), [['cure-wounds', true, false, false], ['guidance', true, false, false], ['resistance', true, false, false]]);
    const casting = (await request('GET', `/campaigns/${campaignId}/characters/${cleric}/spellcasting`, alice.token)).json();
    assert.deepEqual([casting.ability, casting.dc, casting.attack, casting.dcOverride, casting.attackOverride], ['wisdom', 14, 6, 14, 6]);
    assert.deepEqual(casting.pending.map((entry: any) => [entry.ref, entry.label, entry.lists]), [
      ['dndsu:toll_the_dead', 'Погребальный звон', ['prepared']],
      [ID_SHIELD, null, ['prepared']],
      [ID_SKIP, null, ['prepared']],
    ]);
    assert.deepEqual((await request('GET', `/campaigns/${campaignId}/characters/${cleric}/spellcasting`, bob.token)).json().pending, [], 'others do not see what is pending');
  });

  await t.test('a warlock: pact slots join the common slots on the pact level', async () => {
    const imported = await importAs(bob.token, sheet('Торвин', {
      info: {charClass: {value: 'Колдун'}, level: {value: 5}},
      spellsInfo: {base: {code: 'cha'}, save: {value: ''}, mod: {value: ''}},
      spells: {'slots-2': {value: 2, filled: 0}},
      spellsPact: {'slots-2': {value: 0}, 'slots-3': {value: 2, filled: 2}},
    }, {prepared: [ID_SHIELD], book: []}));
    warlock = imported.id;
    assert.deepEqual(await slotsOf(warlock), [{level: 2, current: 2, max: 2}, {level: 3, current: 0, max: 2}]);
    const casting = (await request('GET', `/campaigns/${campaignId}/characters/${warlock}/spellcasting`, bob.token)).json();
    assert.deepEqual([casting.ability, casting.dcOverride, casting.dc, casting.attack], ['charisma', null, 14, 6], '8 + 3 + CHA 3');
    assert.deepEqual(casting.pending[0].characters.sort(), ['Ивета', 'Торвин']);
  });

  await t.test('mapping a numbered LSS spell once gives it to every character with it', async () => {
    const path = `/campaigns/${campaignId}/spell-refs/${ID_SHIELD}`;
    assert.equal((await request('PUT', path, alice.token, {source: 'srd', srdIndex: 'no-such-spell'})).statusCode, 400);
    const mapped = await request('PUT', path, alice.token, {source: 'srd', srdIndex: 'shield'});
    assert.equal(mapped.statusCode, 200, mapped.body);
    assert.equal(mapped.json().added, 2);
    assert.ok((await spellsOf(warlock)).some((entry: any[]) => entry[0] === 'shield'));
    assert.equal((await request('PUT', path, bob.token, {source: 'srd', srdIndex: 'mage-armor'})).statusCode, 403, 'someone else’s mapping — the GM changes it');
    assert.equal((await request('PUT', path, gm.token, {source: 'srd', srdIndex: 'shield'})).statusCode, 200);

    assert.equal((await request('PUT', `/campaigns/${campaignId}/spell-refs/${ID_SKIP}`, alice.token, {source: 'skip'})).json().added, 0);
    assert.equal((await request('PUT', `/campaigns/${campaignId}/spell-refs/not-a-ref`, alice.token, {source: 'skip'})).statusCode, 400);
    const pending = (await request('GET', `/campaigns/${campaignId}/characters/${cleric}/spellcasting`, alice.token)).json().pending;
    assert.deepEqual(pending.map((entry: any) => entry.ref), ['dndsu:toll_the_dead']);
  });

  await t.test('a wizard: spellbook-only spells are known but not prepared; slotless spells cost no slot', async () => {
    await request('PUT', `/campaigns/${campaignId}/spell-refs/${ID_BOOK}`, gm.token, {source: 'srd', srdIndex: 'magic-missile'});
    await request('PUT', `/campaigns/${campaignId}/spell-refs/${ID_FREE}`, gm.token, {source: 'srd', srdIndex: 'detect-magic'});
    const imported = await importAs(alice.token, sheet('Мелвин', {
      info: {charClass: {value: 'Волшебник'}, level: {value: 3}},
      spellsInfo: {base: {code: 'int'}},
      spells: {'slots-1': {value: 4, filled: 4}},
    }, {prepared: [ID_SHIELD], book: [ID_SHIELD, ID_BOOK], slotless: [ID_FREE], granted: []}));
    wizard = imported.id;
    assert.deepEqual(await spellsOf(wizard), [
      ['detect-magic', true, false, true],
      ['magic-missile', false, false, false],
      ['shield', true, false, false],
    ], 'mappings made earlier apply at import');

    const free = (await request('GET', `/campaigns/${campaignId}/characters/${wizard}/spells`, alice.token)).json().spells.find((entry: any) => entry.srdIndex === 'detect-magic');
    const cast = await request('POST', `/campaigns/${campaignId}/characters/${wizard}/spells/${free.id}/cast`, alice.token, {});
    assert.equal(cast.statusCode, 201, cast.body);
    assert.equal(cast.json().slot, null);
    assert.deepEqual(await slotsOf(wizard), [{level: 1, current: 0, max: 4}]);
    const shield = (await request('GET', `/campaigns/${campaignId}/characters/${wizard}/spells`, alice.token)).json().spells.find((entry: any) => entry.srdIndex === 'shield');
    const noSlot = await request('POST', `/campaigns/${campaignId}/characters/${wizard}/spells/${shield.id}/cast`, alice.token, {});
    assert.equal(noSlot.statusCode, 400);
    assert.match(noSlot.json().message, /Нет свободных ячеек 1 уровня/);
  });

  await t.test('the sheet DC and attack can be set and cleared by hand', async () => {
    const path = `/campaigns/${campaignId}/characters/${cleric}/spellcasting`;
    assert.equal((await request('PUT', path, bob.token, {dcOverride: 20})).statusCode, 403);
    assert.equal((await request('PUT', path, alice.token, {dcOverride: 41})).statusCode, 400);
    assert.equal((await request('PUT', path, alice.token, {dcOverride: null, attackOverride: 7, ability: 'charisma'})).statusCode, 200);
    const casting = (await request('GET', path, alice.token)).json();
    assert.deepEqual([casting.ability, casting.dc, casting.attack, casting.dcOverride], ['charisma', 14, 7, null]);
  });
});
