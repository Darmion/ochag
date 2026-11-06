import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';
import '../lssImporter.ts';

function longStoryShort(overrides: Record<string, any> = {}) {
  return {
    edition: '2014',
    sheetEdition: '2014',
    spells: {prepared: []},
    data: JSON.stringify({
      jsonType: 'character',
      name: {value: 'Liena'},
      stats: {
        str: {score: 16}, dex: {score: 14}, con: {score: 12},
        int: {score: 10}, wis: {score: 8}, cha: {score: 13},
      },
      vitality: {
        'hp-current': {value: 20}, 'hp-max': {value: 24}, 'hp-temp': {value: 0},
        ac: {value: 15}, speed: {value: 35}, darkvision: {value: 0},
      },
      info: {}, subInfo: {}, saves: {}, skills: {}, spellsInfo: {},
      spells: {}, weaponsList: [], text: {}, coins: {}, resources: {}, conditions: [],
    }),
    ...overrides,
  };
}

test('character import routes', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());

  const app = await buildApp(db);
  t.after(() => app.close());

  const request = async (method: any, url: string, token?: string, payload?: any) =>
    app.inject({
      method, url,
      ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}),
      ...(payload !== undefined ? {payload} : {}),
    });

  const password = 'Local test password 123!';

  const register = async (username: string) => {
    const response = await request('POST', '/auth/register', undefined, {username, password, displayName: username});
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };

  const countRows = async (table: string) => Number((await pg.query<{n: string}>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n);

  const owner = await register('gm_import'), player = await register('player_import'), outsider = await register('outsider_import');

  const campaignId = (await request('POST', '/campaigns', owner.token, {name: 'Import test'})).json().id;
  const inviteCode = (await request('POST', `/campaigns/${campaignId}/invites`, owner.token)).json().code;
  assert.equal((await request('POST', '/campaigns/join', player.token, {code: inviteCode})).statusCode, 201);

  const importsPath = () => `/campaigns/${campaignId}/imports`;

  await t.test('uploading a file only creates a draft, not a character', async () => {
    const before = await countRows('characters');
    const response = await request('POST', importsPath(), player.token, {importer: 'lss', original: longStoryShort()});
    assert.equal(response.statusCode, 201, response.body);
    const draft = response.json();
    assert.equal(draft.proposed_document.name, 'Liena');
    assert.equal(draft.current, null);
    assert.ok(draft.warnings.length > 0);
    assert.equal(await countRows('characters'), before);
  });

  await t.test('a non-member cannot start an import', async () => {
    assert.equal((await request('POST', importsPath(), outsider.token, {importer: 'lss', original: longStoryShort()})).statusCode, 404);
  });

  await t.test('a file that is not a Long Story Short sheet is rejected before a draft is created', async () => {
    const before = await countRows('import_drafts');
    const response = await request('POST', importsPath(), player.token, {importer: 'lss', original: {not: 'a character sheet'}});
    assert.equal(response.statusCode, 400);
    assert.equal(await countRows('import_drafts'), before);
  });

  await t.test('cancelling a draft leaves no character behind and blocks a later confirm', async () => {
    const draft = (await request('POST', importsPath(), player.token, {importer: 'lss', original: longStoryShort()})).json();
    assert.equal((await request('DELETE', `${importsPath()}/${draft.id}`, player.token)).statusCode, 204);
    assert.equal(
      (await request('POST', `${importsPath()}/${draft.id}/confirm`, player.token, {draftRevision: draft.draft_revision})).statusCode,
      409,
    );
  });

  let characterId = '';

  await t.test('confirming a draft creates exactly one character', async () => {
    const draft = (await request('POST', importsPath(), player.token, {importer: 'lss', original: longStoryShort()})).json();
    const confirmed = await request('POST', `${importsPath()}/${draft.id}/confirm`, player.token, {draftRevision: draft.draft_revision});
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(confirmed.json().alreadyConfirmed, false);
    characterId = confirmed.json().characterId;

    const character = (await pg.query<any>('SELECT owner_user_id, speed_feet, sheet_extra FROM characters WHERE id=$1', [characterId])).rows[0];
    assert.equal(character.owner_user_id, player.user.id);
    assert.equal(Number(character.speed_feet), 35);
    assert.equal(character.sheet_extra.darkvisionFeet, 0);
  });

  await t.test('confirming the same draft again does not duplicate the character', async () => {
    const draft = (await request('POST', importsPath(), player.token, {importer: 'lss', original: longStoryShort(), targetCharacterId: characterId})).json();
    const first = await request('POST', `${importsPath()}/${draft.id}/confirm`, player.token, {draftRevision: draft.draft_revision});
    assert.equal(first.statusCode, 200, first.body);
    const before = await countRows('characters');

    const second = await request('POST', `${importsPath()}/${draft.id}/confirm`, player.token, {draftRevision: draft.draft_revision});
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().alreadyConfirmed, true);
    assert.equal(second.json().characterId, first.json().characterId);
    assert.equal(await countRows('characters'), before);
  });

  await t.test('editing a draft rejects unknown fields and requires the current revision', async () => {
    const draft = (await request('POST', importsPath(), player.token, {importer: 'lss', original: longStoryShort()})).json();
    const basePath = `${importsPath()}/${draft.id}`;

    const badField = await request('PUT', basePath, player.token, {
      draftRevision: draft.draft_revision,
      proposal: {...draft.proposed_document, notAField: true},
    });
    assert.equal(badField.statusCode, 400);

    const edited = await request('PUT', basePath, player.token, {
      draftRevision: draft.draft_revision,
      proposal: {...draft.proposed_document, name: 'Liena the Bold'},
    });
    assert.equal(edited.statusCode, 200, edited.body);
    assert.equal(edited.json().draftRevision, draft.draft_revision + 1);

    const stale = await request('PUT', basePath, player.token, {
      draftRevision: draft.draft_revision,
      proposal: draft.proposed_document,
    });
    assert.equal(stale.statusCode, 409);
  });

  await t.test('a character changed after the import was opened blocks a silent overwrite', async () => {
    const draft = (await request('POST', importsPath(), player.token, {importer: 'lss', original: longStoryShort(), targetCharacterId: characterId})).json();
    assert.equal(draft.current.id, characterId);

    const racingDraft = (await request('POST', importsPath(), player.token, {importer: 'lss', original: longStoryShort(), targetCharacterId: characterId})).json();
    assert.equal(
      (await request('POST', `${importsPath()}/${racingDraft.id}/confirm`, player.token, {draftRevision: racingDraft.draft_revision})).statusCode,
      200,
    );

    const conflict = await request('POST', `${importsPath()}/${draft.id}/confirm`, player.token, {draftRevision: draft.draft_revision});
    assert.equal(conflict.statusCode, 409);
  });

  await t.test('an ordinary member without characters.manage cannot target another player\'s character', async () => {
    const bystander = await register('bystander_import');
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, owner.token)).json().code;
    assert.equal((await request('POST', '/campaigns/join', bystander.token, {code})).statusCode, 201);

    const draft = await request('POST', importsPath(), bystander.token, {importer: 'lss', original: longStoryShort(), targetCharacterId: characterId});
    assert.equal(draft.statusCode, 403, draft.body);
  });

  await t.test('a player with the owner\'s edit grant can re-import the character', async () => {
    const editor = await register('editor_import');
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, owner.token)).json().code;
    assert.equal((await request('POST', '/campaigns/join', editor.token, {code})).statusCode, 201);
    assert.equal((await request('POST', importsPath(), editor.token, {importer: 'lss', original: longStoryShort(), targetCharacterId: characterId})).statusCode, 403);

    const granted = await request('PUT', `/campaigns/${campaignId}/characters/${characterId}/access/${editor.user.id}`, player.token, {level: 'edit'});
    assert.equal(granted.statusCode, 200, granted.body);
    const draft = await request('POST', importsPath(), editor.token, {importer: 'lss', original: longStoryShort(), targetCharacterId: characterId});
    assert.equal(draft.statusCode, 201, draft.body);
    const confirmed = await request('POST', `${importsPath()}/${draft.json().id}/confirm`, editor.token, {draftRevision: draft.json().draft_revision});
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(confirmed.json().characterId, characterId);
  });

  await t.test('the campaign owner can target any character in the campaign', async () => {
    const draft = await request('POST', importsPath(), owner.token, {importer: 'lss', original: longStoryShort(), targetCharacterId: characterId});
    assert.equal(draft.statusCode, 201, draft.body);
  });

  await t.test('a manager with characters.manage can target another player\'s character', async () => {
    const manager = await register('manager_import');
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, owner.token)).json().code;
    await request('POST', '/campaigns/join', manager.token, {code});
    await request('PUT', `/campaigns/${campaignId}/members/${manager.user.id}/permissions`, owner.token, {isFullGm: false, permissions: ['characters.manage']});

    const draft = await request('POST', importsPath(), manager.token, {importer: 'lss', original: longStoryShort(), targetCharacterId: characterId});
    assert.equal(draft.statusCode, 201, draft.body);
  });

  await t.test('GET characters only returns the campaign to its members', async () => {
    assert.equal((await request('GET', `/campaigns/${campaignId}/characters`, outsider.token)).statusCode, 404);
    const own = await request('GET', `/campaigns/${campaignId}/characters`, player.token);
    assert.equal(own.statusCode, 200);
    assert.ok(own.json().characters.some((c: any) => c.id === characterId));
  });
  await t.test('a full Long Story Short sheet lands in real fields and tables, without duplicates on re-import', async () => {
    const rich = {
      edition: '2014', sheetEdition: '2014', spells: {prepared: ['lss-spell-1']},
      data: JSON.stringify({
        jsonType: 'character', name: {value: 'Мирра'}, proficiency: 3,
        stats: {str: {score: 10}, dex: {score: 18}, con: {score: 14}, int: {score: 16}, wis: {score: 12}, cha: {score: 8}},
        vitality: {'hp-current': {value: 30}, 'hp-max': {value: 32}, 'hp-temp': {value: 0}, ac: {value: 15}, speed: {value: 30}, 'hit-die': {value: 'd8'}},
        info: {charClass: {value: 'Плут'}, charSubclass: {value: 'Мистический ловкач'}, level: {value: 5}, experience: {value: 6500}},
        saves: {dex: {isProf: true}, int: {isProf: true}, str: {isProf: false}},
        skills: {stealth: {isProf: 2}, acrobatics: {isProf: 1}, 'sleight of hand': {isProf: 2}, arcana: {isProf: 0}},
        spellsInfo: {base: {code: 'int'}},
        spells: {'slots-1': {value: 3, filled: 1}, 'slots-2': {value: 0}},
        weaponsList: [
          {name: {value: 'Рапира'}, mod: {value: '+8'}, dmg: {value: '1к8+4'}, ability: 'dex', isProf: true, notes: {value: 'колющий'}},
          {name: {value: 'Короткий лук'}, mod: {value: '+7'}, dmg: {value: '1d6+4'}, ability: 'dex', isProf: true, notes: {value: 'колющий, 80/320'}},
        ],
        resources: {r1: {name: 'Удача', current: 1, max: 2}},
        text: {}, coins: {gp: {value: 15}}, conditions: [],
      }),
    };
    const draft = (await request('POST', importsPath(), player.token, {importer: 'lss', original: rich})).json();
    assert.ok(draft.warnings.some((warning: string) => warning.startsWith('Перенесётся в лист: класс «Плут (Мистический ловкач)», 5-й уровень')), JSON.stringify(draft.warnings));
    const confirmed = await request('POST', `${importsPath()}/${draft.id}/confirm`, player.token, {draftRevision: draft.draft_revision});
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    const id = confirmed.json().characterId;

    const row = (await pg.query<any>('SELECT class_name, level, experience, hit_die, spellcasting_ability, gp FROM characters WHERE id=$1', [id])).rows[0];
    assert.deepEqual(row, {class_name: 'Плут (Мистический ловкач)', level: 5, experience: 6500, hit_die: 8, spellcasting_ability: 'intelligence', gp: 15});
    const skills = (await pg.query<any>('SELECT skill_index, proficient, expertise FROM character_skills WHERE character_id=$1 ORDER BY skill_index', [id])).rows;
    assert.deepEqual(skills, [
      {skill_index: 'acrobatics', proficient: true, expertise: false},
      {skill_index: 'sleight-of-hand', proficient: true, expertise: true},
      {skill_index: 'stealth', proficient: true, expertise: true},
    ]);
    const saves = (await pg.query<any>('SELECT ability FROM character_saves WHERE character_id=$1 AND proficient ORDER BY ability', [id])).rows.map(save => save.ability);
    assert.deepEqual(saves, ['dexterity', 'intelligence']);
    const weapons = (await pg.query<any>('SELECT name, ability, damage_formula, damage_type, attack_bonus FROM character_weapons WHERE character_id=$1 ORDER BY name', [id])).rows;
    assert.deepEqual(weapons, [
      {name: 'Короткий лук', ability: 'dexterity', damage_formula: '1d6+4', damage_type: 'piercing', attack_bonus: 0},
      {name: 'Рапира', ability: 'dexterity', damage_formula: '1d8+4', damage_type: 'piercing', attack_bonus: 1},
    ], 'DEX +4, proficiency +3 — the rapier sheet total +8 keeps a +1 bonus');
    const slots = (await pg.query<any>('SELECT level, current, max FROM character_spell_slots WHERE character_id=$1 ORDER BY level', [id])).rows;
    assert.deepEqual(slots, [{level: 1, current: 2, max: 3}]);
    const resources = (await pg.query<any>('SELECT name, current, max FROM character_resources WHERE character_id=$1', [id])).rows;
    assert.deepEqual(resources, [{name: 'Удача', current: 1, max: 2}]);

    const again = (await request('POST', importsPath(), player.token, {importer: 'lss', original: rich, targetCharacterId: id})).json();
    const reconfirmed = await request('POST', `${importsPath()}/${again.id}/confirm`, player.token, {draftRevision: again.draft_revision});
    assert.equal(reconfirmed.statusCode, 200, reconfirmed.body);
    assert.equal(Number((await pg.query<any>('SELECT count(*) AS n FROM character_weapons WHERE character_id=$1', [id])).rows[0].n), 2);
    assert.equal(Number((await pg.query<any>('SELECT count(*) AS n FROM character_resources WHERE character_id=$1', [id])).rows[0].n), 1);
  });
});
