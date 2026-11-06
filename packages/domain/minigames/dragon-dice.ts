export type DragonAction = 'join' | 'leave' | 'start' | 'roll' | 'bank' | 'cancel';
export type DragonPlayer = { id: string; name: string; score: number };
export type DragonGame = {
  revision: number; hostId: string; phase: 'lobby' | 'playing' | 'finished' | 'cancelled';
  players: DragonPlayer[]; round: number; rounds: number; turn: number;
  pot: number; dragons: number; rolls: number; lastDie: number | null; message: string;
};
const fail = (message: string): never => { throw new Error(message); };
export function createDragonGame(id: string, name: string, revision = 1): DragonGame {
  return { revision, hostId: id, phase: 'lobby', players: [{ id, name, score: 0 }],
    round: 1, rounds: 3, turn: 0, pot: 0, dragons: 0, rolls: 0, lastDie: null, message: 'Стол открыт. Присоединяйтесь к партии.' };
}
function advance(game: DragonGame) {
  game.turn += 1;
  if (game.turn === game.players.length) { game.turn = 0; game.round += 1; }
  game.pot = 0; game.dragons = 0; game.rolls = 0;
  if (game.round > game.rounds) { game.round = game.rounds; game.phase = 'finished'; }
}
export function actDragonGame(current: DragonGame, action: DragonAction, user: { id: string; name: string; manager?: boolean }, roll: () => number): DragonGame {
  const game = structuredClone(current);
  if (action === 'cancel') {
    if (user.id !== game.hostId && !user.manager) fail('Завершить партию может её создатель или мастер.');
    if (game.phase === 'finished' || game.phase === 'cancelled') fail('Партия уже завершена.');
    game.phase = 'cancelled'; game.message = 'Партия завершена без определения победителя.';
  } else if (action === 'join') {
    if (game.phase !== 'lobby') fail('Присоединиться можно до начала партии.');
    if (game.players.some(p => p.id === user.id)) fail('Вы уже за столом.');
    if (game.players.length >= 8) fail('За столом уже восемь участников.');
    game.players.push({ id: user.id, name: user.name, score: 0 });
    game.message = `${user.name} присоединяется к столу.`;
  } else if (action === 'leave') {
    if (game.phase !== 'lobby') fail('Партия уже началась.');
    if (game.hostId === user.id) fail('Создатель может завершить стол.');
    if (!game.players.some(p => p.id === user.id)) fail('Вы не участвуете в партии.');
    game.players = game.players.filter(p => p.id !== user.id);
    game.message = `${user.name} покидает стол.`;
  } else if (action === 'start') {
    if (game.phase !== 'lobby' || game.hostId !== user.id) fail('Начать партию может её создатель в открытом лобби.');
    game.phase = 'playing'; game.message = 'Кости на стол! Первым ходит создатель партии.';
  } else {
    if (game.phase !== 'playing') fail('Сейчас нет активного хода.');
    const player = game.players[game.turn]!;
    if (player.id !== user.id) fail('Сейчас ход другого игрока.');
    if (action === 'bank') {
      if (!game.rolls) fail('Сначала бросьте кость.');
      player.score += game.pot;
      game.message = `${player.name} сохраняет ${game.pot} очков.`;
      advance(game);
    } else if (action === 'roll') {
      const die = roll();
      if (!Number.isInteger(die) || die < 1 || die > 6) fail('Недопустимый результат кости.');
      game.lastDie = die; game.rolls += 1;
      if (die === 1) {
        game.dragons += 1;
        if (game.dragons === 2) { game.message = `${player.name}: второй дракон! ${game.pot} очков хода сгорели.`; advance(game); }
        else game.message = `${player.name}: дракон! Следующий дракон сожжёт очки хода.`;
      } else {
        const points = die === 6 ? 10 : die;
        game.pot += points; game.message = `${player.name}: ${die === 6 ? 'самоцвет' : die}, +${points} очков.`;
      }
    } else fail('Неизвестное действие.');
  }
  game.revision += 1;
  return game;
}
export function dragonWinners(game: DragonGame): DragonPlayer[] {
  if (game.phase !== 'finished') return [];
  const best = Math.max(...game.players.map(player => player.score));
  return game.players.filter(player => player.score === best);
}
