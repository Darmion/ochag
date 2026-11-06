import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  FLAG_GREAT_WEAPON, attackActionFlags, bonusAttackBasis, bonusAttackRefusal, type EconomyWeapon,
} from './attack-economy.ts';

const dagger: EconomyWeapon = {id: 'd', name: 'Кинжал', srd_index: 'dagger', weapon_kind: 'melee', properties: ['finesse', 'light', 'thrown']};
const shortsword: EconomyWeapon = {id: 's', name: 'Короткий меч', srd_index: 'shortsword', weapon_kind: 'melee', properties: ['finesse', 'light']};
const longsword: EconomyWeapon = {id: 'l', name: 'Длинный меч', srd_index: 'longsword', weapon_kind: 'melee', properties: ['versatile']};
const glaive: EconomyWeapon = {id: 'g', name: 'Глефа', srd_index: 'glaive', weapon_kind: 'melee', properties: ['heavy', 'reach', 'two-handed']};
const handCrossbow: EconomyWeapon = {id: 'h', name: 'Ручной арбалет', srd_index: 'crossbow-hand', weapon_kind: 'ranged', properties: ['ammunition', 'light', 'loading']};
const greatsword: EconomyWeapon = {id: 'G', name: 'Двуручный меч', srd_index: 'greatsword', weapon_kind: 'melee', properties: ['heavy', 'two-handed']};
const fist: EconomyWeapon = {id: 'f', name: 'Безоружный удар', weapon_kind: 'melee', properties: []};
const noFeats = (_id: string) => false;
const feats = (...ids: string[]) => (id: string) => ids.includes(id);

test('two-weapon fighting: after an Attack-action hit with a light weapon — a different light weapon', () => {
  const flags = attackActionFlags(dagger, {monk: false});
  assert.equal(bonusAttackBasis(shortsword, {flags, hasFeat: noFeats, monk: false}), 'two-weapon');
  assert.equal(bonusAttackBasis(dagger, {flags, hasFeat: noFeats, monk: false}), null, 'not the same weapon');
  assert.equal(bonusAttackBasis(longsword, {flags, hasFeat: noFeats, monk: false}), null, 'not a non-light one');
  assert.equal(bonusAttackBasis(shortsword, {flags: attackActionFlags(longsword, {monk: false}), hasFeat: noFeats, monk: false}), null, 'the first attack must be light too');
  assert.equal(bonusAttackBasis(shortsword, {flags: [], hasFeat: noFeats, monk: false}), null, 'no Attack action yet');
  assert.match(bonusAttackRefusal(longsword, {flags, hasFeat: noFeats, monk: false}), /«Длинный меч» бонусным действием не ударить/);
  assert.match(bonusAttackRefusal(shortsword, {flags: [], hasFeat: noFeats, monk: false}), /сначала действие «Атака» другим лёгким/);
});

test('feats and monks: polearm butt, hand crossbow, martial arts, great weapon master', () => {
  assert.equal(bonusAttackBasis(glaive, {flags: attackActionFlags(glaive, {monk: false}), hasFeat: feats('polearm-master'), monk: false}), 'polearm');
  assert.equal(bonusAttackBasis(glaive, {flags: attackActionFlags(glaive, {monk: false}), hasFeat: noFeats, monk: false}), null, 'no feat');
  assert.equal(bonusAttackBasis(handCrossbow, {flags: attackActionFlags(shortsword, {monk: false}), hasFeat: feats('crossbow-expert'), monk: false}), 'crossbow');
  assert.equal(bonusAttackBasis(handCrossbow, {flags: attackActionFlags(greatsword, {monk: false}), hasFeat: feats('crossbow-expert'), monk: false}), null, 'after a two-handed weapon — no');
  assert.equal(bonusAttackBasis(fist, {flags: attackActionFlags(shortsword, {monk: true}), hasFeat: noFeats, monk: true}), 'martial-arts');
  assert.equal(bonusAttackBasis(fist, {flags: attackActionFlags(longsword, {monk: true}), hasFeat: noFeats, monk: true}), null, 'a longsword is not a monk weapon');
  assert.equal(bonusAttackBasis(greatsword, {flags: [FLAG_GREAT_WEAPON], hasFeat: feats('great-weapon-master'), monk: false}), 'great-weapon');
  assert.equal(bonusAttackBasis(greatsword, {flags: attackActionFlags(greatsword, {monk: false}), hasFeat: feats('great-weapon-master'), monk: false}), null, 'only after a crit or a kill');
  assert.match(bonusAttackRefusal(greatsword, {flags: [], hasFeat: feats('great-weapon-master'), monk: false}), /крит или 0 хитов у цели/);
});
