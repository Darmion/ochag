import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pips, poolTitle, roman, slotTitle, stripEmpty, stripModel } from '../../src/actionBar/resourceStrip.ts';

test('the strip shows only levels the hero has, keeps spent ones, and lists a shared pool once', () => {
  const slots = [3, 2, 0, 0, 0, 0, 0, 0, 0].map((max, index) => ({ level: index + 1, current: index === 1 ? 0 : max, max }));
  const model = stripModel(slots.reverse(), { current: 1, max: 2, slotLevel: 2 }, [
    { id: 'flurry-of-blows', resource: { name: 'Ци', current: 3, max: 5, recharge: 'short' } },
    { id: 'patient-defense', resource: { name: 'Ци', current: 3, max: 5, recharge: 'short' } },
    { id: 'lay-on-hands', resource: { name: 'Наложение рук', current: 15, max: 25, recharge: 'long' } },
    { id: 'evasion', resource: null },
    { id: 'odd', resource: { name: 'Своё', current: 0, max: 0 } },
  ]);
  assert.deepEqual(model.slots, [{ level: 1, current: 3, max: 3 }, { level: 2, current: 0, max: 2 }]);
  assert.deepEqual(model.pact, { level: 2, current: 1, max: 2 });
  assert.deepEqual(model.pools.map(pool => [pool.name, pool.featureId, pool.icon, pool.recharge]), [
    ['Ци', 'flurry-of-blows', 'poolKi', 'short'], ['Наложение рук', 'lay-on-hands', 'poolLayOnHands', 'long'],
  ]);
  assert.equal(stripEmpty(model), false);
  assert.equal(stripEmpty(stripModel([], null, [{ id: 'evasion', resource: null }])), true, 'a creature with nothing to count shows no strip');
});

test('small pools are pips, big ones a number; titles say what is left and when it comes back', () => {
  assert.deepEqual(pips(2, 3), [true, true, false]);
  assert.equal(pips(15, 25), null);
  assert.equal(roman(3), 'III');
  assert.equal(slotTitle({ level: 1, current: 2, max: 3 }), 'Ячейки 1 круга: 2 из 3. Восстанавливаются после долгого отдыха. Щелчок — заклинания этого круга.');
  assert.match(poolTitle({ key: 'Ци', name: 'Ци', icon: 'poolKi', current: 3, max: 5, recharge: 'short', featureId: 'flurry-of-blows' }), /^Ци: 3 из 5\. Восстанавливается после короткого отдыха/);
});
