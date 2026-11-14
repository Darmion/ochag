import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agreeToStake, assertWagerReady, setStake, stakesDue, wagerPayouts, withdrawStake } from './wagers.ts';
import { createDragonGame, type DragonGame } from './dragon-dice.ts';

const host = { id: 'u1', name: 'Ведущая' };
const table = (): DragonGame => {
  const game = createDragonGame(host.id, host.name);
  game.players.push({ id: 'u2', name: 'Гость', score: 0 }, { id: 'u3', name: 'Третий', score: 0 });
  return game;
};
const seat = (userId: string, heroId: string) => ({ userId, heroId, heroName: heroId });

test('consent is given to an amount: a new stake asks everyone again', () => {
  let game = setStake(table(), host, 250);
  game = agreeToStake(game, seat('u1', 'h1'));
  game = agreeToStake(game, seat('u2', 'h2'));
  assert.throws(() => assertWagerReady(game), /Ставку ещё не приняли: Третий/);
  game = setStake(game, host, 300);
  assert.deepEqual(game.wager?.seats, []);
  assert.equal(setStake(game, host, 0).wager, null, 'no stake at all');
  assert.throws(() => setStake(game, { id: 'u2' }, 100), /создатель/);
  assert.throws(() => agreeToStake(game, seat('u9', 'h9')), /присоединитесь/);
  assert.deepEqual(withdrawStake(agreeToStake(game, seat('u2', 'h2')), 'u2').wager?.seats, []);
});

test('the pot is split evenly, the odd copper goes to the first winner, and no winner means refunds', () => {
  let game = setStake(table(), host, 101);
  for (const [user, hero] of [['u1', 'h1'], ['u2', 'h2'], ['u3', 'h3']]) game = agreeToStake(game, seat(user!, hero!));
  assert.doesNotThrow(() => assertWagerReady(game));
  assert.deepEqual(stakesDue(game).map(payment => payment.cp), [101, 101, 101]);
  game.wager!.paid = true;
  assert.deepEqual(wagerPayouts(game, ['u1', 'u3']).map(payment => [payment.heroId, payment.cp]), [['h1', 152], ['h3', 151]]);
  assert.deepEqual(wagerPayouts(game, []).map(payment => payment.cp), [101, 101, 101]);
  assert.deepEqual(stakesDue(game), [], 'paid stakes are not taken twice');
});
