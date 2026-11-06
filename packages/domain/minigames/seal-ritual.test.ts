import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRitual, actRitual } from './seal-ritual.ts';
const user = { name: 'Игрок', manager: false };
test('ritual: every starting rotation is solvable and conserves energy', () => {
  for (let r = 0; r < 4; r++) {
    let game = createRitual(1, 6, r);
    if (r === 0) game.moves = 3;
    for (const [from, direction, amount] of [[0, 1, 2], [0, -1, 1], [3, -1, 2]]) {
      game = actRitual(game, { action: 'transfer', from: (from - r + 4) % 4, direction, amount }, user);
      assert.equal(game.energy.reduce((a, b) => a + b), 12);
    }
    assert.equal(game.phase, 'won'); assert.deepEqual(game.energy, [3, 3, 3, 3]);
    assert.throws(() => actRitual(game, { action: 'stabilize' }, user));
  }
});
test('ritual: overload, stabilization, exhausted moves and immutable invalid actions', () => {
  const initial = createRitual(1, 6, 0);
  const overload = { action: 'transfer' as const, from: 3, direction: 1, amount: 1 };
  let game = actRitual(initial, overload, user);
  assert.equal(game.strain, 1); assert.deepEqual(game.energy, initial.energy);
  assert.equal(initial.moves, 0);
  game = actRitual(game, { action: 'stabilize' }, user);
  assert.equal(game.strain, 0); assert.equal(game.moves, 2);
  game = actRitual(game, overload, user);
  game = actRitual(game, overload, user);
  game = actRitual(game, overload, user);
  assert.equal(game.phase, 'failed');
  assert.throws(() => actRitual(initial, { action: 'transfer', from: 1, direction: 1, amount: 2 }, user));
  assert.throws(() => actRitual(initial, { action: 'cancel' }, user));
  assert.equal(actRitual(initial, { action: 'cancel' }, { ...user, manager: true }).phase, 'cancelled');
  game = initial;
  for (let i = 0; i < 6; i++) game = actRitual(game, { action: 'transfer', from: i % 2 ? 1 : 0, direction: i % 2 ? -1 : 1, amount: 1 }, user);
  assert.equal(game.phase, 'failed'); assert.equal(game.moves, 6);
});
