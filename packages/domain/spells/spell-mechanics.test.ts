import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cantripDiceMultiplier, deriveSpellMechanics, durationRounds, spellAttackBonus, spellSaveDc} from './spell-mechanics.ts';

const spells = JSON.parse(readFileSync(new URL('../srd/spells.json', import.meta.url), 'utf8')) as Array<{index: string; level: number; duration: string; desc: string; higherLevel: string | null}>;
const mechanics = (index: string) => {
  const spell = spells.find(entry => entry.index === index);
  assert.ok(spell, index);
  return deriveSpellMechanics(spell);
};

test('area saves with half damage: Fireball, Burning Hands, Thunderwave', () => {
  assert.deepEqual(
    [mechanics('fireball').save, mechanics('fireball').halfOnSave, mechanics('fireball').damageFormula, mechanics('fireball').damageType],
    ['dexterity', true, '8d6', 'fire'],
  );
  assert.equal(mechanics('burning-hands').damageFormula, '3d6');
  assert.equal(mechanics('fireball').upcastFormula, '1d6', '+1d6 per slot level above 3rd');
  assert.deepEqual([mechanics('thunderwave').save, mechanics('thunderwave').damageType, mechanics('thunderwave').halfOnSave], ['constitution', 'thunder', true]);
});

test('spell attacks: Fire Bolt and Ray of Frost are ranged, Shocking Grasp and Inflict Wounds are melee', () => {
  const fireBolt = mechanics('fire-bolt');
  assert.deepEqual([fireBolt.attack, fireBolt.save, fireBolt.damageFormula, fireBolt.damageType, fireBolt.cantripScaling], ['ranged', null, '1d10', 'fire', true]);
  assert.equal(mechanics('ray-of-frost').attack, 'ranged');
  assert.equal(mechanics('shocking-grasp').attack, 'melee');
  assert.deepEqual([mechanics('inflict-wounds').attack, mechanics('inflict-wounds').damageFormula, mechanics('inflict-wounds').cantripScaling], ['melee', '3d10', false]);
});

test('a save without half damage: Sacred Flame', () => {
  const flame = mechanics('sacred-flame');
  assert.deepEqual([flame.save, flame.halfOnSave, flame.damageType, flame.cantripScaling], ['dexterity', false, 'radiant', true]);
});

test('conditions, their duration and the repeat save: Hold Person, Entangle, Web, Blindness/Deafness', () => {
  const hold = mechanics('hold-person');
  assert.deepEqual([hold.save, hold.condition, hold.conditionRounds, hold.repeatSave, hold.damageFormula], ['wisdom', 'paralyzed', 10, 'end', null]);
  assert.deepEqual([mechanics('entangle').condition, mechanics('entangle').save, mechanics('entangle').repeatSave], ['restrained', 'strength', null]);
  assert.deepEqual([mechanics('web').condition, mechanics('web').save, mechanics('web').conditionRounds], ['restrained', 'dexterity', 600]);
  const blind = mechanics('blindness-deafness');
  assert.deepEqual([blind.condition, blind.save, blind.repeatSave], ['blinded', 'constitution', 'end']);
});

test('healing and flat damage: Cure Wounds adds the casting modifier, Magic Missile is 1d4+1 force', () => {
  const cure = mechanics('cure-wounds');
  assert.deepEqual([cure.healingFormula, cure.healingAddsModifier, cure.attack, cure.save], ['1d8', true, null, null]);
  assert.deepEqual([mechanics('magic-missile').damageFormula, mechanics('magic-missile').damageType], ['1d4+1', 'force']);
  assert.equal(mechanics('command').condition, null, 'Command has no game condition');
});

test('durations, cantrip tiers, spell DC and attack bonus', () => {
  assert.equal(durationRounds('Up to 1 minute'), 10);
  assert.equal(durationRounds('1 round'), 1);
  assert.equal(durationRounds('Instantaneous'), null);
  assert.equal(durationRounds('1 минута'), 10);
  assert.equal(durationRounds('10 раундов'), 10);
  assert.equal(durationRounds('1 час'), 600);
  assert.equal(durationRounds('1 день'), 1000, 'a day is capped like any long duration');
  assert.equal(durationRounds('Мгновенная'), null);
  assert.deepEqual([1, 4, 5, 10, 11, 17, 20].map(cantripDiceMultiplier), [1, 1, 2, 2, 3, 4, 4]);
  assert.equal(cantripDiceMultiplier(null), 1);
  assert.equal(spellSaveDc(2, 3), 13);
  assert.equal(spellAttackBonus(3, 4), 7);
});

test('overrides: null keeps the text, a value replaces it, none switches it off', async () => {
  const {mergeSpellMechanics} = await import('./spell-mechanics.ts');
  const derived = mechanics('hold-person');
  assert.deepEqual([mergeSpellMechanics(derived, null).condition, mergeSpellMechanics(derived, null).save], ['paralyzed', 'wisdom']);
  const changed = mergeSpellMechanics(derived, {condition_code: 'stunned', save_ability: 'none', condition_rounds: 3});
  assert.deepEqual([changed.condition, changed.save, changed.conditionRounds], ['stunned', null, 3]);
  assert.equal(mergeSpellMechanics(mechanics('cure-wounds'), {}).healingFormula, '1d8+@mod');
  const custom = mergeSpellMechanics(null, {attack_kind: 'ranged', damage_formula: '2d6', damage_type: 'cold'});
  assert.deepEqual([custom.attack, custom.damageFormula, custom.damageType, custom.save], ['ranged', '2d6', 'cold', null]);
});

test('spell range in feet: touch is 5, miles are 5280, self and sight are not checked', async () => {
  const {spellRangeFeet} = await import('./spell-mechanics.ts');
  assert.equal(spellRangeFeet('120 feet'), 120);
  assert.equal(spellRangeFeet('Touch'), 5);
  assert.equal(spellRangeFeet('Касание'), 5);
  assert.equal(spellRangeFeet('1 mile'), 5280);
  assert.equal(spellRangeFeet('Self (15-foot cone)'), null);
  assert.equal(spellRangeFeet('Sight'), null);
  assert.equal(spellRangeFeet('36 футов'), 36);
  assert.equal(spellRangeFeet(null), null);
});
