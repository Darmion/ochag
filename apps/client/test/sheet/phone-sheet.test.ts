import assert from 'node:assert/strict';
import { test } from 'node:test';

import { abilityForSkill, abilityModifier, describeRoll, formatSigned, proficiencyForLevel, saveTotalFor, skillTotalFor } from '../../src/phone/sheet.ts';

test('proficiency grows every four levels, modifiers follow the PHB table', () => {
  assert.deepEqual([1, 4, 5, 8, 9, 13, 17, 20].map(proficiencyForLevel), [2, 2, 3, 3, 4, 5, 6, 6]);
  assert.deepEqual([3, 9, 10, 15, 18].map(abilityModifier), [-4, -1, 0, 2, 4]);
  assert.deepEqual([-2, 0, 4].map(formatSigned), ['-2', '+0', '+4']);
});

test('skill codes from the SRD map to sheet fields, unknown codes fall back to dexterity', () => {
  assert.equal(abilityForSkill('wis'), 'wisdom');
  assert.equal(abilityForSkill('str'), 'strength');
  assert.equal(abilityForSkill('???'), 'dexterity');
});

test('skill totals add proficiency once, or twice with expertise', () => {
  const skill = (proficient: boolean, expertise: boolean) => ({ index: 'stealth', proficient, expertise });
  assert.equal(skillTotalFor(skill(false, false), 14, 3), 2);
  assert.equal(skillTotalFor(skill(true, false), 14, 3), 5);
  assert.equal(skillTotalFor(skill(true, true), 14, 3), 8);
});

test('save totals: hidden or unknown saves have no total, a custom bonus is added', () => {
  const save = (hidden: boolean, proficient: boolean | null, customBonus: number | null) => ({ ability: 'wisdom', hidden, proficient, customBonus });
  assert.equal(saveTotalFor(save(true, true, null), 16, 2), null);
  assert.equal(saveTotalFor(save(false, null, null), 16, 2), null);
  assert.equal(saveTotalFor(save(false, false, null), 16, 2), 3);
  assert.equal(saveTotalFor(save(false, true, 1), 16, 2), 6);
});

test('a roll reads as label, total, outcome and damage', () => {
  assert.equal(describeRoll({ total: 14 }), 'Бросок: 14');
  assert.equal(describeRoll({ label: 'Ловкость', total: -1 }), 'Ловкость: -1');
  assert.equal(describeRoll({ label: 'Атака', total: 17, outcome: { target: 'x', hit: true }, damage: { roll: { total: 7 } } }), 'Атака: 17 — попадание — урон 7');
  assert.equal(describeRoll({ label: 'Атака', total: 9, outcome: { target: 'x', hit: false } }), 'Атака: 9 — промах');
  assert.equal(describeRoll({ label: 'Атака', total: 25, outcome: { target: 'x', critical: true, hit: true }, damage: { applied: 12 } }), 'Атака: 25 — КРИТ! — урон 12');
});
