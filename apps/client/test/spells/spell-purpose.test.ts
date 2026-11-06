import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { castingUse, spellDamageTypes, spellPurposes } from '../../src/spells/spellPurpose.ts';

const raw = JSON.parse(readFileSync(new URL('../../../../packages/domain/srd/spells.json', import.meta.url), 'utf8'));
const spells: any[] = Array.isArray(raw) ? raw : raw.spells;
const of = (index: string) => {
  const spell = spells.find(entry => entry.index === index);
  assert.ok(spell, index);
  return { name: spell.name, desc: Array.isArray(spell.desc) ? spell.desc.join('\n') : spell.desc };
};

test('spell purposes from SRD descriptions', () => {
  const cases: Array<[string, string[]]> = [
    ['cure-wounds', ['heal']],
    ['healing-word', ['heal']],
    ['lesser-restoration', ['heal']],
    ['fireball', ['damage']],
    ['magic-missile', ['damage']],
    ['spiritual-weapon', ['damage']],
    ['hold-person', ['control']],
    ['sleep', ['control']],
    ['command', ['control']],
    ['web', ['control']],
    ['shield', ['protection']],
    ['mage-armor', ['protection']],
    ['sanctuary', ['protection']],
    ['counterspell', ['protection']],
    ['misty-step', ['movement']],
    ['dimension-door', ['movement']],
    ['longstrider', ['movement']],
    ['detect-magic', ['utility']],
    ['light', ['utility']],
    ['prestidigitation', ['utility']],
  ];
  for (const [index, expected] of cases) {
    const purposes = spellPurposes(of(index));
    for (const purpose of expected) assert.ok(purposes.includes(purpose as any), `${index}: ${purposes.join(', ')} should include ${purpose}`);
    if (expected[0] === 'utility') assert.deepEqual(purposes, ['utility'], index);
  }
  assert.deepEqual(spellPurposes(of('haste')).sort(), ['movement', 'protection']);
  for (const spell of spells) assert.ok(spellPurposes(of(spell.index)).length, spell.index);
});

test('damage types and casting use; Russian text and mechanics count too', () => {
  assert.deepEqual(spellDamageTypes(of('fireball')), ['fire']);
  assert.deepEqual(spellDamageTypes(of('ice-storm')).sort(), ['bludgeoning', 'cold']);
  assert.deepEqual(spellDamageTypes({ descRu: 'Цель получает 2к6 урона огнём.' }), ['fire']);
  assert.deepEqual(spellDamageTypes({ mechanics: { damageType: 'radiant' } }), ['radiant']);
  assert.deepEqual(spellPurposes({ descRu: 'Существо восстанавливает 2к8 хитов.' }), ['heal']);
  assert.deepEqual(spellPurposes({ desc: 'Something odd.', healingFormula: '1d8+@wis' }), ['heal']);
  assert.deepEqual(spellPurposes({ descRu: 'Цель должна преуспеть в спасброске Мудрости, иначе станет испуганной.' }), ['control']);
  assert.deepEqual(['1 action', '1 bonus action', '1 reaction, which you take when…', '10 minutes', '1 бонусное действие'].map(castingUse), ['action', 'bonus', 'reaction', 'long', 'bonus']);
});
