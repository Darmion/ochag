import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attackMotion, gearLight, heldLook } from './held.ts';
import { SRD_WEAPONS } from '../srd/weapons.ts';

const item = (name: string, srd: string | null = null, category: string | null = null) => ({ name, srd, category: category as never });
const weapon = (index: string) => {
  const found = SRD_WEAPONS.find(entry => entry.index === index)!;
  return { kind: found.kind, properties: found.properties, damageType: found.damageType };
};

test('the look of a held item comes from its SRD weapon, its name or its kind', () => {
  assert.equal(heldLook(item('Длинный меч', 'weapon:longsword')), 'sword');
  assert.equal(heldLook(item('Ручной топор', 'weapon:handaxe')), 'axe');
  assert.equal(heldLook(item('Лёгкий арбалет', 'weapon:crossbow-light')), 'crossbow');
  assert.equal(heldLook(item('Короткий лук', 'weapon:shortbow')), 'bow');
  assert.equal(heldLook(item('Щит', 'gear:shield')), 'shield');
  assert.equal(heldLook(item('Факел', 'gear:torch')), 'torch');
  assert.equal(heldLook(item('Фонарь с заслонкой', 'gear:lantern-hooded')), 'lantern');
  assert.equal(heldLook(item('Посох лечения')), 'staff');
  assert.equal(heldLook(item('Кружка эля')), 'thing');
});

test('a held torch or lantern gives its light; other gear none', () => {
  assert.deepEqual(gearLight(item('Факел', 'gear:torch')), { bright: 20, dim: 20, cone: false, openFlame: true });
  assert.deepEqual(gearLight(item('Факел')), { bright: 20, dim: 20, cone: false, openFlame: true }, 'found by the SRD name too');
  assert.equal(gearLight(item('Направленный фонарь', 'gear:lantern-bullseye'))?.cone, true);
  assert.equal(gearLight(item('Верёвка', 'gear:rope-hempen-50-feet')), null);
});

test('an attack moves the way the weapon is used', () => {
  assert.equal(attackMotion(weapon('longsword'), false), 'swing');
  assert.equal(attackMotion(weapon('rapier'), false), 'thrust');
  assert.equal(attackMotion(weapon('mace'), false), 'swing');
  assert.equal(attackMotion(weapon('shortbow'), true), 'shot');
  assert.equal(attackMotion(weapon('dagger'), true), 'throw', 'a thrown dagger');
  assert.equal(attackMotion(weapon('dagger'), false), 'thrust');
  assert.equal(attackMotion(weapon('dart'), true), 'throw');
  assert.equal(attackMotion(null, false), 'thrust', 'an unarmed strike');
});
