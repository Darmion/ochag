import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseLss} from './lss/parse.ts';
import {spellLinks} from './lss/spells.ts';
import {validateProposal, type ValidatedProposal} from '../../packages/importer/proposal.ts';

function sheet(overrides: Record<string, any> = {}) {
  return {
    jsonType: 'character',
    name: {value: 'Liena'},
    stats: {
      str: {score: 16}, dex: {score: 14}, con: {score: 12},
      int: {score: 10}, wis: {score: 8}, cha: {score: 13},
    },
    vitality: {
      'hp-current': {value: 20}, 'hp-max': {value: 24}, 'hp-temp': {value: 3},
      ac: {value: 15}, speed: {value: 35}, darkvision: {value: 60},
    },
    info: {race: 'Elf'}, subInfo: {alignment: 'NG'}, proficiency: 2,
    saves: {str: true}, skills: {stealth: 2},
    spellsInfo: {ability: 'wis'}, spells: {slots: [1, 1]},
    weaponsList: [{name: 'Dagger'}],
    text: {backstory: '...'}, coins: {gp: 10}, resources: {},
    conditions: [],
    ...overrides,
  };
}

function original(sheetOverrides: Record<string, any> = {}, outerOverrides: Record<string, any> = {}) {
  return {
    edition: '2014', sheetEdition: '2014',
    data: JSON.stringify(sheet(sheetOverrides)),
    spells: {prepared: []},
    ...outerOverrides,
  };
}

test('parses a well-formed sheet into a proposal and mapping', () => {
  const {proposal, mapping, warnings} = parseLss(original());
  assert.equal(proposal.name, 'Liena');
  assert.equal(proposal.strength, 16);
  assert.equal(proposal.dexterity, 14);
  assert.equal(proposal.hp_current, 20);
  assert.equal(proposal.hp_max, 24);
  assert.equal(proposal.hp_temp, 3);
  assert.equal(proposal.armor_class, 15);
  assert.equal(proposal.speed_feet, 35);
  assert.equal(mapping.find(row => row.key === 'speed_feet')?.sourcePath, 'vitality.speed.value');
  assert.ok(!warnings.some(w => w.includes('Временные хиты')));
});

test('accepts data already provided as an object instead of a JSON string', () => {
  const {proposal} = parseLss({edition: '2014', sheetEdition: '2014', data: sheet(), spells: {}});
  assert.equal(proposal.name, 'Liena');
});

test('rejects a data field containing invalid JSON', () => {
  assert.throws(
    () => parseLss({data: '{not json'}),
    /некорректный JSON/,
  );
});

test('rejects a document that is not a Long Story Short character sheet', () => {
  assert.throws(() => parseLss({data: JSON.stringify({jsonType: 'character', stats: {}})}), /не похож на лист персонажа/);
  assert.throws(() => parseLss({data: JSON.stringify({jsonType: 'monster', stats: {str: {score: 10}}})}), /не похож на лист персонажа/);
});

test('missing temporary HP defaults to 0 with a warning', () => {
  const {proposal, warnings} = parseLss(original({vitality: {
    'hp-current': {value: 20}, 'hp-max': {value: 24},
    ac: {value: 15}, speed: {value: 35},
  }}));
  assert.equal(proposal.hp_temp, 0);
  assert.ok(warnings.some(w => w.includes('Временные хиты')));
});

test('a sheet without any speed (the 2024 template) gets 30 feet with a warning', () => {
  const {proposal, warnings} = parseLss(original({vitality: {
    'hp-current': {value: 39}, 'hp-max': {value: 39}, 'hp-temp': {}, ac: {value: 15},
  }}));
  assert.equal(proposal.speed_feet, 30);
  assert.ok(warnings.some(w => w.startsWith('Скорость в листе не указана')));
});

test('numeric strings with a comma decimal separator are parsed', () => {
  const {proposal} = parseLss(original({vitality: {
    'hp-current': {value: '20'}, 'hp-max': {value: '24'}, 'hp-temp': {value: 0},
    ac: {value: 15}, speed: {value: '7,5'},
  }}));
  assert.equal(proposal.speed_feet, 7.5);
  assert.equal(proposal.hp_current, 20);
});

test('a missing or non-string name becomes an empty string, not null', () => {
  const {proposal} = parseLss(original({name: {value: 42}}));
  assert.equal(proposal.name, '');
});

test('edition warning appears when the sheet reports the 2024 rules or mismatched editions', () => {
  assert.ok(parseLss(original({}, {edition: '2024', sheetEdition: '2024'})).warnings.some(w => w.includes('редакцию')));
  assert.ok(parseLss(original({}, {edition: '2014', sheetEdition: '2024'})).warnings.some(w => w.includes('редакцию')));
  assert.ok(!parseLss(original({}, {edition: '2014', sheetEdition: '2014'})).warnings.some(w => w.includes('редакцию')));
});

test('LSS spell numbers go into the structure to be matched in the campaign; junk ids are dropped', () => {
  const ids = ['65d3c172f3d820fa1add4871', '65d3c16af3d820fa1add439a'];
  const withSpells = parseLss(original({}, {spells: {prepared: [...ids, 'spell-1'], book: [ids[1]], slotless: ['x']}}));
  assert.ok(withSpells.warnings.some(w => w.includes('внутренними номерами')));
  const structure = (withSpells.proposal.sheet_extra as any).importedStructure;
  assert.deepEqual(structure.lssSpells, {prepared: ids, book: [ids[1]], granted: [], slotless: []});
  const withoutSpells = parseLss(original({}, {spells: {prepared: []}}));
  assert.ok(!withoutSpells.warnings.some(w => w.includes('внутренними номерами')));
});

test('spells named by dnd.su links: old HTML template and new editor documents', () => {
  assert.deepEqual(spellLinks('<p><a href=https://dnd.su/spells/332-resistance/>Сопротивление [Resistance]</a></p>', 0), [
    {slug: 'resistance', nameRu: 'Сопротивление', nameEn: 'Resistance', level: 0},
  ]);
  const doc = {type: 'doc', content: [{type: 'paragraph', content: [
    {type: 'text', text: 'Мистический заряд', marks: [{type: 'link', attrs: {href: 'https://dnd.su/spells/168-eldritch_blast/'}}]},
    {type: 'text', text: 'списков', marks: [{type: 'link', attrs: {href: 'https://dnd.su/spells/?search=&level=0'}}]},
  ]}]};
  assert.deepEqual(spellLinks(doc, null), [{slug: 'eldritch_blast', nameRu: 'Мистический заряд', nameEn: null, level: null}]);
});

test('pact slots, sheet DC and attack bonus are read from spellsPact and spellsInfo', () => {
  const {proposal, warnings} = parseLss(original({
    spellsInfo: {base: {code: 'cha'}, save: {value: '15'}, mod: {value: '+7'}},
    spellsPact: {'slots-2': {value: 0}, 'slots-3': {value: 2, filled: 1}},
  }));
  const structure = (proposal.sheet_extra as any).importedStructure;
  assert.deepEqual([structure.pactSlots, structure.spellSaveDc, structure.spellAttack], [{level: 3, max: 2, current: 1}, 15, 7]);
  assert.ok(warnings.some(w => w.includes('ячейки договора 3 ур. ×2') && w.includes('СЛ заклинаний 15, атака заклинанием +7')));
});

test('darkvision is preserved under the feet-named key without unit conversion', () => {
  const {proposal} = parseLss(original({vitality: {
    'hp-current': {value: 20}, 'hp-max': {value: 24}, 'hp-temp': {value: 0},
    ac: {value: 15}, speed: {value: 35}, darkvision: {value: 0},
  }}));
  assert.equal(proposal.sheet_extra.darkvisionFeet, 0);
  assert.equal(proposal.sheet_extra.darkvisionMeters, undefined);
});

test('validateProposal accepts a well-formed proposal', () => {
  const {proposal} = parseLss(original());
  assert.doesNotThrow(() => validateProposal(proposal));
});

test('validateProposal rejects unknown fields', () => {
  const {proposal} = parseLss(original());
  assert.throws(() => validateProposal({...proposal, extraField: 1}), /Неизвестное поле/);
});

test('validateProposal rejects a missing, blank or too-long name', () => {
  const {proposal} = parseLss(original());
  assert.throws(() => validateProposal({...proposal, name: ''}), /Имя должно содержать/);
  assert.throws(() => validateProposal({...proposal, name: '   '}), /Имя должно содержать/);
  assert.throws(() => validateProposal({...proposal, name: 'x'.repeat(201)}), /Имя должно содержать/);
});

test('validateProposal requires finite numbers for numeric fields', () => {
  const {proposal} = parseLss(original());
  assert.throws(() => validateProposal({...proposal, strength: null}), /Заполните числовое поле/);
  assert.throws(() => validateProposal({...proposal, strength: NaN}), /Заполните числовое поле/);
});

test('validateProposal requires whole numbers except for speed_feet', () => {
  const {proposal} = parseLss(original());
  assert.throws(() => validateProposal({...proposal, strength: 10.5}), /целым числом/);
  assert.doesNotThrow(() => validateProposal({...proposal, speed_feet: 32.5} as unknown as ValidatedProposal));
});

test('validateProposal rejects negative values except for armor_class', () => {
  const {proposal} = parseLss(original());
  assert.throws(() => validateProposal({...proposal, strength: -1}), /не может быть отрицательным/);
  assert.doesNotThrow(() => validateProposal({...proposal, armor_class: -2} as unknown as ValidatedProposal));
});

test('validateProposal requires sheet_extra to be a plain JSON object', () => {
  const {proposal} = parseLss(original());
  assert.throws(() => validateProposal({...proposal, sheet_extra: null}), /JSON-объектом/);
  assert.throws(() => validateProposal({...proposal, sheet_extra: []}), /JSON-объектом/);
  assert.throws(() => validateProposal({...proposal, sheet_extra: 'x'}), /JSON-объектом/);
});

test('real LSS weapons: the to-hit is ability + proficiency + modBonus, damage keeps the formula, missing ability is guessed', () => {
  const weaponsList = [
    {name: {value: 'Атака Рапирой'}, mod: {value: '+0'}, dmg: {value: '1к8+3/колющий'}, ability: 'dex', isProf: true},
    {name: {value: 'Копьё'}, mod: {value: '+0'}, dmg: {value: '1к6 / колящий'}, modBonus: {value: 1}, isProf: true},
    {name: {value: 'Арбалет (лёгкий)'}, mod: {value: '+0'}, dmg: {value: '1к6'}, modBonus: {value: 0}},
    {name: {value: 'Длинный меч'}, dmg: {value: '1к8+[STR]'}, ability: 'str', isProf: true, dmgType: {value: 'рубящий'}},
    {name: {value: 'Кинжал'}, mod: {value: '+0'}, dmg: {value: '1d4+@mod'}},
    {name: {value: 'Посох +1'}, mod: {value: '+6'}, dmg: {value: '1d6+3'}, ability: 'str', isProf: true},
  ];
  const {proposal} = parseLss(original({stats: {str: {score: 16}, dex: {score: 14}, con: {score: 12}, int: {score: 10}, wis: {score: 8}, cha: {score: 13}}, proficiency: 2, weaponsList}));
  const weapons = (proposal.sheet_extra as any).importedStructure.weapons;
  assert.deepEqual(weapons.map((w: any) => [w.name, w.ability, w.proficient, w.attackBonus, w.damageFormula, w.damageType]), [
    ['Атака Рапирой', 'dexterity', true, 0, '1d8+3', 'piercing'],
    ['Копьё', 'strength', true, 1, '1d6', 'piercing'],
    ['Арбалет (лёгкий)', 'dexterity', true, 0, '1d6', null],
    ['Длинный меч', 'strength', true, 0, '1d8+@mod', 'slashing'],
    ['Кинжал', 'finesse', true, 0, '1d4+@mod', null],
    ['Посох +1', 'strength', true, 1, '1d6+3', null],
  ]);
});
