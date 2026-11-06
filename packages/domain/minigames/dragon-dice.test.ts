import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDragonGame, actDragonGame, dragonWinners } from './dragon-dice.ts';
const host = { id: 'host', name: 'Мастер' };
const guest = { id: 'guest', name: 'Гость' };
const die = (n: number) => () => n;
test('dragon dice: banking, gem and two dragons preserve earlier scores', () => {
  let game = actDragonGame(createDragonGame(host.id, host.name), 'start', host, die(2));
  game = actDragonGame(game, 'roll', host, die(6));
  assert.equal(game.pot, 10);
  game = actDragonGame(game, 'bank', host, die(2));
  assert.equal(game.players[0].score, 10);
  assert.equal(game.round, 2);
  game = actDragonGame(game, 'roll', host, die(5));
  game = actDragonGame(game, 'roll', host, die(1));
  assert.equal(game.dragons, 1); assert.equal(game.pot, 5);
  game = actDragonGame(game, 'roll', host, die(1));
  assert.equal(game.pot, 0); assert.equal(game.round, 3);
  assert.equal(game.players[0].score, 10);
});
test('dragon dice: three equal rounds, shared win, terminal state', () => {
  let game = actDragonGame(createDragonGame(host.id, host.name), 'join', guest, die(2));
  game = actDragonGame(game, 'start', host, die(2));
  for (let round = 1; round <= 3; round++) for (const player of [host, guest]) {
    assert.equal(game.round, round);
    assert.equal(game.players[game.turn].id, player.id);
    game = actDragonGame(game, 'roll', player, die(2));
    game = actDragonGame(game, 'bank', player, die(2));
  }
  assert.equal(game.phase, 'finished');
  assert.deepEqual(dragonWinners(game).map(p => p.score), [6, 6]);
  assert.throws(() => actDragonGame(game, 'roll', host, die(6)));
});
test('dragon dice: invalid actions do not mutate the state or draw a die', () => {
  const initial = createDragonGame(host.id, host.name);
  assert.throws(() => actDragonGame(initial, 'start', guest, die(1)));
  assert.throws(() => actDragonGame(initial, 'join', host, die(1)));
  const game = actDragonGame(initial, 'start', host, die(2));
  let drawn = false;
  assert.throws(() => actDragonGame(game, 'roll', guest, () => { drawn = true; return 6; }));
  assert.equal(drawn, false);
  assert.throws(() => actDragonGame(game, 'bank', host, die(1)));
  assert.throws(() => actDragonGame(game, 'roll', host, die(7)));
  assert.equal(game.pot, 0); assert.equal(game.rolls, 0); assert.equal(initial.phase, 'lobby');
  assert.throws(() => actDragonGame(game, 'cancel', guest, die(1)));
  assert.equal(actDragonGame(game, 'cancel', { ...guest, manager: true }, die(1)).phase, 'cancelled');
});
test('dragon dice: lobby capacity, leaving, and no late joins', () => {
  let game = createDragonGame(host.id, host.name);
  for (let i = 0; i < 7; i++) game = actDragonGame(game, 'join', { id: String(i), name: String(i) }, die(1));
  assert.throws(() => actDragonGame(game, 'join', guest, die(1)));
  game = actDragonGame(game, 'leave', { id: '0', name: '0' }, die(1));
  game = actDragonGame(game, 'join', guest, die(1));
  game = actDragonGame(game, 'start', host, die(1));
  assert.throws(() => actDragonGame(game, 'join', { id: 'late', name: 'Late' }, die(1)));
  assert.throws(() => actDragonGame(game, 'leave', guest, die(1)));
});
