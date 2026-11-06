import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDuel, actDuel, viewDuel, DUEL_MOVES, DUEL_DAMAGE } from './duel.ts';
const a = { id: 'a', name: 'А', manager: false }, b = { id: 'b', name: 'Б', manager: false }, observer = { id: 'observer', name: 'Мастер', manager: true };
function started() { return actDuel(actDuel(createDuel(a.id, a.name, 1), { action: 'join' }, b), { action: 'start' }, a); }
test('duel: all sixteen matchups resolve simultaneous damage and costs', () => {
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let game = actDuel(started(), { action: 'choose', move: DUEL_MOVES[i].id }, a);
    assert.equal(game.players[0].stamina, 3); assert.equal(game.players[0].health, 6);
    game = actDuel(game, { action: 'choose', move: DUEL_MOVES[j].id }, b);
    assert.equal(game.players[0].health, 6 - DUEL_DAMAGE[j][i]);
    assert.equal(game.players[1].health, 6 - DUEL_DAMAGE[i][j]);
    assert.equal(game.players[0].stamina, Math.min(3, 3 - DUEL_MOVES[i].cost + DUEL_MOVES[i].recovery));
    assert.equal(game.round, 2); assert.deepEqual(game.choices, {});
  }
});
test('duel: pending move is private, immutable and cannot be replaced', () => {
  const initial = started(), game = actDuel(initial, { action: 'choose', move: 'feint' }, a);
  assert.equal(viewDuel(game, a.id).ownMove, 'feint');
  for (const viewer of [b.id, observer.id]) {
    const visible = viewDuel(game, viewer);
    assert.equal(visible.ownMove, null); assert.equal('choices' in visible, false);
    assert.equal(JSON.stringify(visible).includes('feint'), false);
    assert.deepEqual(visible.ready, ['a']);
  }
  assert.throws(() => actDuel(game, { action: 'choose', move: 'strike' }, a));
  assert.throws(() => actDuel(game, { action: 'choose', move: 'rest' }, observer));
  assert.deepEqual(initial.choices, {});
  const projected = viewDuel(game, b.id); projected.players[0].health = 0;
  assert.equal(game.players[0].health, 6);
});
test('duel: double knockout, round cap, stamina limits and surrender', () => {
  let game = started(); game.players.forEach(p => { p.health = 1; });
  game = actDuel(actDuel(game, { action: 'choose', move: 'strike' }, a), { action: 'choose', move: 'strike' }, b);
  assert.equal(game.phase, 'finished'); assert.equal(game.winnerId, null);
  assert.throws(() => actDuel(game, { action: 'choose', move: 'rest' }, a));
  game = started(); game.players[0].stamina = 0;
  assert.throws(() => actDuel(game, { action: 'choose', move: 'strike' }, a));
  for (let i = 0; i < 8; i++) game = actDuel(actDuel(game, { action: 'choose', move: 'rest' }, a), { action: 'choose', move: 'rest' }, b);
  assert.equal(game.phase, 'finished'); assert.equal(game.history.length, 8); assert.equal(game.winnerId, null);
  game = actDuel(actDuel(started(), { action: 'choose', move: 'feint' }, a), { action: 'surrender' }, b);
  assert.equal(game.winnerId, a.id); assert.deepEqual(game.choices, {}); assert.equal(game.history.length, 0);
});
test('duel: lobby permissions and observer cancellation', () => {
  let game = createDuel(a.id, a.name, 1);
  assert.throws(() => actDuel(game, { action: 'start' }, a));
  game = actDuel(game, { action: 'join' }, b);
  assert.throws(() => actDuel(game, { action: 'join' }, observer));
  assert.throws(() => actDuel(game, { action: 'start' }, b));
  game = actDuel(game, { action: 'leave' }, b); assert.equal(game.players.length, 1);
  assert.equal(actDuel(game, { action: 'cancel' }, observer).phase, 'cancelled');
});
