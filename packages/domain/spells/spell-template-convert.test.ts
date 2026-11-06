import { test } from 'node:test';
import assert from 'node:assert/strict';
import spells from '../srd/spells.json' with { type: 'json' };
import ru from '../srd/spells.ru.json' with { type: 'json' };
import file from '../srd/spell-templates.json' with { type: 'json' };
import { allEffects, primaryOutcome, validateTemplate, type SpellTemplate } from './spell-template.ts';
import { compactTemplate, legacySpellTemplate, srdSpellTemplate, type SrdSpellSource } from './spell-template-convert.ts';
import { templateCastPlan } from './spell-template-engine.ts';
import { srdTemplateOf } from './srd-spell-templates.ts';
import { deriveSpellMechanics } from './spell-mechanics.ts';

const list = (Array.isArray(spells) ? spells : (spells as { spells: SrdSpellSource[] }).spells) as SrdSpellSource[];
const russian = ru as Record<string, { name?: string; desc?: string; higherLevel?: string }>;
const stored = file as Record<string, Record<string, unknown>>;
const convert = (index: string) => srdSpellTemplate(list.find(spell => spell.index === index)!, russian[index]);
const effectsOf = (t: SpellTemplate) => allEffects(t).map(({ effect }) => effect);

test('all 319 SRD spells: a template without validation errors, marked «auto — review»', () => {
  assert.equal(list.length, 319);
  for (const spell of list) {
    const t = convert(spell.index);
    assert.deepEqual(validateTemplate(t).errors, [], spell.index);
    assert.deepEqual(t.origin, { srd: spell.index, reviewed: false });
    assert.ok(t.actions.length, `${spell.index}: at least one action`);
  }
});

test('the templates file matches the converter (run npm run srd:spell-templates after changing it)', () => {
  assert.equal(Object.keys(stored).length, list.length);
  for (const spell of list) {
    const compact = compactTemplate(convert(spell.index));
    const passport = { ...(compact.passport as Record<string, unknown> | undefined) };
    for (const key of ['name', 'nameEn', 'description', 'higherLevel']) delete passport[key];
    const { passport: _passport, ...rest } = compact;
    assert.deepEqual(stored[spell.index], Object.keys(passport).length ? { passport, ...rest } : rest, spell.index);
  }
});

test('a stored template comes back whole: the loader adds the texts, the defaults return', () => {
  for (const spell of list) assert.deepEqual(srdTemplateOf(spell.index), convert(spell.index), spell.index);
  assert.equal(srdTemplateOf('no-such-spell'), null);
});

test('the plan of the template does what the text parser did (attack, save, damage, healing, condition)', () => {
  for (const spell of list) {
    if (effectsOf(convert(spell.index)).some(effect => effect.kind === 'preset')) continue;
    const plan = templateCastPlan(convert(spell.index), { slotLevel: Math.max(1, spell.level), characterLevel: 5, mode: null });
    const legacy = deriveSpellMechanics(spell as never) as Record<string, unknown>;
    const m = plan.mechanics as unknown as Record<string, unknown>;
    assert.equal(m.attack ?? null, legacy.attack ?? null, `${spell.index}: attack`);
    assert.equal(m.save ?? null, legacy.save ?? null, `${spell.index}: save`);
    assert.equal(m.damageType ?? null, legacy.damageType ?? null, `${spell.index}: damage type`);
    assert.equal(Boolean(m.damageFormula), Boolean(legacy.damageFormula), `${spell.index}: damage`);
    assert.equal(Boolean(m.healingFormula), Boolean(legacy.healingFormula), `${spell.index}: healing`);
    if (legacy.condition) assert.ok(m.condition === legacy.condition || plan.conditions.some(entry => entry.code === legacy.condition), `${spell.index}: condition`);
  }
});

test('the server’s special cases become effects: presets, senses, AC, teleport, summon, shape', () => {
  const kinds = (index: string) => effectsOf(convert(index)).map(effect => effect.kind);
  const values = (index: string, kind: string) => effectsOf(convert(index)).find(effect => effect.kind === kind)?.values;
  assert.equal(values('haste', 'preset')?.preset, 'haste');
  assert.equal(values('sanctuary', 'preset')?.preset, 'sanctuary');
  assert.deepEqual([values('barkskin', 'ac')?.mode, values('barkskin', 'ac')?.value], ['floor', 16]);
  assert.deepEqual([values('true-seeing', 'senses')?.sense, values('true-seeing', 'senses')?.feet], ['truesight', 120]);
  assert.deepEqual([values('misty-step', 'move')?.mode, values('misty-step', 'move')?.feet], ['teleport', 30]);
  assert.equal(values('invisibility', 'invisible')?.breaks, 'attack-or-spell');
  assert.ok(kinds('find-familiar').includes('summon'));
  assert.ok(kinds('polymorph').includes('shape'));
  const ward = convert('protection-from-energy');
  assert.deepEqual(ward.options.params.map(param => param.kind), ['damage-type']);
  const fireball = convert('fireball');
  const main = fireball.actions[0]!;
  assert.deepEqual([fireball.targeting.kind, fireball.targeting.shape, fireball.targeting.sizeFeet], ['area', 'sphere', 20]);
  assert.deepEqual([main.check.kind, main.check.ability, main.successHalf], ['save', 'dexterity', true]);
  assert.deepEqual(main.outcomes[primaryOutcome(main)]?.map(effect => [effect.kind, effect.values.formula, effect.values.damageType]), [['damage', '8к6', 'fire']]);
  assert.deepEqual(fireball.scaling.map(rule => [rule.what, rule.amount, rule.per]), [['damage', '1к6', 'slot']]);
  assert.equal(fireball.passport.name, 'Огненный шар');
  const clone = convert('clone');
  assert.ok(effectsOf(clone).some(effect => effect.kind === 'special' && String(effect.values.text).length > 20));
  assert.equal(convert('sanctuary').actions[0]!.check.kind, 'none');
  assert.equal(convert('hypnotic-pattern').actions[0]!.check.kind, 'save');
});

test('a campaign spell without a table: its flat fields become a template', () => {
  const zone = legacySpellTemplate({
    name: 'Огненное поле', level: 3, school: 'Evocation', desc: 'Земля горит.', castingTime: '1 действие', range: '120 футов', duration: 'Концентрация, до 1 минуты', concentration: true,
    saveAbility: 'dexterity', halfOnSave: true, damageFormula: '3d6', damageType: 'fire', upcastFormula: '1d6', createsZone: true,
  });
  assert.deepEqual(validateTemplate(zone).errors, []);
  const holder = zone.actions[0]!;
  const inner = holder.outcomes.always![0]!.actions[0]!;
  assert.equal(holder.outcomes.always![0]!.kind, 'zone');
  assert.deepEqual([inner.when, inner.check.kind, inner.check.ability, inner.successHalf], ['zone-enter-or-start', 'save', 'dexterity', true]);
  assert.deepEqual(inner.outcomes.fail?.map(effect => [effect.values.formula, effect.values.damageType]), [['3к6', 'fire']]);
  assert.deepEqual(zone.scaling.map(rule => [rule.what, rule.amount]), [['damage', '1к6']]);
  assert.equal(zone.duration.concentration, true);
  const plan = templateCastPlan(zone, { slotLevel: 3, characterLevel: 5, mode: null });
  assert.equal(plan.mechanics.createsZone, true);
  assert.equal(plan.mechanics.save, 'dexterity');

  const bolt = legacySpellTemplate({ name: 'Стрела', level: 1, school: 'Evocation', attackKind: 'ranged', damageFormula: '2d8', damageType: 'cold', conditionCode: 'restrained', conditionRounds: 1 });
  const strike = bolt.actions[0]!;
  assert.deepEqual([strike.check.kind, strike.check.attackRange], ['attack', 'ranged']);
  assert.deepEqual(strike.outcomes.hit?.map(effect => effect.kind), ['damage', 'condition']);
  const flavour = legacySpellTemplate({ name: 'Фокус', level: 0, school: 'Illusion', desc: 'Искры из пальцев.' });
  assert.deepEqual([flavour.actions.length, flavour.passport.description], [0, 'Искры из пальцев.']);
});
