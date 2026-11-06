import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAlchemy, actAlchemy, alchemyReady } from './alchemy.ts';
const user = { name: 'Алхимик', manager: false };
test('alchemy: all recipes are reachable with available stock, bottle after final action', () => {
  for (const [recipe, ingredients] of [[0, [2, 2, 0]], [1, [2, 1, 1]], [2, [2, 2, 3]]] as const) {
    let game = createAlchemy(1, recipe, 4);
    game = actAlchemy(game, { action: 'stir' }, user);
    for (const ingredient of ingredients) game = actAlchemy(game, { action: 'add', ingredient }, user);
    assert.equal(game.moves, 4); assert.ok(alchemyReady(game));
    assert.throws(() => actAlchemy(game, { action: 'heat' }, user));
    game = actAlchemy(game, { action: 'bottle' }, user);
    assert.equal(game.phase, 'perfect'); assert.equal(game.moves, 4);
    assert.throws(() => actAlchemy(game, { action: 'add', ingredient: 0 }, user));
  }
});
test('alchemy: heat and instability ruin batches; early bottling has consequences', () => {
  let game = createAlchemy(1, 0, 16);
  for (let i = 0; i < 5; i++) game = actAlchemy(game, { action: 'heat' }, user);
  assert.equal(game.phase, 'burned');
  game = createAlchemy(1, 0, 8);
  for (let i = 0; i < 2; i++) game = actAlchemy(game, { action: 'add', ingredient: 3 }, user);
  assert.equal(game.phase, 'burned');
  game = actAlchemy(createAlchemy(1, 0, 8), { action: 'add', ingredient: 1 }, user);
  assert.equal(actAlchemy(game, { action: 'bottle' }, user).phase, 'flawed');
});
test('alchemy: invalid actions preserve state, resource limits and GM cancellation', () => {
  const initial = createAlchemy(1, 0, 8);
  assert.throws(() => actAlchemy(initial, { action: 'bottle' }, user));
  assert.throws(() => actAlchemy(initial, { action: 'cancel' }, user));
  assert.throws(() => actAlchemy(initial, { action: 'add', ingredient: 99 }, user));
  let game = initial;
  for (let i = 0; i < 2; i++) game = actAlchemy(game, { action: 'add', ingredient: 1 }, user);
  assert.throws(() => actAlchemy(game, { action: 'add', ingredient: 1 }, user));
  assert.throws(() => actAlchemy(game, { action: 'cool' }, user));
  assert.deepEqual(initial.stock, [2, 2, 2, 2]); assert.equal(initial.moves, 0);
  assert.equal(actAlchemy(game, { action: 'cancel' }, { ...user, manager: true }).phase, 'cancelled');
  assert.throws(() => createAlchemy(1, -1, 8));
  assert.throws(() => createAlchemy(1, 0, 3));
});
