import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionParts, averageFormula, describeAction, describeTemplate, emptyAction, emptyEffect, emptyTemplate, isArtAsset, manualParts,
  normalizeTemplate, parseTemplateFormula, templateStrength, validateTemplate, type SpellTemplate,
} from './spell-template.ts';

function fireball(): SpellTemplate {
  const t = emptyTemplate();
  t.passport = { ...t.passport, name: 'Огненный шар', level: 3, school: 'evocation', classes: ['sorcerer', 'wizard'], element: 'fire' };
  t.casting = { ...t.casting, material: true, materialText: 'шарик гуано и серы', rangeValue: 150 };
  t.targeting = { ...t.targeting, kind: 'area', shape: 'sphere', sizeFeet: 20, origin: 'point', affects: 'all' };
  const blast = emptyAction('Взрыв');
  blast.who = 'area';
  blast.check = { ...blast.check, kind: 'save', ability: 'dexterity' };
  const damage = emptyEffect('damage');
  damage.values.formula = '8к6';
  damage.values.damageType = 'fire';
  blast.outcomes.fail = [damage];
  blast.successHalf = true;
  t.actions = [blast];
  t.scaling = [{ id: 's1', what: 'damage', per: 'slot', ref: damage.id, amount: '1к6', steps: [] }];
  return t;
}

test('formulas: dice in Russian or English, numbers and variables', () => {
  assert.deepEqual(parseTemplateFormula('8к6')?.map(term => [term.dice, term.sides]), [[8, 6]]);
  assert.equal(parseTemplateFormula('1d8 + @mod')?.length, 2);
  assert.equal(parseTemplateFormula('2к10+@круг-1')?.length, 3);
  assert.equal(parseTemplateFormula('к20')?.[0]?.dice, 1);
  for (const bad of ['', '8к', '@nonsense', '3 + + 2', 'огонь', '1к1']) assert.equal(parseTemplateFormula(bad), null, bad);
  assert.equal(averageFormula('8к6'), 28);
  assert.equal(averageFormula('1к8 + @mod'), 7.5);
});

test('normalize: junk is dropped, defaults are filled, numbers are clamped', () => {
  const t = normalizeTemplate({
    passport: { name: '  Звёздный дождь  ', level: 42, tags: ['damage', 'nope'] },
    targeting: { kind: 'area', sizeFeet: -5, shape: 'cube' },
    actions: [{ name: 'Удар', check: { kind: 'attack', attackCount: 99 }, outcomes: { hit: [{ kind: 'damage', values: { formula: '2к8', damageType: 'cold', extra: 'x' } }, { kind: 'teleport-to-moon' }] } }],
    unknownSection: true,
  });
  assert.equal(t.passport.name, 'Звёздный дождь');
  assert.equal(t.passport.level, 9);
  assert.deepEqual(t.passport.tags, ['damage']);
  assert.equal(t.targeting.sizeFeet, 5);
  assert.equal(t.actions[0]!.check.attackCount, 20);
  assert.equal(t.actions[0]!.outcomes.hit!.length, 1, 'unknown effect kinds are dropped');
  assert.equal(t.actions[0]!.outcomes.hit![0]!.values.extra, undefined);
  assert.equal(t.actions[0]!.outcomes.hit![0]!.values.magical, true, 'missing values come from the catalog');
  assert.deepEqual(normalizeTemplate(t), t, 'normalizing twice changes nothing');
});

test('validate: a correct Fireball passes, broken pieces are named', () => {
  assert.deepEqual(validateTemplate(fireball()).errors, []);
  const broken = fireball();
  broken.passport.name = '';
  broken.duration.concentration = true;
  broken.actions[0]!.outcomes.hit = [emptyEffect('heal')];
  (broken.actions[0]!.outcomes.fail![0]!.values as Record<string, unknown>).formula = '8 огней';
  const messages = validateTemplate(broken).errors.map(issue => `${issue.path}: ${issue.message}`).join('\n');
  assert.match(messages, /А1: Нет названия/);
  assert.match(messages, /Концентрация у мгновенного/);
  assert.match(messages, /Исход «попадание» не бывает/);
  assert.match(messages, /формула не разбирается/);
});

test('describe: the summary reads like the rule', () => {
  const lines = describeTemplate(fireball()).join('\n');
  assert.match(lines, /Огненный шар — 3 круг, воплощение/);
  assert.match(lines, /сфера 20 фт\., точка в дальности; задевает всех/);
  assert.match(lines, /спасбросок Ловкости против СЛ заклинаний\. провал: урон 8к6 огнём\. успех: половина урона/);
  assert.match(lines, /Усиление: урон 1к6 за каждый круг выше 3\./);
  assert.ok(!lines.includes('..'), lines);
});

test('strength: Fireball is strong for its level, a weak cantrip is weak, no damage — no meter', () => {
  const strong = templateStrength(fireball());
  assert.equal(strong.multi, true);
  assert.equal(strong.damage, 28);
  assert.equal(strong.band, 'strong', JSON.stringify(strong));
  const cantrip = fireball();
  cantrip.passport.level = 0;
  cantrip.targeting.kind = 'creatures';
  (cantrip.actions[0]!.outcomes.fail![0]!.values as Record<string, unknown>).formula = '1к4';
  assert.equal(templateStrength(cantrip).band, 'weak');
  const buff = emptyTemplate();
  assert.equal(templateStrength(buff).band, 'none');
});

test('manual parts: what the engine cannot do goes to the GM', () => {
  const t = fireball();
  const special = emptyEffect('special');
  special.values.text = 'Поджигает незакреплённые горючие предметы';
  t.actions[0]!.outcomes.fail!.push(special);
  assert.deepEqual(manualParts(t), ['«Взрыв»: особое — мастеру: «Поджигает незакреплённые горючие предметы»']);
});

test('picture (А9): a library path or an own asset id; anything else is dropped', () => {
  const art = (value: unknown) => normalizeTemplate({ passport: { name: 'x', art: value } }).passport.art;
  assert.equal(art('items/magic/fire/flame-orb'), 'items/magic/fire/flame-orb');
  assert.equal(art('0C2B1E5A-1111-4222-8333-944445555666'), '0c2b1e5a-1111-4222-8333-944445555666');
  assert.ok(isArtAsset(art('0c2b1e5a-1111-4222-8333-944445555666')));
  assert.ok(!isArtAsset(art('items/magic/fire/flame-orb')));
  for (const bad of ['../secret', 'https://example.com/x.png', 'items//x', 'Items/Upper', 42, null]) assert.equal(art(bad), '', String(bad));
});

test('action parts: the check, each outcome and its effects separately — the same text as one line', () => {
  const action = fireball().actions[0]!;
  const parts = actionParts(action);
  assert.equal(parts.check, 'спасбросок Ловкости против СЛ заклинаний');
  assert.deepEqual(parts.outcomes.map(entry => [entry.label, entry.effects]), [['провал', ['урон 8к6 огнём']]]);
  assert.equal(parts.half, true);
  assert.match(describeAction(action), /^«[^»]+» \(при сотворении; все в области\): спасбросок Ловкости против СЛ заклинаний\. провал: урон 8к6 огнём\. успех: половина урона\.$/);
});
