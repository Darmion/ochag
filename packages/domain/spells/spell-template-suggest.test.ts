import { test } from 'node:test';
import assert from 'node:assert/strict';
import spells from '../srd/spells.json' with { type: 'json' };
import ru from '../srd/spells.ru.json' with { type: 'json' };
import { applySuggestion, describeTemplate, emptyTemplate, validateTemplate, type Action, type SpellTemplate, type Suggestion } from './spell-template.ts';
import { suggestTemplate } from './spell-template-suggest.ts';

const list = (Array.isArray(spells) ? spells : (spells as any).spells) as any[];
const srd = (index: string) => list.find(spell => spell.index === index)!;
const russian = (index: string) => ((ru as any)[index] ?? (ru as any).spells?.[index]) as { desc: string; higherLevel?: string };

function english(index: string): Suggestion[] {
  const spell = srd(index);
  return suggestTemplate({ description: spell.desc, higherLevel: spell.higherLevel, level: spell.level, range: spell.range, duration: spell.duration });
}
function inRussian(index: string): Suggestion[] {
  const spell = srd(index);
  const text = russian(index);
  return suggestTemplate({ description: text.desc, higherLevel: text.higherLevel ?? '', level: spell.level });
}
const value = (suggestions: Suggestion[], path: string) => suggestions.find(entry => entry.path === path)?.value;
const action = (suggestions: Suggestion[]) => value(suggestions, 'actions[+]') as Action;

function accepted(suggestions: Suggestion[], level: number): SpellTemplate {
  let t = emptyTemplate();
  t.passport.name = 'Проба';
  t.passport.level = level;
  for (const suggestion of suggestions) t = applySuggestion(t, suggestion);
  return t;
}

for (const [language, make] of [['English', english], ['Russian', inRussian]] as const) {
  test(`${language}: Fireball — a 20-ft sphere, DEX save, 8d6 fire, half on success, +1d6 per slot`, () => {
    const s = make('fireball');
    assert.equal(value(s, 'targeting.kind'), 'area');
    assert.equal(value(s, 'targeting.shape'), 'sphere');
    assert.equal(value(s, 'targeting.sizeFeet'), 20);
    const blast = action(s);
    assert.equal(blast.who, 'area');
    assert.deepEqual([blast.check.kind, blast.check.ability, blast.successHalf], ['save', 'dexterity', true]);
    assert.deepEqual(blast.outcomes.fail?.map(entry => [entry.kind, entry.values.formula, entry.values.damageType]), [['damage', '8к6', 'fire']]);
    const scaling = value(s, 'scaling[+]') as any;
    assert.deepEqual([scaling.what, scaling.amount, scaling.per], ['damage', '1к6', 'slot']);
    assert.ok(s.every(entry => entry.phrase.length > 0), 'every suggestion says where it came from');
    const t = accepted(s, 3);
    assert.deepEqual(validateTemplate(t).errors, [], describeTemplate(t).join('\n'));
  });

  test(`${language}: Hold Person — humanoid, WIS save, paralyzed with a save at the end of each turn, +1 humanoid per slot`, () => {
    const s = make('hold-person');
    const hold = action(s);
    assert.deepEqual([hold.check.kind, hold.check.ability], ['save', 'wisdom']);
    assert.deepEqual(hold.outcomes.fail?.map(entry => [entry.values.code, entry.values.repeatSave]), [['paralyzed', 'end']]);
    assert.deepEqual(value(s, 'targeting.types'), ['humanoid']);
    assert.ok(s.some(entry => entry.path === 'scaling[+]' && (entry.value as any).what === 'targets'), JSON.stringify(s.map(entry => entry.display)));
  });

  test(`${language}: Moonbeam — the save sits inside a zone, for whoever enters or starts there`, () => {
    const s = make('moonbeam');
    assert.equal(value(s, 'targeting.shape'), 'cylinder');
    assert.equal(value(s, 'targeting.heightFeet'), 40);
    const holder = action(s);
    const zone = holder.outcomes.always?.[0];
    assert.equal(zone?.kind, 'zone');
    const inner = zone!.actions[0]!;
    assert.deepEqual([inner.when, inner.who, inner.check.ability], ['zone-enter-or-start', 'entering', 'constitution']);
    assert.equal(inner.outcomes.fail?.[0]?.values.damageType, 'radiant');
  });

  test(`${language}: Magic Missile — three darts, one more per slot`, () => {
    const s = make('magic-missile');
    assert.equal(action(s).check.attackCount, 3);
    assert.ok(s.some(entry => entry.path === 'scaling[+]' && (entry.value as any).what === 'projectiles'));
  });

  test(`${language}: Cure Wounds — 1d8 + modifier, not undead, +1d8 per slot`, () => {
    const s = make('cure-wounds');
    const heal = action(s).outcomes.always?.find(entry => entry.kind === 'heal');
    assert.equal(heal?.values.formula, '1к8 + @mod');
    assert.equal(heal?.values.notUndead, true);
    assert.equal((value(s, 'scaling[+]') as any)?.what, 'healing');
  });

  test(`${language}: Fire Bolt — a ranged spell attack whose damage grows with the character level`, () => {
    const s = make('fire-bolt');
    assert.deepEqual([action(s).check.kind, action(s).check.attackRange], ['attack', 'ranged']);
    assert.equal((value(s, 'scaling[+]') as any)?.per, 'cantrip');
  });
}

test('English: Ray of Frost slows until the start of your next turn — speed −10 with a short term', () => {
  const s = english('ray-of-frost');
  const slow = action(s).outcomes.hit?.find(entry => entry.kind === 'speed');
  assert.deepEqual([slow?.values.mode, slow?.values.feet, slow?.values.lasts], ['minus', 10, 'caster-next-start']);
});

test('Haste: the advantage on DEX saves is not a saving throw the target makes', () => {
  const s = english('haste');
  const haste = action(s);
  assert.equal(haste.check.kind, 'none');
  assert.equal(haste.outcomes.always?.[0]?.values.preset, 'haste');
});

test('SRD fields become suggestions too (for the migration): time, range, duration, components', () => {
  const spell = srd('fireball');
  const s = suggestTemplate({ description: spell.desc, castingTime: spell.castingTime, range: spell.range, duration: spell.duration, components: spell.components, material: spell.material, concentration: spell.concentration, ritual: spell.ritual, level: spell.level });
  assert.equal(value(s, 'casting.time'), 'action');
  assert.equal(value(s, 'casting.rangeValue'), 150);
  assert.equal(value(s, 'duration.kind'), 'instant');
  assert.equal(value(s, 'casting.material'), true);
});

test('an empty description gives nothing; a homebrew line still gives the obvious', () => {
  assert.deepEqual(suggestTemplate({ description: '' }), []);
  const s = suggestTemplate({ description: 'Совершите рукопашную атаку заклинанием по существу. При попадании цель получает 3к8 урона холодом, а её скорость уменьшается на 10 футов до начала вашего следующего хода.', level: 1 });
  const strike = action(s);
  assert.deepEqual([strike.check.kind, strike.check.attackRange], ['attack', 'melee']);
  assert.deepEqual(strike.outcomes.hit?.map(entry => entry.kind), ['damage', 'speed']);
  assert.equal(strike.outcomes.hit?.[0]?.values.damageType, 'cold');
});

test('homebrew upcast in own words: «за каждый круг ячейки выше первого», «выше 1»; no double period in the line', () => {
  const description = 'Совершите дальнобойную атаку заклинанием по цели. При попадании цель получает 3к8 урона холодом, и её скорость уменьшается на 10 футов до начала вашего следующего хода.';
  for (const higherLevel of ['Урон увеличивается на 1к8 за каждый круг ячейки выше первого.', 'Урон увеличивается на 1к8 за каждый круг выше 1.']) {
    const s = suggestTemplate({ description, higherLevel, level: 1 });
    const rule = s.find(entry => entry.path === 'scaling[+]')?.value as { what: string; amount: string; per: string } | undefined;
    assert.deepEqual(rule && [rule.what, rule.amount, rule.per], ['damage', '1к8', 'slot'], higherLevel);
    const line = s.find(entry => entry.path === 'actions[+]')!.display;
    assert.ok(line.startsWith('«Атака»'), line);
    assert.ok(!line.includes('..'), line);
  }
});
