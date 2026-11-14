// Wagers with consent (roadmap 4.6): the host names a stake, every player agrees with a hero whose purse pays,
// the stakes leave the purses when the game starts, and the pot goes to the winners or back to everyone.
export type WagerSeat = { userId: string; heroId: string; heroName: string };
export type Wager = { stakeCp: number; seats: WagerSeat[]; paid: boolean; settled: boolean };
export type Payment = { heroId: string; heroName: string; cp: number };
type WagerGame = { phase: string; hostId: string; players: { id: string; name: string }[]; wager?: Wager | null; revision: number };

export const STAKE_MAX_CP = 100_000;

function lobby(game: WagerGame) {
  if (game.phase !== 'lobby') throw new Error('Ставку обсуждают до начала игры.');
}

// A new stake asks everyone again: consent is given to an amount, not to «some» stake.
export function setStake<T extends WagerGame>(current: T, user: { id: string }, stakeCp: number): T {
  lobby(current);
  if (current.hostId !== user.id) throw new Error('Ставку назначает создатель игры.');
  if (!Number.isInteger(stakeCp) || stakeCp < 0 || stakeCp > STAKE_MAX_CP) throw new Error('Ставка: от 1 мм до 1000 зм.');
  const game = structuredClone(current);
  game.wager = stakeCp ? { stakeCp, seats: [], paid: false, settled: false } : null;
  game.revision += 1;
  return game;
}

export function agreeToStake<T extends WagerGame>(current: T, seat: WagerSeat): T {
  lobby(current);
  if (!current.wager) throw new Error('Ставки нет.');
  if (!current.players.some(player => player.id === seat.userId)) throw new Error('Сначала присоединитесь к игре.');
  const game = structuredClone(current);
  game.wager!.seats = [...game.wager!.seats.filter(entry => entry.userId !== seat.userId), seat];
  game.revision += 1;
  return game;
}

export function withdrawStake<T extends WagerGame>(current: T, userId: string): T {
  if (!current.wager || current.wager.paid) return current;
  const game = structuredClone(current);
  game.wager!.seats = game.wager!.seats.filter(entry => entry.userId !== userId);
  return game;
}

// The game starts only when every player has agreed to the stake.
export function assertWagerReady(game: WagerGame) {
  if (!game.wager) return;
  const missing = game.players.filter(player => !game.wager!.seats.some(seat => seat.userId === player.id));
  if (missing.length) throw new Error(`Ставку ещё не приняли: ${missing.map(player => player.name).join(', ')}.`);
}

export function stakesDue(game: WagerGame): Payment[] {
  if (!game.wager || game.wager.paid) return [];
  return game.wager.seats
    .filter(seat => game.players.some(player => player.id === seat.userId))
    .map(seat => ({ heroId: seat.heroId, heroName: seat.heroName, cp: game.wager!.stakeCp }));
}

// The pot is split evenly between the winners; the copper left over goes to the first of them. No winners — everyone gets the stake back.
export function wagerPayouts(game: WagerGame, winnerIds: string[]): Payment[] {
  const wager = game.wager;
  if (!wager?.paid || wager.settled) return [];
  const winners = wager.seats.filter(seat => winnerIds.includes(seat.userId));
  if (!winners.length) return wager.seats.map(seat => ({ heroId: seat.heroId, heroName: seat.heroName, cp: wager.stakeCp }));
  const pot = wager.stakeCp * wager.seats.length;
  const share = Math.floor(pot / winners.length);
  return winners.map((seat, index) => ({ heroId: seat.heroId, heroName: seat.heroName, cp: share + (index === 0 ? pot - share * winners.length : 0) }));
}
